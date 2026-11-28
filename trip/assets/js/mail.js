/* =========================================================================
   ייבוא מסמכי הטיול מהמייל.

   מה זה עושה: מחפש בתיבת ה-Gmail כרטיסי עלייה, כרטיסי טיסה ואישורי
   הזמנה סביב תאריכי הטיול, ומייבא את הקובץ עצמו למכשיר — משם הוא כבר
   מתנהג כמו כל מסמך אחר: נפתח ככרטיס עלייה, נקרא על ידי העוזר, ומוצג
   ביום הרלוונטי.

   **הקריאה מתבצעת בדפדפן בלבד.** אסימון הגישה נשאר במכשיר, המיילים
   נקראים ישירות מול Google, ושום דבר מהם לא עובר דרך השרת של האתר.
   זה לא קישוט: האתר הזה פתוח לכל מי שיש לו את הכתובת, ותיבת מייל היא
   הדבר האחרון שצריך לשבת מאחורי API בלי הגנה.

   ההרשאה המבוקשת היא `gmail.readonly` — קריאה בלבד. אין כאן שליחה,
   מחיקה או סימון.

   למה צריך Client ID משלכם: חיבור ל-Gmail מחייב זיהוי של האפליקציה מול
   Google, וזיהוי כזה שייך לחשבון שמחובר אליו. אין כאן "מפתח של האתר"
   שאפשר לחלק — ולכן מי שרוצה את התכונה יוצר Client ID בחשבון שלו
   (חינם, כמה דקות) ומדביק אותו כאן. הוא נשמר במכשיר בלבד.
   ========================================================================= */

