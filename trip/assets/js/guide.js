/* =====================================================================
   TripGuide — הדמות שמלווה אתכם בשטח

   עד כה האפליקציה חיכתה שישאלו אותה. היא ידעה איפה אתם — היא קיבלה
   הרשאת מיקום במסך המסלול — אבל לא עשתה עם זה דבר מלבד לצייר סיכה.
   כאן היא מתחילה לפתוח את הפה: כשמגיעים למקום שהיא המליצה עליו היא
   אומרת שהיא רואה, וכשעוזבים אותו היא שואלת איך היה.

   ── שלוש החלטות ──

   **אינה מבקשת הרשאה לעולם.** מסך המסלול הוא היחיד שמבקש מיקום, כי שם
   המשתמש ביקש ניווט ומצפה לכך. המלווה משתמש בהרשאה רק אם היא כבר
   ניתנה — דרך Permissions API, ואם הדפדפן אינו תומך בו, רק אחרי
   שמסך המסלול כבר החזיק נקודה. דמות שקופצת עם בקשת הרשאה היא בדיוק
   מה שגורם לאנשים לסרב.

   **אותם ספים של מסך המסלול.** 120 מטר, שתי קריאות רצופות, ודיוק
   טוב מ-200 מטר. שני מסכים שמחליטים "הגענו" בשני ספים שונים היו
   סותרים זה את זה מול אותו משתמש באותו רגע.

   **שאלה אחת בכל פעם, ורק כשיש מה לשאול.** הדמות אינה יושבת על המסך
   כקישוט: היא מופיעה כשיש לה משהו, גדלה כדי שישימו לב, ונעלמת כשענו
   לה. תור ההודעות נשמר במכשיר, ולכן יציאה מהאפליקציה באמצע ארוחה
   אינה מוחקת את השאלה שתגיע אחריה.
   ===================================================================== */

