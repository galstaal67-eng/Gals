/* =========================================================================
   כרטיס העלייה למטוס.

   מה זה עושה: לוקח את כרטיס העלייה שהועלה למכשיר ומציג אותו כמו כרטיס
   עלייה — פרטי הטיסה גדולים למעלה, והברקוד למטה בגודל שאפשר לסרוק ממנו.

   **הברקוד הוא תמיד הברקוד המקורי של חברת התעופה.** הוא לא מיוצר כאן
   ולא משוחזר מהפרטים: הכרטיס שהועלה מצויר כמו שהוא (תמונה, או עמוד
   ראשון של PDF שמרונדר ב-pdf.js), והוא זה שנסרק. כל דרך אחרת — לבנות
   ברקוד מהשם, מהמושב ומקוד ההזמנה — הייתה מייצרת ברקוד שנראה אמיתי
   ועלול לא להיסרק בשער, וזו בדיוק התקלה שאסור לייצר בשדה תעופה.

   מצב סריקה (כפתור "מסך מלא לסריקה") הופך את המסך ללבן, מגדיל את
   הברקוד לרוחב המסך, מבקש Wake Lock כדי שהמסך לא ייכבה בתור, ומאפשר
   לסובב ב-90° — כי סורק בשער לרוב רוצה את הברקוד לאורך.

   הכול עובד אופליין: המסמך יושב ב-IndexedDB, ו-pdf.js מוגש מהאתר.
   ========================================================================= */