const MailImport = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const ID_KEY = "mail:clientId";
  const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
  const API = "https://gmail.googleapis.com/gmail/v1/users/me";
  const GIS = "https://accounts.google.com/gsi/client";

  let host = null;          // { getTrip, onImported }
  let token = null;         // { value, until }
  let client = null;        // GIS token client
  let found = [];           // ההודעות שנמצאו בחיפוש האחרון

  const clientId = () => (localStorage.getItem(ID_KEY) || "").trim();

  /* ------------------------------------------------------------------ */
  /*  התחברות                                                            */
  /* ------------------------------------------------------------------ */

  function loadGis() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = GIS;
      el.async = true;
      el.onload = resolve;
      el.onerror = () => reject(new Error("הספרייה של Google לא נטענה. יש חיבור לרשת?"));
      document.head.appendChild(el);
    });
  }

  const live = () => token && token.until > Date.now() + 30_000;

  /**
   * מבקש אסימון גישה. בפעם הראשונה Google מציג חלון הרשאה; אחר כך
   * החידוש שקט. האסימון חי בזיכרון בלבד — לא ב-localStorage ולא בשרת,
   * כך שסגירת הלשונית מסיימת את הגישה.
   */
  async function connect() {
    const id = clientId();
    if (!id) throw new Error("חסר Client ID.");
    if (live()) return token.value;

    await loadGis();
    return new Promise((resolve, reject) => {
      client = google.accounts.oauth2.initTokenClient({
        client_id: id,
        scope: SCOPE,
        callback: (res) => {
          if (res.error) return reject(new Error(res.error_description || res.error));
          token = { value: res.access_token, until: Date.now() + (res.expires_in || 3600) * 1000 };
          resolve(token.value);
        },
        error_callback: (err) => reject(new Error(err?.message || "ההתחברות בוטלה.")),
      });
      client.requestAccessToken({ prompt: live() ? "" : "consent" });
    });
  }

  async function api(path) {
    const res = await fetch(`${API}${path}`, {
      headers: { authorization: `Bearer ${token.value}` },
    });
    if (res.status === 401 || res.status === 403) {
      token = null;
      throw new Error("ההרשאה פגה או נדחתה. התחברו שוב.");
    }
    if (!res.ok) throw new Error(`Gmail החזיר שגיאה (${res.status}).`);
    return res.json();
  }

  /* ------------------------------------------------------------------ */
  /*  בניית החיפוש                                                       */
  /* ------------------------------------------------------------------ */

  const gdate = (iso) => iso.replace(/-/g, "/");

  function shift(iso, days) {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /**
   * חלון התאריכים: מההזמנה ועד יום אחרי החזרה.
   * כרטיס טיסה נקנה לפעמים חצי שנה מראש, וכרטיס עלייה מגיע יום לפני —
   * ולכן החלון רחב לאחור וצר קדימה.
   */
  function window_(trip) {
    const days = trip.days || [];
    const start = (trip.meta?.startDate || days[0]?.date || "").slice(0, 10);
    const end = (trip.meta?.endDate || days[days.length - 1]?.date || "").slice(0, 10);
    if (!start || !end) return "";
    return `after:${gdate(shift(start, -300))} before:${gdate(shift(end, 2))}`;
  }

  const FLIGHT =
    '(subject:(boarding OR "boarding pass" OR "כרטיס עלייה" OR "e-ticket" OR eticket OR ' +
    '"כרטיס טיסה" OR "כרטיס הטיסה" OR itinerary OR flight OR טיסה OR "אישור טיסה") ' +
    'OR from:(elal.co.il OR israir.co.il OR arkia.co.il OR wizzair.com OR ryanair.com OR ' +
    "georgian-airways.com OR aegeanair.com OR turkishairlines.com))";

  const STAY =
    "(from:(booking.com OR airbnb.com OR agoda.com OR expedia.com OR hotels.com OR trivago.com) " +
    'OR subject:("אישור הזמנה" OR "הזמנה אושרה" OR confirmation OR reservation OR "booking confirmed"))';

  /** היעד עצמו — שם העיר, שם המלון וקודי השדות שבמסמך הטיול */
  function place(trip) {
    const bits = new Set();
    const add = (v) => {
      const s = String(v || "").trim();
      if (s.length > 2) bits.add(`"${s.replace(/"/g, "")}"`);
    };
    add(trip.meta?.title);
    add(trip.days?.[0]?.hotel?.name);
    ["out", "back"].forEach((k) => {
      const leg = trip.flights?.[k];
      (String(leg?.from || "") + " " + String(leg?.to || "")).match(/\b[A-Z]{3}\b/g)?.forEach((c) => bits.add(c));
    });
    return bits.size ? `(${[...bits].join(" OR ")})` : "";
  }

  function query(kind, trip) {
    const win = window_(trip);
    if (kind === "flights") return `${FLIGHT} ${win}`.trim();
    if (kind === "stays") return `${STAY} ${win}`.trim();
    if (kind === "place") return `${place(trip)} ${win}`.trim();
    return `(${FLIGHT} OR ${STAY}) ${win}`.trim();
  }

  /* ------------------------------------------------------------------ */
  /*  קריאת ההודעות                                                      */
  /* ------------------------------------------------------------------ */

  const header = (msg, name) =>
    (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === name)?.value || "";

  /** פירוק base64url של Gmail לבייטים */
  function bytes(b64url) {
    const b64 = String(b64url || "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** HTML → טקסט קריא, בלי סקריפטים וסגנונות */
  function strip(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, head").forEach((el) => el.remove());
    return (doc.body?.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  /** עובר על עץ החלקים ואוסף קבצים מצורפים וגוף טקסט */
  function walk(part, acc) {
    if (!part) return acc;
    const name = part.filename || "";
    if (name && part.body?.attachmentId) {
      acc.files.push({
        name,
        id: part.body.attachmentId,
        type: part.mimeType || "application/octet-stream",
        size: part.body.size || 0,
      });
    } else if (part.body?.data && (part.mimeType === "text/plain" || part.mimeType === "text/html")) {
      const raw = new TextDecoder().decode(bytes(part.body.data));
      // אישור של Booking מגיע לא פעם כ-HTML בלבד. טקסט גולמי עם תגיות
      // הוא רעש למודל, ולכן מפרקים אותו — וגרסת ה-plain תמיד מנצחת
      const text = part.mimeType === "text/html" ? strip(raw) : raw;
      if (!acc.text || part.mimeType === "text/plain") acc.text = text;
    }
    (part.parts || []).forEach((p) => walk(p, acc));
    return acc;
  }

  async function search(kind) {
    const trip = host.getTrip();
    const q = kind === "free" ? $("#mailQ").value.trim() : query(kind, trip);
    if (!q) throw new Error("אין מה לחפש.");

    $("#mailQ").value = q;
    const list = await api(`/messages?maxResults=12&q=${encodeURIComponent(q)}`);
    const ids = (list.messages || []).map((m) => m.id);

    found = [];
    for (const id of ids) {
      const msg = await api(`/messages/${id}?format=full`);
      const acc = walk(msg.payload, { files: [], text: "" });
      found.push({
        id,
        subject: header(msg, "subject") || "(בלי נושא)",
        from: header(msg, "from"),
        date: header(msg, "date"),
        snippet: msg.snippet || "",
        files: acc.files,
        text: acc.text,
      });
    }
    return found;
  }

  /* ------------------------------------------------------------------ */
  /*  ייבוא                                                              */
  /* ------------------------------------------------------------------ */

  /** קובץ מצורף → File, מוכן לשמירה במכשיר או לקריאה בעוזר */
  async function fileOf(msg, att) {
    const data = await api(`/messages/${msg.id}/attachments/${att.id}`);
    return new File([bytes(data.data)], att.name, { type: att.type });
  }

  /** גוף המייל כקובץ טקסט — אישור של Booking הוא לרוב גוף, לא צרופה */
  function bodyFile(msg) {
    const head = `${msg.subject}\nמאת: ${msg.from}\nתאריך: ${msg.date}\n\n`;
    const name = (msg.subject.slice(0, 40).replace(/[\\/:*?"<>|]/g, "") || "mail") + ".txt";
    return new File([head + (msg.text || msg.snippet)], name, { type: "text/plain" });
  }

  /**
   * מה שמיובא נשלח לעוזר, ולא נשמר ישירות.
   *
   * זה אותו מסלול בדיוק של צירוף קובץ ביד: העוזר קורא את המסמך, מציע
   * מה להכניס לטיול, שואל אם משהו לא ברור — והשמירה במכשיר קורית רק
   * באישור. כך אין כאן דרך שנייה להכניס דברים לטיול, עם כללים אחרים.
   */
  async function take(msg, att) {
    const file = att ? await fileOf(msg, att) : bodyFile(msg);
    close();
    TripAI.openWith([file], att ? "" : `מהמייל: ${msg.subject}`);
  }

  /* ------------------------------------------------------------------ */
  /*  תצוגה                                                              */
  /* ------------------------------------------------------------------ */

  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(n / 1024)) + "KB");

  function note(text, bad) {
    const el = $("#mailNote");
    el.textContent = text || "";
    el.className = "mail__note" + (bad ? " is-bad" : "");
    el.hidden = !text;
  }

  function setup() {
    const has = Boolean(clientId());
    $("#mailSetup").hidden = has;
    $("#mailMain").hidden = !has;
    $("#mailId").value = clientId();
  }

  function renderResults() {
    const box = $("#mailResults");
    if (!found.length) {
      box.innerHTML = '<p class="muted sm">לא נמצאו מיילים מתאימים בחלון התאריכים של הטיול.</p>';
      return;
    }
    box.innerHTML = found
      .map((m, i) => {
        const atts = m.files
          .map(
            (f, j) => `<button class="btn btn--sm btn--primary" data-mail-take="${i}" data-att="${j}">
                 📎 ${esc(f.name)} <span class="muted sm">${esc(kb(f.size))}</span>
               </button>`
          )
          .join("");
        return `<article class="mail__row">
          <b>${esc(m.subject)}</b>
          <span class="mail__from">${esc(m.from)}</span>
          <p class="mail__snip">${esc(m.snippet.slice(0, 120))}</p>
          <div class="mail__acts">
            ${atts}
            <button class="btn btn--sm" data-mail-take="${i}">תוכן המייל</button>
          </div>
        </article>`;
      })
      .join("");
  }

  async function run(fn) {
    const box = $("#mailResults");
    note("");
    box.innerHTML = '<p class="muted sm">מחפש…</p>';
    try {
      await connect();
      await fn();
      renderResults();
    } catch (err) {
      box.innerHTML = "";
      note(err.message || "החיפוש נכשל.", true);
    }
  }

  /* ------------------------------------------------------------------ */

  function open() {
    setup();
    note("");
    found = [];
    $("#mailResults").innerHTML =
      '<p class="muted sm">בחרו מה לחפש. החיפוש מוגבל לחלון התאריכים של הטיול הפעיל.</p>';
    $("#mailOverlay").hidden = false;
  }

  function close() {
    $("#mailOverlay").hidden = true;
  }

  function init(hostApi) {
    host = hostApi;
    const ov = $("#mailOverlay");

    ov.addEventListener("click", async (e) => {
      if (e.target === ov || e.target.closest("[data-mail-close]")) return close();

      if (e.target.closest("[data-mail-save-id]")) {
        const v = $("#mailId").value.trim();
        if (!v.endsWith(".apps.googleusercontent.com")) {
          return note("ה-Client ID נראה שגוי — הוא מסתיים ב-.apps.googleusercontent.com", true);
        }
        localStorage.setItem(ID_KEY, v);
        token = null;
        setup();
        note("נשמר. אפשר לחפש.");
        return;
      }
      if (e.target.closest("[data-mail-forget]")) {
        localStorage.removeItem(ID_KEY);
        token = null;
        setup();
        return;
      }

      const find = e.target.closest("[data-mail-find]");
      if (find) return run(() => search(find.dataset.mailFind));

      const take_ = e.target.closest("[data-mail-take]");
      if (take_) {
        const msg = found[Number(take_.dataset.mailTake)];
        const att = "att" in take_.dataset ? msg.files[Number(take_.dataset.att)] : null;
        take_.disabled = true;
        try {
          await take(msg, att);
        } catch (err) {
          take_.disabled = false;
          note(err.message || "הייבוא נכשל.", true);
        }
      }
    });

    $("#mailQ").addEventListener("keydown", (e) => {
      if (e.key === "Enter") run(() => search("free"));
    });
  }

  return { init, open, close };
})();