const TripGuide = (() => {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  קבועים — זהים למסך המסלול בכוונה                                   */
  /* ------------------------------------------------------------------ */

  const NEAR = 120;          // מטרים שמהם נחשב "הגענו"
  const GONE = 260;          // ומהם נחשב "עזבנו"
  const HITS = 2;            // קריאות רצופות שנדרשות להחלטה
  const ACC = 200;           // דיוק גרוע מזה אינו ראיה לכלום
  const STAY = 25 * 60e3;    // אחרי כך מותר לשאול "איך היה" גם בלי לעזוב
  const SKEY = "guide:v1";

  /* ------------------------------------------------------------------ */
  /*  מצב                                                               */
  /* ------------------------------------------------------------------ */

  let ctx = null;            // { days, today, dayOf, glyph }
  let el = null;             // השורש ב-DOM
  let watchId = null;
  let st = { visits: {}, rates: {} };
  let near = {};             // name -> קריאות רצופות בתוך הרדיוס
  let far = {};              // name -> קריאות רצופות מחוץ לרדיוס
  let open = false;          // האם הבועה פתוחה
  /**
   * ההודעה שמוצגת ברגע זה.
   *
   * מוחזקת ואינה מחושבת מחדש בכל ציור. `pending()` נגזר מהמצב, והמצב
   * משתנה תוך כדי האינטראקציה — ברגע שסימנתי "הברכה נאמרה", הברכה
   * שהמשתמש קורא **ברגע זה** הפסיקה להיות ההודעה הממתינה, והבועה
   * נעלמה מתחת לאצבע שלו. ההודעה מתחלפת רק כשהבועה סגורה.
   */
  let cur = null;
  let draft = 0;             // כוכבים שנבחרו ועדיין לא נשמרו
  let timer = null;

  const load = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(SKEY) || "null");
      if (raw && typeof raw === "object") {
        st = { visits: raw.visits || {}, rates: raw.rates || {} };
      }
    } catch { /* ריק */ }
  };
  const save = () => {
    try { localStorage.setItem(SKEY, JSON.stringify(st)); } catch { /* מלא */ }
  };

  /** מפתח ביקור: מקום **ביום מסוים**. אותה מסעדה מחר היא ביקור חדש. */
  const vkey = (date, name) => `${date}|${name}`;

  /* ------------------------------------------------------------------ */
  /*  מרחק                                                              */
  /* ------------------------------------------------------------------ */

  function metres(a, b) {
    if (!a || !b || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return null;
    const p = Math.PI / 180;
    const s =
      Math.sin(((b.lat - a.lat) * p) / 2) ** 2 +
      Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lng - a.lng) * p) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(s));
  }

  /* ------------------------------------------------------------------ */
  /*  המיקום                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * האם מותר לנו לעקוב.
   *
   * `permissions.query` הוא התשובה הישירה, ואינו קיים בכל דפדפן. בלעדיו
   * הנפילה אחורה היא נקודה שמסך המסלול כבר החזיק: אם יש כזו, ההרשאה
   * ניתנה. בשני המקרים **איננו קוראים ל-getCurrentPosition** — קריאה
   * כזו היא עצמה בקשת ההרשאה.
   */
  async function allowed() {
    if (!navigator.geolocation) return false;
    try {
      const p = await navigator.permissions?.query?.({ name: "geolocation" });
      if (p) return p.state === "granted";
    } catch { /* לא נתמך */ }
    return Boolean(typeof DayRoute !== "undefined" && DayRoute.where?.());
  }

  async function startWatch() {
    if (watchId !== null) return;
    if (!(await allowed())) return;
    watchId = navigator.geolocation.watchPosition(
      (p) => look(p.coords),
      () => { /* שקט: המלווה לא מתלונן, הוא פשוט לא יודע */ },
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 25000 }
    );
  }

  function stopWatch() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  /* ------------------------------------------------------------------ */
  /*  הגעה ועזיבה                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * כל קריאת מיקום נבחנת מול כל תחנות היום.
   *
   * לא רק מול "התחנה הבאה": אנשים מדלגים, חוזרים, ונכנסים למסעדה שהם
   * עברו לידה בבוקר. מי שבודק רק את התחנה הבאה מפספס בדיוק את הרגעים
   * שבהם ליווי שווה משהו.
   */
  function look(coords) {
    if (!ctx || !coords || coords.accuracy > ACC) return;
    const day = ctx.today();
    if (!day) return;
    const me = { lat: coords.latitude, lng: coords.longitude };

    for (const p of day.points || []) {
      if (!p?.name || !Number.isFinite(p.lat)) continue;
      const d = metres(me, p);
      if (d === null) continue;
      const k = vkey(day.date, p.name);
      const v = st.visits[k];

      if (d <= NEAR) {
        far[p.name] = 0;
        near[p.name] = (near[p.name] || 0) + 1;
        if (near[p.name] >= HITS && !v) {
          st.visits[k] = { at: Date.now(), greeted: false, asked: false };
          save();
          /* הגעה היא גם "היינו שם". בלי זה הדמות אמרה שהיא רואה
             שהגענו, ובמבט העל אותה תחנה נשארה לא מסומנת — שני מסכים
             שמספרים סיפור אחר על אותו רגע. */
          try { DayRoute?.mark?.(day.n, p.name, true); } catch { /* לא קריטי */ }
          ctx?.rated?.(p.name);
          queue();
        }
      } else if (d >= GONE) {
        near[p.name] = 0;
        far[p.name] = (far[p.name] || 0) + 1;
        if (far[p.name] >= HITS && v && !v.asked && !v.left) {
          v.left = Date.now();
          save();
          queue();
        }
      }
    }
    queue();
  }

  /* ------------------------------------------------------------------ */
  /*  מה יש לומר עכשיו                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * ההודעה הבאה בתור, או null.
   *
   * סדר העדיפות הוא לפי מה שדחוף למשתמש ולא לפי מה שקרה קודם: שאלת
   * "איך היה" על מקום שעזבנו עדיפה על ברכת הגעה למקום שאנחנו כבר בו —
   * הברכה תמתין, והשאלה תתיישן.
   */
  function pending() {
    const day = ctx?.today();
    if (!day) return null;
    const pts = (day.points || []).filter((p) => p?.name);
    const now = Date.now();

    for (const p of pts) {
      const v = st.visits[vkey(day.date, p.name)];
      if (v?.greeted && !v.asked && (v.left || now - v.at >= STAY)) {
        return { kind: "rate", day, point: p };
      }
    }
    for (const p of pts) {
      const v = st.visits[vkey(day.date, p.name)];
      if (v && !v.greeted) return { kind: "hi", day, point: p };
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /*  הניסוח                                                             */
  /* ------------------------------------------------------------------ */

  const FOOD = /מסעד|ארוחה|שוק|בר |פאב|קפה|יקב|מאפ/;

  function words(kind, p) {
    const food = p.type === "food" || FOOD.test(p.name);
    if (kind === "hi") {
      return food
        ? {
            title: "ראיתי שהגעתם",
            body: `${p.name} — מההמלצות שלי להיום. תיהנו, ואחר כך ספרו לי איך היה.`,
            ok: "סבבה",
          }
        : {
            title: "ראיתי שהגעתם",
            body: `${p.name}. קחו את הזמן; אשאל אחר כך מה דעתכם.`,
            ok: "סבבה",
          };
    }
    return food
      ? { title: "אז איך היה?", body: `${p.name} — שווה את זה?`, ok: "שמור" }
      : { title: "אז איך היה?", body: `${p.name} — שווה את העצירה?`, ok: "שמור" };
  }

  const STARS = ["", "חבל על הזמן בכיוון הלא נכון", "ככה ככה", "בסדר גמור", "ממש טוב", "מהטיול כולו"];

  /* ------------------------------------------------------------------ */
  /*  הציור                                                             */
  /* ------------------------------------------------------------------ */

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  /* דמות הולכת, מצוירת בקו אחד — אותו קו של הסמלים בתרשים היומי */
  const FIGURE =
    '<svg class="guide__fig" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path class="guide__head" d="M13.6 5.6a2.1 2.1 0 1 0 0-.01"/>' +
    '<path class="guide__body" d="M13.6 7.8v5.4"/>' +
    '<path class="guide__arm" d="M13.6 9.6 10 11.7M13.6 9.6l4.1 1"/>' +
    '<path class="guide__leg" d="m13.6 13.2-3.3 3.9L9 21.6M13.6 13.2l2.9 3.1 1.2 5.3"/>' +
    "</svg>";

  function render() {
    if (!el) return;
    const next = cur;

    if (!next) {
      el.hidden = true;
      el.classList.remove("is-talking", "is-waiting");
      open = false;
      return;
    }

    el.hidden = false;
    el.classList.toggle("is-talking", open);
    el.classList.toggle("is-waiting", !open);

    const w = words(next.kind, next.point);
    const rated = st.rates[next.point.name];

    el.innerHTML =
      `<button type="button" class="guide__who" data-guide-toggle
         aria-expanded="${open}" aria-label="${esc(w.title)}">${FIGURE}
         ${open ? "" : '<span class="guide__dot"></span>'}
       </button>` +
      (open
        ? `<div class="guide__bubble" role="dialog" aria-label="${esc(w.title)}">
             <button type="button" class="guide__x" data-guide-close aria-label="סגירה">✕</button>
             <b class="guide__ttl">${esc(w.title)}</b>
             <p class="guide__txt">${esc(w.body)}</p>
             ${
               next.kind === "rate"
                 ? `<div class="guide__stars" role="radiogroup" aria-label="דירוג">
                      ${[1, 2, 3, 4, 5]
                        .map(
                          (n) =>
                            `<button type="button" class="guide__star${
                              n <= draft ? " is-on" : ""
                            }" data-guide-star="${n}" role="radio"
                              aria-checked="${n === draft}" aria-label="${n} מתוך 5">★</button>`
                        )
                        .join("")}
                    </div>
                    <p class="guide__hint">${esc(draft ? STARS[draft] : "הקישו כוכבים")}</p>
                    <input class="guide__note" data-guide-note maxlength="90"
                      placeholder="מילה או שתיים (לא חובה)"
                      value="${esc(st.rates[next.point.name]?.note || "")}" />`
                 : ""
             }
             <div class="guide__acts">
               ${
                 next.kind === "rate"
                   ? `<button type="button" class="btn btn--sm" data-guide-skip>לא עכשיו</button>
                      <button type="button" class="btn btn--sm btn--primary" data-guide-save
                        ${draft ? "" : "disabled"}>${esc(w.ok)}</button>`
                   : `<button type="button" class="btn btn--sm btn--primary" data-guide-ok>${esc(w.ok)}</button>`
               }
             </div>
             ${rated ? `<p class="guide__was">דירגתם כבר: ${"★".repeat(rated.stars)}</p>` : ""}
           </div>`
        : "");
  }

  /* ------------------------------------------------------------------ */
  /*  התנהגות                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * הדמות מופיעה קטנה, ואז גדלה.
   *
   * הגדילה היא הסימן, לא ההופעה: אלמנט שמופיע פתאום בפינה נבלע בשאר
   * המסך, ואלמנט שזז נתפס בזווית העין. שתי פעימות ואז שקט — תנועה
   * שלא נגמרת היא הסחה, לא הודעה.
   */
  function queue() {
    // לא קופצים על מי שכבר מדבר עם הדמות
    if (open) { render(); return; }

    cur = pending();
    if (!cur) { render(); return; }

    const first = el && el.hidden;
    render();
    if (first) {
      el.classList.add("is-enter");
      setTimeout(() => el?.classList.remove("is-enter"), 1400);
      // רטט רק אם מסך המסלול סגור — אחרת הוא כבר רטט על אותה הגעה
      const routeOpen = typeof DayRoute !== "undefined" && DayRoute.isOpen?.();
      if (!routeOpen) { try { navigator.vibrate?.(40); } catch { /* אין */ } }
    }
  }

  function toggle() {
    if (!cur) return queue();
    open = !open;
    // סגירה בלי לענות משאירה את ההודעה ממתינה, עם הנקודה על הדמות
    if (open) draft = st.rates[cur.point.name]?.stars || 0;
    render();
  }

  function bind() {
    el.addEventListener("click", (e) => {
      const next = cur;
      if (!next) return;

      if (e.target.closest("[data-guide-toggle]")) return toggle();
      if (e.target.closest("[data-guide-close]")) { open = false; return render(); }

      if (e.target.closest("[data-guide-ok]")) {
        const v = st.visits[vkey(next.day.date, next.point.name)];
        if (v) { v.greeted = true; save(); }
        open = false;
        return queue();
      }

      const star = e.target.closest("[data-guide-star]");
      if (star) {
        draft = Number(star.dataset.guideStar);
        return render();
      }

      if (e.target.closest("[data-guide-skip]")) {
        const v = st.visits[vkey(next.day.date, next.point.name)];
        // "לא עכשיו" אינו "לא": השאלה תחזור בפתיחה הבאה של האפליקציה
        if (v) { v.left = Date.now(); }
        open = false;
        save();
        el.hidden = true;
        clearTimeout(timer);
        timer = setTimeout(() => queue(), 45 * 60e3);
        return;
      }

      if (e.target.closest("[data-guide-save]")) {
        if (!draft) return;
        const note = el.querySelector("[data-guide-note]")?.value?.trim() || "";
        st.rates[next.point.name] = {
          stars: draft,
          note: note.slice(0, 90),
          at: Date.now(),
          day: next.day.n,
        };
        const v = st.visits[vkey(next.day.date, next.point.name)];
        if (v) v.asked = true;
        save();
        open = false;
        draft = 0;
        ctx?.rated?.(next.point.name);
        return queue();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  חוץ                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * @param host.today  היום של היום מתוך הטיול, או null
   * @param host.rated  נקרא אחרי שמירת דירוג, כדי שהמסכים יתרעננו
   */
  function init(host) {
    ctx = host;
    el = document.getElementById("guide");
    if (!el) return;
    load();
    bind();
    queue();
    startWatch();

    // ברקע אין טעם לעקוב, ובחזרה למסך בודקים אם הצטברה שאלה
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopWatch();
      else { startWatch(); queue(); }
    });
  }

  /** הדירוג של מקום, למסכים שמציגים אותו */
  const rateOf = (name) => st.rates[String(name || "")] || null;

  /**
   * דיווח הגעה שלא בא מהמעקב שלנו.
   *
   * מסך המסלול מסמן הגעה בעצמו, ולפעמים לפנינו: הוא מבקש דיוק גבוה
   * ומקבל קריאות תכופות יותר. בלי החיבור הזה הדמות הייתה שותקת בדיוק
   * ברגע שבו המסך השני כבר ידע שהגענו — ובדפדפן שאין בו Permissions
   * API ושבו המעקב שלנו כלל לא התחיל, היא הייתה שותקת תמיד.
   */
  function arrived(name) {
    const day = ctx?.today();
    if (!day || !name) return;
    const k = vkey(day.date, name);
    if (st.visits[k]) return;
    st.visits[k] = { at: Date.now(), greeted: false, asked: false };
    save();
    queue();
  }

  return { init, rateOf, arrived, _look: look };
})();

if (typeof window !== "undefined") window.TripGuide = TripGuide;