const BoardingPass = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const LEG = { out: "הלוך", back: "חזור" };

  let host = null;        // { getTrip }
  let cards = [];         // הכרטיסים שאפשר לדפדף ביניהם
  let at = 0;
  let url = null;         // objectURL של המסמך המוצג
  let wake = null;        // WakeLockSentinel
  let rot = 0;            // סיבוב הברקוד במצב סריקה
  let zoom = 1;           // הגדלה במצב סריקה
  let full = null;        // הכרטיס המצויר במלואו (img או canvas)
  let codeBox = null;     // מיקום הברקוד בתוכו, אם אותר
  let focused = false;    // האם מוצג רק הברקוד

  /* ------------------------------------------------------------------ */
  /*  איסוף הכרטיסים                                                     */
  /* ------------------------------------------------------------------ */

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("he-IL", { day: "2-digit", month: "short", year: "numeric" });
  };

  /** קוד שדה מתוך "TLV" או "תל אביב (TLV)" — מה שיש במסמך הטיול */
  function code(s) {
    const m = String(s || "").match(/\b([A-Z]{3})\b/);
    return m ? m[1] : String(s || "").slice(0, 3).toUpperCase();
  }

  /**
   * מצרף כל מסמך מסוג "כרטיס עלייה" לרגל הטיסה ולנוסע שלו.
   * רגל שאין לה מסמך מופיעה גם היא — עם מקום ריק במקום הברקוד, כי
   * עדיף להראות את הטיסה ולהסביר מה חסר מאשר לא להראות כלום.
   */
  function build(trip, docs) {
    const f = trip.flights || {};
    const out = [];

    ["out", "back"].forEach((key) => {
      const leg = f[key];
      if (!leg) return;
      const mine = docs.filter((d) => d.leg === key && d.kind === "boarding");

      if (!mine.length) {
        out.push({ key, leg, f, doc: null, who: "" });
        return;
      }
      mine.forEach((doc) => out.push({ key, leg, f, doc, who: doc.who || "" }));
    });

    return out;
  }

  /** המושב של הנוסע הזה ברגל הזו, אם ידוע */
  function seatOf(leg, who) {
    const k = (v) => String(v || "").trim().toLowerCase();
    const hit = (leg.seats || []).find((s) => k(s.who) && k(s.who) === k(who));
    return hit?.seat || "";
  }

  /** קוד ההזמנה של הנוסע הזה */
  function pnrOf(f, who) {
    const k = (v) => String(v || "").trim().toLowerCase();
    const list = f.passengers || [];
    const hit = list.find((p) => k(p.name) && k(p.name) === k(who));
    return (hit || list[0] || {}).pnr || "";
  }

  /* ------------------------------------------------------------------ */
  /*  ציור הברקוד — המסמך המקורי                                         */
  /* ------------------------------------------------------------------ */

  let pdfjs = null;

  /** pdf.js נטען רק כשצריך אותו: 1.4MB שאין סיבה לשלם עליהם תמיד */
  async function loadPdfjs() {
    if (pdfjs) return pdfjs;
    const mod = await import("../vendor/pdfjs/pdf.min.mjs");
    mod.GlobalWorkerOptions.workerSrc = "assets/vendor/pdfjs/pdf.worker.min.mjs";
    pdfjs = mod;
    return mod;
  }

  /**
   * העמוד הראשון של ה-PDF כקנבס.
   * הרזולוציה נגזרת מרוחב התצוגה ומצפיפות המסך — ברקוד שמרונדר קטן
   * ואז נמתח ב-CSS יוצא מטושטש, וסורק לא אוהב מטושטש.
   */
  async function pdfToCanvas(blob, cssWidth) {
    const lib = await loadPdfjs();
    const data = await blob.arrayBuffer();
    const pdf = await lib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);

    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const scale = Math.max(1.5, Math.min(6, (cssWidth * dpr) / base.width));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    canvas.className = "pass__scan";
    await page.render({ canvas, viewport }).promise;

    pdf.cleanup();
    return canvas;
  }

  /** ממלא את אזור הברקוד במסמך עצמו. ה-objectURL כבר נוצר ב-draw */
  async function paintDoc(area, doc) {
    area.innerHTML = '<p class="pass__wait">פותח את הכרטיס…</p>';
    const type = doc.type || "";
    full = null; codeBox = null; focused = false;

    try {
      if (type.startsWith("image/")) {
        const img = new Image();
        img.className = "pass__scan";
        img.alt = doc.title || doc.name || "כרטיס עלייה";
        img.src = url;
        await img.decode();
        full = img;
      } else if (type === "application/pdf" || /\.pdf$/i.test(doc.name || "")) {
        full = await pdfToCanvas(doc.blob, Math.max(area.clientWidth || 0, 420));
      } else {
        throw new Error("סוג קובץ שאי אפשר להציג כאן");
      }

      area.innerHTML = "";
      area.appendChild(full);

      // האיתור רץ פעם אחת לכרטיס, ורק כדי להחליט אם כפתור ההתמקדות מוצג
      try { codeBox = findCode(full); } catch { codeBox = null; }
      const btn = $("[data-pass-focus]");
      if (btn) btn.hidden = !codeBox;
    } catch (err) {
      area.innerHTML = `
        <p class="pass__wait">לא הצלחנו לצייר את הכרטיס כאן${err?.message ? ` (${esc(err.message)})` : ""}.</p>
        <a class="btn btn--sm" href="${url}" target="_blank" rel="noopener">פתיחת הקובץ המקורי</a>`;
    }
  }

  /** מחליף בין "רק הברקוד" ל"הכרטיס כולו" */
  function focus(on) {
    const area = $("#passCode");
    if (!area || !full) return;
    focused = Boolean(on) && Boolean(codeBox);
    area.innerHTML = "";
    area.appendChild(focused ? cropTo(full, codeBox) : full);
    const btn = $("[data-pass-focus]");
    if (btn) btn.textContent = focused ? "הכרטיס כולו" : "🔍 רק הברקוד";
  }

  /* ------------------------------------------------------------------ */
  /*  הכרטיס                                                             */
  /* ------------------------------------------------------------------ */

  function cardHTML(item) {
    const { leg, f, doc, who, key } = item;
    const seat = seatOf(leg, who);
    const pnr = pnrOf(f, who);

    const field = (label, value, big) =>
      `<div class="pass__f">
         <b>${esc(label)}</b>
         <span class="${big ? "pass__f--big" : ""}">${esc(value || "—")}</span>
       </div>`;

    return `
      <div class="pass__card">
        <div class="pass__top">
          <span class="pass__airline">✈️ ${esc(f.carrier || "טיסה")}</span>
          <span class="pass__leg">${esc(LEG[key] || "")} · ${esc(fmtDate(leg.date))}</span>
        </div>

        <div class="pass__route">
          <div class="pass__port">
            <b>${esc(code(leg.from))}</b>
            <span>${esc(leg.dep || "")}</span>
          </div>
          <div class="pass__line"><i>✈</i></div>
          <div class="pass__port">
            <b>${esc(code(leg.to))}</b>
            <span>${esc(leg.arr || "")}</span>
          </div>
        </div>

        <div class="pass__fields">
          ${field("נוסע", who || (f.passengers || [])[0]?.name || "")}
          ${field("טיסה", leg.flightNo)}
          ${field("מושב", seat, true)}
          ${field("טרמינל", leg.terminal)}
          ${field("קוד הזמנה", pnr)}
          ${field("משך", leg.duration)}
        </div>

        <div class="pass__perf" aria-hidden="true"></div>

        <div class="pass__code" id="passCode">
          ${doc
            ? ""
            : `<p class="pass__wait">אין כאן עדיין כרטיס עלייה.<br />
                 העלו אותו בלשונית הטיסות — הברקוד שבו הוא מה שנסרק בשער.</p>`}
        </div>

        ${doc
          ? `<div class="pass__actions">
               <button class="btn btn--sm btn--primary" data-pass-scan>🔎 מסך מלא לסריקה</button>
               <a class="btn btn--sm" href="${url || "#"}" target="_blank" rel="noopener"
                  data-pass-open>הקובץ המקורי</a>
             </div>
             <p class="pass__src">הברקוד הוא המקור מחברת התעופה: ${esc(doc.title || doc.name)}</p>`
          : `<div class="pass__actions">
               <button class="btn btn--sm btn--primary" data-pass-mail>📬 חיפוש במייל</button>
               <button class="btn btn--sm" data-pass-upload>📎 מעבר ללשונית הטיסות</button>
             </div>`}
      </div>`;
  }

  function navHTML() {
    if (cards.length < 2) return "";
    const dots = cards
      .map((c, i) => {
        const label = `${LEG[c.key] || ""}${c.who ? " · " + c.who : ""}`;
        return `<button class="pass__tab ${i === at ? "is-on" : ""}" data-pass-go="${i}">${esc(label)}</button>`;
      })
      .join("");
    return `<div class="pass__tabs">${dots}</div>`;
  }

  async function draw() {
    const body = $("#passBody");
    const item = cards[at];
    if (!item) {
      body.innerHTML = '<p class="pass__wait">לטיול הזה עדיין לא הוזנו טיסות.</p>';
      return;
    }
    // הכתובת נוצרת לפני בניית ה-HTML, כי הקישור "הקובץ המקורי" שבתוכו
    // צריך אותה — ומשוחררת כאן כדי שדפדוף בין כרטיסים לא ידלוף זיכרון
    if (url) { URL.revokeObjectURL(url); url = null; }
    if (item.doc) url = URL.createObjectURL(item.doc.blob);

    body.innerHTML = navHTML() + cardHTML(item);
    if (item.doc) await paintDoc($("#passCode", body), item.doc);
  }

  /* ------------------------------------------------------------------ */
  /*  איתור הברקוד בתוך הכרטיס                                           */
  /* ------------------------------------------------------------------ */

  /**
   * מוצא את הברקוד בתוך הדף ומחזיר את התיבה שלו ביחס לרוחב ולגובה.
   *
   * השיטה: ברקוד הוא האזור עם צפיפות המעברים שחור/לבן הגבוהה בדף —
   * טקסט רגיל מייצר הרבה פחות מעברים לשורה, וקווים ומסגרות מייצרים
   * מעט מאוד. סופרים מעברים בכל שורה ובכל עמודה, ולוקחים את התחום
   * שבו הצפיפות גבוהה פי כמה מהחציון.
   *
   * זו הערכה ולא זיהוי: אם היא מחזירה תיבה חשודה (גדולה מדי או קטנה
   * מדי) מוותרים עליה ומציגים את הכרטיס כולו. המשתמש תמיד יכול לכבות
   * את ההתמקדות בכפתור.
   */
  function findCode(source) {
    // הניתוח רץ ברזולוציה גבוהה בכוונה: בהקטנה ל-360 פיקסלים פסי ברקוד
    // דקים נמרחים לאפור אחיד, והסימן שמחפשים כאן פשוט נעלם
    const W = Math.max(600, Math.min(source.naturalWidth || source.width || 0, 1400));
    const ratio = source.height / (source.width || 1);
    const H = Math.max(40, Math.round(W * ratio));

    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, W, H);

    const px = ctx.getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      gray[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    }

    const JUMP = 60;
    const rows = new Uint16Array(H);
    for (let y = 0; y < H; y++) {
      for (let x = 1; x < W; x++) {
        if (Math.abs(gray[y * W + x] - gray[y * W + x - 1]) > JUMP) rows[y]++;
      }
    }

    /**
     * הפס עם **המסה** הגדולה ביותר — סכום המעברים לאורכו.
     *
     * זה ההבדל בין ברקוד לשורת טקסט, וצריך את שניהם: שורת טקסט
     * במונוספייס יכולה להיות צפופה פי חמישה מברקוד דליל, אבל היא בגובה
     * של עשר שורות וברקוד הוא בגובה של מאה. סף נמוך מכניס את שתיהן
     * לתחרות, והמסה מכריעה לטובת הפס הגבוה.
     */
    const peak = Math.max(...rows);
    if (peak < 10) return null;
    const gate = Math.max(8, peak * 0.12);

    let best = null, from = -1, gap = 0, mass = 0;
    const close = (end) => {
      const run = { a: from, b: end, mass };
      if (!best || run.mass > best.mass) best = run;
      from = -1; gap = 0; mass = 0;
    };
    for (let y = 0; y <= H; y++) {
      const hot = y < H && rows[y] >= gate;
      if (hot) {
        if (from < 0) { from = y; mass = 0; }
        mass += rows[y];
        gap = 0;
      } else if (from >= 0) {
        // חור של שורה־שתיים בתוך ברקוד הוא רעש סריקה, לא סוף הפס
        if (++gap <= 2 && y < H) continue;
        close(y - gap);
      }
    }
    if (!best) return null;

    const tall = best.b - best.a + 1;
    if (tall < H * 0.03) return null;          // שורת טקסט, לא ברקוד
    if (best.mass / tall < 10) return null;    // פס דהוי מדי מכדי להיות ברקוד

    // הרוחב נמדד **רק בתוך הפס שנמצא**, ולכן אינו מושפע משאר הדף
    let left = W, right = 0;
    for (let y = best.a; y <= best.b; y++) {
      for (let x = 1; x < W; x++) {
        if (Math.abs(gray[y * W + x] - gray[y * W + x - 1]) > JUMP) {
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (right - left < W * 0.08) return null;

    // שוליים נדיבים: מתחת לברקוד יש כמעט תמיד את שורת הקוד הקריאה,
    // ועדיף להכניס אותה שלמה מאשר לחתוך אותה באמצע
    const padY = (tall * 0.3) / H;
    const padX = 0.04;
    const b = {
      x: Math.max(0, left / W - padX),
      y: Math.max(0, best.a / H - padY),
      w: Math.min(1, (right + 1) / W + padX) - Math.max(0, left / W - padX),
      h: Math.min(1, (best.b + 1) / H + padY) - Math.max(0, best.a / H - padY),
    };

    // תיבה שמכסה כמעט את כל הדף אינה "התמקדות", ותיבה זעירה היא רעש
    const area = b.w * b.h;
    if (area > 0.6 || area < 0.004) return null;
    return b;
  }

  /** חותך את התיבה שנמצאה לקנבס חדש, בגודל מלא ובלי לאבד חדות */
  function cropTo(source, box) {
    const sx = Math.round(box.x * source.width);
    const sy = Math.round(box.y * source.height);
    const sw = Math.max(8, Math.round(box.w * source.width));
    const sh = Math.max(8, Math.round(box.h * source.height));

    const c = document.createElement("canvas");
    c.width = sw; c.height = sh;
    c.className = "pass__scan";
    c.getContext("2d").drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    return c;
  }

  /* ------------------------------------------------------------------ */
  /*  מצב סריקה                                                          */
  /* ------------------------------------------------------------------ */

  async function keepAwake(on) {
    try {
      if (on) {
        if (!wake && navigator.wakeLock) wake = await navigator.wakeLock.request("screen");
      } else if (wake) {
        await wake.release();
        wake = null;
      }
    } catch {
      /* דפדפן בלי Wake Lock, או המסך כבר לא גלוי — לא קריטי */
    }
  }

  function scan(on) {
    const ov = $("#passOverlay");
    ov.classList.toggle("is-scan", on);

    if (on) {
      // נכנסים ישר למה שבאמת צריך בשער: הברקוד, גדול. הכפתור מחזיר
      // לכרטיס המלא למי שרוצה לראות שער, שעת עלייה או שם.
      if (codeBox) focus(true);
    } else {
      rot = 0; zoom = 1;
      ov.style.removeProperty("--pass-rot");
      ov.style.removeProperty("--pass-zoom");
      if (focused) focus(false);
    }
    keepAwake(on);
  }

  function rotate() {
    rot = (rot + 90) % 360;
    $("#passOverlay").style.setProperty("--pass-rot", `${rot}deg`);
  }

  /** הגדלה בצעדים, עם גלילה מסביב — סורק ישן לפעמים צריך ברקוד ענק */
  function stepZoom(dir) {
    zoom = Math.min(4, Math.max(1, zoom + dir * 0.5));
    $("#passOverlay").style.setProperty("--pass-zoom", String(zoom));
  }

  /* ------------------------------------------------------------------ */
  /*  API                                                                */
  /* ------------------------------------------------------------------ */

  function close() {
    scan(false);
    if (url) { URL.revokeObjectURL(url); url = null; }
    $("#passOverlay").hidden = true;
  }

  async function open(opts = {}) {
    const trip = host.getTrip();
    const docs = TripDocs.available() ? await TripDocs.list(trip.id) : [];
    cards = build(trip, docs);

    at = 0;
    if (opts.docId) {
      const i = cards.findIndex((c) => c.doc?.id === opts.docId);
      if (i >= 0) at = i;
    } else if (opts.leg) {
      const i = cards.findIndex((c) => c.key === opts.leg);
      if (i >= 0) at = i;
    }

    $("#passOverlay").hidden = false;
    await draw();
  }

  function init(h) {
    host = h;
    const ov = $("#passOverlay");

    ov.addEventListener("click", async (e) => {
      if (e.target === ov || e.target.closest("[data-pass-close]")) { close(); return; }
      if (e.target.closest("[data-pass-scan]")) { scan(true); return; }
      if (e.target.closest("[data-pass-unscan]")) { scan(false); return; }
      if (e.target.closest("[data-pass-rotate]")) { rotate(); return; }
      if (e.target.closest("[data-pass-focus]")) { focus(!focused); return; }
      const z = e.target.closest("[data-pass-zoom]");
      if (z) { stepZoom(Number(z.dataset.passZoom)); return; }
      if (e.target.closest("[data-pass-mail]")) { close(); MailImport.open(); return; }
      if (e.target.closest("[data-pass-upload]")) {
        close();
        document.getElementById("tab-flights")?.click();
        return;
      }
      const go = e.target.closest("[data-pass-go]");
      if (go) {
        at = Number(go.dataset.passGo) || 0;
        await draw();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || ov.hidden) return;
      if (ov.classList.contains("is-scan")) scan(false);
      else close();
    });

    // חזרה למסך אחרי שהטלפון ננעל מבטלת את ה-Wake Lock; מבקשים שוב
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && ov.classList.contains("is-scan")) keepAwake(true);
    });
  }

  return { init, open, close };
})();
