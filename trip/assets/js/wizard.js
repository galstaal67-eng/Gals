/* =========================================================================
   TripWizard — אשף הכנת הטיול.

   עד כה היה כאן טופס אחד: יעד, תאריכים, מי, מטבע — ומתוכו נוצר טיול עם
   ימים **ריקים**. כלומר האפליקציה ידעה לנהל טיול, ולא ידעה לתכנן אחד.

   כאן זה נגמר. האשף אוסף תדריך — סוג הטיול, היעדים לפי הסדר, התאריכים
   והשעות, מי נוסע, ובאיזה קצב ובאיזה סגנון — ומזמין את /api/plan לבנות
   ממנו מסלול אמיתי.

   ── שלוש החלטות ──

   **סוג הטיול הוא השאלה הראשונה, לא פרט טכני.** יום של טרק רגלי אינו
   יום עירוני עם נעליים אחרות: הוא מקטע עם אורך, עלייה מצטברת ולינה
   בסוף. סוג הטיול קובע מה נחשב יום סביר, ולכן הוא נשאל לפני היעדים.

   **כמה יעדים ולא אחד.** טיול הוא לא תמיד עיר. חלוקת הלילות בין
   היעדים היא מה שהופך רשימת ערים למסלול, ולכן היא נשאלת כאן ולא
   מנוחשת בשרת.

   **הבנייה מתנהלת מהלקוח, במנות.** שלד קצר קודם, ואז פירוט של שלושה
   ימים בכל קריאה. קריאה אחת שמייצרת טיול שלם חוצה את תקרת הזמן של
   פונקציה, והמשתמש יושב מול ספינר בלי לדעת אם משהו קורה. כך כל קריאה
   חוזרת תוך שניות, ויש התקדמות אמיתית להציג.
   ========================================================================= */

const TripWizard = (() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  /* ------------------------------------------------------------------ */
  /*  הקטלוגים                                                           */
  /* ------------------------------------------------------------------ */

  const KINDS = [
    { k: "city",    icon: "🏙️", t: "עיר",            d: "סופ\"ש או כמה ימים בעיר, ברגל ובתחבורה" },
    { k: "road",    icon: "🚗", t: "רוד־טריפ",        d: "נסיעה ברכב בין יעדים, עם עצירות בדרך" },
    { k: "trek",    icon: "🥾", t: "טרק רגלי",        d: "מקטעי הליכה, לינה לאורך המסלול" },
    { k: "cycle",   icon: "🚴", t: "אופניים",         d: "ימי רכיבה, מרחק ושיפועים" },
    { k: "moto",    icon: "🏍️", t: "אופנועים",        d: "כבישים מתפתלים, עצירות דלק וקפה" },
    { k: "caravan", icon: "🚐", t: "קרוואן",          d: "ואן או קרוואן, לינה באתרים" },
    { k: "resort",  icon: "🏖️", t: "ריזורט / בטן-גב", d: "בסיס אחד, ימים רגועים, הרבה זמן חופשי" },
    { k: "mixed",   icon: "🧭", t: "מעורב",           d: "קצת מהכול, לפי מה שהיעדים מזמינים" },
  ];

  const INTERESTS = [
    "אוכל", "שווקים", "היסטוריה", "מוזיאונים", "טבע", "נופים",
    "חופים", "יין", "אדריכלות", "חיי לילה", "קניות", "ספורט",
    "צילום", "מקומות פחות מוכרים", "עם ילדים",
  ];

  const PACE = [
    { k: "easy",   t: "רגוע",  d: "בוקר מאוחר, פחות עצירות" },
    { k: "normal", t: "רגיל",  d: "יום מלא אבל לא דחוס" },
    { k: "packed", t: "דחוס",  d: "מוציאים מהיום את המקסימום" },
  ];

  const BUDGET = [
    { k: "low",  t: "חסכוני" },
    { k: "mid",  t: "בינוני" },
    { k: "high", t: "נוח" },
  ];

  const LODGING = [
    { k: "hotel", t: "מלונות" }, { k: "apartment", t: "דירות" },
    { k: "hostel", t: "אכסניות" }, { k: "camp", t: "קמפינג" },
    { k: "refuge", t: "בקתות" }, { k: "mixed", t: "מעורב" },
  ];

  /** שלבי האשף, לפי הסדר */
  const STEPS = ["kind", "where", "when", "who", "how"];
  const STEP_TITLE = {
    kind: "איזה טיול",
    where: "לאן",
    when: "מתי",
    who: "מי",
    how: "איך",
  };

  /* ------------------------------------------------------------------ */
  /*  מצב                                                               */
  /* ------------------------------------------------------------------ */

  let ctx = null;            // { onDone }
  let el = null;
  let at = 0;                // השלב הנוכחי
  let b = null;              // התדריך
  let busy = null;           // מצב הבנייה: { step, of, note, err }
  let lookups = new Map();   // שם יעד -> הבטחה של איתור

  const blank = () => {
    const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const back = new Date(Date.now() + 34 * 864e5).toISOString().slice(0, 10);
    return {
      kind: "",
      stops: [{ name: "", nights: 3, place: null, state: "" }],
      from: soon, to: back,
      outTime: "", backTime: "",
      couples: 1,
      names: ["", ""],
      pace: "normal",
      interests: [],
      budget: "mid",
      lodging: "hotel",
      currency: "€",
      musts: "",
      limits: "",
      title: "",
    };
  };

  /* ------------------------------------------------------------------ */
  /*  עזרים                                                             */
  /* ------------------------------------------------------------------ */

  const days = () => {
    const a = Date.parse(b.from + "T12:00:00Z");
    const z = Date.parse(b.to + "T12:00:00Z");
    if (!Number.isFinite(a) || !Number.isFinite(z) || z < a) return 0;
    return Math.min(90, Math.round((z - a) / 864e5) + 1);
  };

  const nightsAsked = () =>
    b.stops.reduce((sum, s) => sum + (Math.max(1, Number(s.nights) || 1)), 0);

  /** היעדים שיש להם שם — רק הם נחשבים */
  const realStops = () => b.stops.filter((s) => s.name.trim());

  /**
   * איתור יעד. רץ פעם אחת לכל מחרוזת, ומה שלא אותר אינו עוצר דבר:
   * טיול בלי קואורדינטות ייבנה, אבל בלי מפה ובלי תחזית.
   */
  async function lookup(i) {
    const stop = b.stops[i];
    const q = (stop?.name || "").trim();
    if (!stop || q.length < 2) {
      if (stop) { stop.place = null; stop.state = ""; }
      return;
    }
    if (stop.place?.q === q) return;
    if (lookups.has(q)) {
      const hit = await lookups.get(q);
      stop.place = hit;
      stop.state = hit ? "" : "miss";
      return;
    }

    stop.state = "busy";
    paintStop(i);
    const run = (async () => {
      try {
        const res = await fetch(`/api/geo?q=${encodeURIComponent(q)}`);
        const data = await TripAPI.readJson(res);
        return data?.found ? { ...data.place, q } : null;
      } catch {
        return null;
      }
    })();
    lookups.set(q, run);

    const hit = await run;
    // המשתמש אולי כבר מחק את השורה או שינה את הטקסט
    if (b.stops[i] !== stop || stop.name.trim() !== q) return;
    stop.place = hit;
    stop.state = hit ? "" : "miss";
    paintStop(i);
  }

  /**
   * שורת האיתור של יעד אחד — ולא ציור מחדש של האשף.
   *
   * זה לא אופטימיזציה. האיתור מופעל ב-focusout, כלומר **בדיוק** ברגע
   * שהמשתמש עבר לשדה הבא; ציור מחדש שם מחליף את ה-DOM מתחת לאצבע,
   * והתו שהוקלד אחריו נכתב לאלמנט שכבר אינו בדף ונעלם.
   */
  function paintStop(i) {
    const row = el?.querySelector(`[data-wz-row="${i}"] .wz__stop-at`);
    if (row) row.innerHTML = stopNote(b.stops[i]);
  }

  /** כל האיתורים שעדיין רצים — לפני בנייה ממתינים להם */
  const allLookups = () => Promise.all([...lookups.values()]);

  /* ------------------------------------------------------------------ */
  /*  ולידציה לכל שלב                                                   */
  /* ------------------------------------------------------------------ */

  function problem(step) {
    if (step === "kind" && !b.kind) return "בחרו סוג טיול — זה מה שקובע איך נראה יום.";
    if (step === "where") {
      if (!realStops().length) return "צריך לפחות יעד אחד.";
    }
    if (step === "when") {
      if (!b.from || !b.to) return "צריך תאריך יציאה ותאריך חזרה.";
      if (b.to < b.from) return "תאריך החזרה מוקדם מתאריך היציאה.";
      if (!days()) return "טווח התאריכים אינו תקין.";
      if (days() > 60) return "הטווח ארוך מ-60 ימים — בדקו את התאריכים.";
    }
    if (step === "who") {
      const names = b.names.slice(0, b.couples * 2).filter((n) => n.trim());
      if (!names.length) return "צריך לפחות נוסע אחד — ההוצאות נרשמות על שמות.";
    }
    return "";
  }

  /* ------------------------------------------------------------------ */
  /*  הציור                                                             */
  /* ------------------------------------------------------------------ */

  function paint() {
    if (!el) return;
    if (busy) return paintBusy();

    const step = STEPS[at];
    const err = el.dataset.err || "";

    el.innerHTML = `
      <div class="ov-head">
        <h2>➕ טיול חדש</h2>
        <button type="button" class="icon-btn" data-wz-x aria-label="ביטול">✕</button>
      </div>

      <div class="wz__bar" role="progressbar" aria-valuemin="1"
           aria-valuemax="${STEPS.length}" aria-valuenow="${at + 1}">
        ${STEPS.map(
          (s, i) =>
            `<span class="wz__dot${i === at ? " is-on" : ""}${i < at ? " is-done" : ""}"
                   title="${esc(STEP_TITLE[s])}">${i + 1}</span>`
        ).join("")}
      </div>

      <div class="wz__body">
        <h3 class="wz__h">${esc(STEP_TITLE[step])}</h3>
        ${view(step)}
        ${err ? `<p class="wz__err">${esc(err)}</p>` : ""}
      </div>

      <div class="ov-foot wz__foot">
        <button type="button" class="btn" data-wz-prev>${at ? "חזרה" : "ביטול"}</button>
        ${
          at === STEPS.length - 1
            ? `<button type="button" class="btn" data-wz-empty>צור שלד ריק</button>
               <button type="button" class="btn btn--primary" data-wz-make>✨ בנה לי את הטיול</button>`
            : `<button type="button" class="btn btn--primary" data-wz-next>הבא</button>`
        }
      </div>`;
  }

  function view(step) {
    if (step === "kind") return viewKind();
    if (step === "where") return viewWhere();
    if (step === "when") return viewWhen();
    if (step === "who") return viewWho();
    return viewHow();
  }

  /* ---------- איזה טיול ---------- */

  const viewKind = () => `
    <p class="wz__lead">סוג הטיול קובע מה נחשב יום סביר — כמה ק"מ, כמה עצירות, ואיפה ישנים.</p>
    <div class="wz__kinds" role="radiogroup" aria-label="סוג הטיול">
      ${KINDS.map(
        (k) => `
        <button type="button" class="wz__kind${b.kind === k.k ? " is-on" : ""}"
                role="radio" aria-checked="${b.kind === k.k}" data-wz-kind="${k.k}">
          <span class="wz__kind-i" aria-hidden="true">${k.icon}</span>
          <b>${esc(k.t)}</b>
          <small>${esc(k.d)}</small>
        </button>`
      ).join("")}
    </div>`;

  /* ---------- לאן ---------- */

  function viewWhere() {
    const n = days();
    const asked = nightsAsked();
    const gap = n ? asked - (n - 1) : 0;
    return `
      <p class="wz__lead">יעד אחד או כמה, לפי סדר הנסיעה. מספר הלילות בכל יעד הוא
        מה שהופך רשימה למסלול.</p>
      <div class="wz__stops">
        ${b.stops
          .map(
            (s, i) => `
          <div class="wz__stop" data-wz-row="${i}">
            <span class="wz__stop-n">${i + 1}</span>
            <div class="wz__stop-main">
              <input type="text" data-wz-stop="${i}" value="${esc(s.name)}"
                     placeholder="עיר, אזור או נקודת מוצא" autocomplete="off" />
              <p class="wz__stop-at">${stopNote(s)}</p>
            </div>
            <label class="wz__stop-nights">לילות
              <input type="number" min="0" max="60" data-wz-nights="${i}" value="${esc(s.nights)}" />
            </label>
            <div class="wz__stop-acts">
              <button type="button" class="icon-btn" data-wz-up="${i}" ${i ? "" : "disabled"}
                      aria-label="הזזה למעלה">↑</button>
              <button type="button" class="icon-btn" data-wz-del="${i}"
                      ${b.stops.length > 1 ? "" : "disabled"} aria-label="מחיקה">🗑️</button>
            </div>
          </div>`
          )
          .join("")}
      </div>
      <button type="button" class="btn btn--sm" data-wz-add>➕ עוד יעד</button>
      ${
        n && gap
          ? `<p class="wz__hint">${
              gap > 0
                ? `ביקשתם ${asked} לילות והטיול הוא ${n - 1}. אתאים את החלוקה.`
                : `נשארו ${-gap} לילות בלי יעד. אחלק אותם בין היעדים שבחרתם.`
            }</p>`
          : ""
      }`;
  }

  function stopNote(s) {
    if (s.state === "busy") return "מאתר…";
    if (s.state === "miss") return "לא מצאתי את היעד הזה — אפשר להמשיך, אבל בלי מפה ותחזית.";
    if (s.place) {
      return `📍 ${esc([s.place.name, s.place.admin, s.place.country].filter(Boolean).join(", "))}`;
    }
    return "";
  }

  /* ---------- מתי ---------- */

  function viewWhen() {
    const n = days();
    return `
      <div class="wz__row">
        <label>יציאה <input type="date" data-wz-f="from" value="${esc(b.from)}" /></label>
        <label>חזרה <input type="date" data-wz-f="to" value="${esc(b.to)}" /></label>
      </div>
      <p class="wz__hint">${n ? `${n} ימים · ${Math.max(n - 1, 0)} לילות` : "בחרו תאריכים"}</p>

      <p class="wz__lead">השעות קובעות כמה נכנס ליום הראשון ולאחרון. אם עוד לא
        ידוע — אפשר להשאיר ריק.</p>
      <div class="wz__row">
        <label>שעת הגעה ליעד
          <input type="time" data-wz-f="outTime" value="${esc(b.outTime)}" /></label>
        <label>שעת יציאה חזרה
          <input type="time" data-wz-f="backTime" value="${esc(b.backTime)}" /></label>
      </div>`;
  }

  /* ---------- מי ---------- */

  function viewWho() {
    const slots = b.couples * 2;
    return `
      <div class="wz__choice" role="radiogroup" aria-label="הרכב הנוסעים">
        ${[
          { v: 1, t: "רק אנחנו", d: "זוג אחד — בלי קיזוז" },
          { v: 2, t: "שני זוגות", d: "עם קיזוז הוצאות בין הזוגות" },
        ]
          .map(
            (o) => `
          <button type="button" class="wz__opt${b.couples === o.v ? " is-on" : ""}"
                  role="radio" aria-checked="${b.couples === o.v}" data-wz-couples="${o.v}">
            <b>${esc(o.t)}</b><small>${esc(o.d)}</small>
          </button>`
          )
          .join("")}
      </div>
      <div class="wz__row wz__names">
        ${Array.from({ length: slots }, (_, i) => {
          const couple = i < 2 ? 1 : 2;
          return `<label>${b.couples > 1 ? `זוג ${couple} · ` : ""}נוסע ${((i % 2) + 1)}
            <input type="text" data-wz-name="${i}" value="${esc(b.names[i] || "")}"
                   placeholder="שם" autocomplete="off" /></label>`;
        }).join("")}
      </div>`;
  }

  /* ---------- איך ---------- */

  const chip = (on, attr, text) =>
    `<button type="button" class="wz__chip${on ? " is-on" : ""}" ${attr}
       aria-pressed="${on}">${esc(text)}</button>`;

  const viewHow = () => `
    <label class="wz__fld">שם הטיול <span class="muted">(לא חובה)</span>
      <input type="text" data-wz-f="title" value="${esc(b.title)}"
             placeholder="ברירת מחדל: שם היעד" autocomplete="off" /></label>

    <div class="wz__grp"><span class="wz__lbl">קצב</span>
      <div class="wz__chips">${PACE.map((p) => chip(b.pace === p.k, `data-wz-pace="${p.k}"`, `${p.t} · ${p.d}`)).join("")}</div>
    </div>

    <div class="wz__grp"><span class="wz__lbl">מה מעניין אתכם</span>
      <div class="wz__chips">${INTERESTS.map((t) => chip(b.interests.includes(t), `data-wz-int="${esc(t)}"`, t)).join("")}</div>
    </div>

    <div class="wz__grp"><span class="wz__lbl">תקציב</span>
      <div class="wz__chips">${BUDGET.map((x) => chip(b.budget === x.k, `data-wz-budget="${x.k}"`, x.t)).join("")}</div>
    </div>

    <div class="wz__grp"><span class="wz__lbl">לינה</span>
      <div class="wz__chips">${LODGING.map((x) => chip(b.lodging === x.k, `data-wz-lodging="${x.k}"`, x.t)).join("")}</div>
    </div>

    <label class="wz__fld">מטבע מקומי
      <select data-wz-f="currency">
        ${["€ אירו|€", "$ דולר|$", "£ ליש\"ט|£", "₪ שקל|₪", "₾ לארי|₾"]
          .map((o) => {
            const [t, v] = o.split("|");
            return `<option value="${v}" ${b.currency === v ? "selected" : ""}>${esc(t)}</option>`;
          })
          .join("")}
      </select></label>

    <label class="wz__fld">חובה שייכנס <span class="muted">(לא חובה)</span>
      <textarea data-wz-f="musts" rows="2"
        placeholder="מקום, אתר, מסעדה או יום שאתם לא מוותרים עליו">${esc(b.musts)}</textarea></label>

    <label class="wz__fld">מגבלות והעדפות <span class="muted">(לא חובה)</span>
      <textarea data-wz-f="limits" rows="2"
        placeholder="ללא גלוטן, קושי בהליכה, עם תינוק, בלי קימה מוקדמת…">${esc(b.limits)}</textarea></label>`;

  /* ---------- מסך הבנייה ---------- */

  function paintBusy() {
    const pct = busy.of ? Math.round((busy.step / busy.of) * 100) : 0;
    el.innerHTML = `
      <div class="ov-head"><h2>✨ בונה את הטיול</h2></div>
      <div class="wz__body wz__busy">
        <div class="wz__prog"><i style="inline-size:${pct}%"></i></div>
        <p class="wz__busy-txt">${esc(busy.note || "")}</p>
        ${busy.err ? `<p class="wz__err">${esc(busy.err)}</p>` : ""}
        ${
          busy.err
            ? `<div class="wz__acts">
                 <button type="button" class="btn" data-wz-back-edit>חזרה לתדריך</button>
                 <button type="button" class="btn btn--primary" data-wz-make>נסו שוב</button>
               </div>`
            : '<p class="muted sm">זה לוקח כחצי דקה. אפשר להשאיר את המסך פתוח.</p>'
        }
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /*  הבנייה                                                            */
  /* ------------------------------------------------------------------ */

  /** התדריך כפי שהשרת מקבל אותו */
  function brief() {
    const n = days();
    const stops = realStops();
    // חלוקת לילות: מה שהמשתמש ביקש, מנורמל לאורך הטיול בפועל
    const asked = stops.reduce((s, x) => s + Math.max(1, Number(x.nights) || 1), 0);
    const nights = Math.max(n - 1, 1);
    const scale = asked ? nights / asked : 1;
    let left = nights;
    const out = stops.map((s, i) => {
      const want = Math.max(1, Number(s.nights) || 1);
      const got = i === stops.length - 1 ? left : Math.max(1, Math.round(want * scale));
      left -= got;
      /* הקואורדינטות נשלחות עם היעד: השרת מחפש את המקומות **בתוך**
         תיבת היעד, ובלי תיבה הוא לא מוצא דבר — גם לא "תחנת סאו בנטו". */
      const p = s.place;
      return {
        name: s.name.trim(),
        nights: Math.max(1, got),
        ...(p && Number.isFinite(p.lat) ? { lat: p.lat, lng: p.lng } : {}),
      };
    });

    return {
      kind: b.kind,
      stops: out,
      from: b.from,
      to: b.to,
      outTime: b.outTime,
      backTime: b.backTime,
      pace: b.pace,
      interests: b.interests,
      budget: b.budget,
      lodging: b.lodging,
      travellers: b.names.slice(0, b.couples * 2).filter((x) => x.trim()).length || 2,
      currency: b.currency,
      musts: b.musts,
      limits: b.limits,
    };
  }

  async function call(payload) {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, code: localStorage.getItem("ai:code") || "" }),
    });
    const data = await TripAPI.readJson(res);
    if (!res.ok || !data || data.error) {
      throw new Error(data?.error || `הבנייה נכשלה (${res.status})`);
    }
    return data;
  }

  /** יוצר את המסמך הריק מהתדריך, ומחזיר אותו */
  function makeDoc() {
    const names = b.names.slice(0, b.couples * 2);
    const travellers = names
      .map((n, i) => ({ name: n.trim(), couple: i < 2 ? 1 : 2 }))
      .filter((t) => t.name);
    const stops = realStops().map((s) => ({
      name: s.name.trim(),
      nights: Math.max(1, Number(s.nights) || 1),
      place: s.place || null,
    }));
    return TripStore.create({
      title: b.title.trim() || stops[0]?.name || "טיול חדש",
      stops,
      kind: b.kind,
      from: b.from,
      to: b.to,
      outTime: b.outTime,
      backTime: b.backTime,
      currency: b.currency,
      notes: b.musts,
      travellers,
      brief: brief(),
    });
  }

  async function build() {
    busy = { step: 0, of: 1, note: "מאתר את היעדים…", err: "" };
    paint();
    await allLookups();

    const doc = makeDoc();
    const spec = brief();
    const n = days();
    // מנה של שלושה ימים בקריאה: קצר מספיק כדי לחזור, ארוך מספיק כדי
    // שהמודל יראה רצף ולא יום בודד מנותק
    const batches = [];
    for (let i = 1; i <= n; i += 3) {
      batches.push(Array.from({ length: Math.min(3, n - i + 1) }, (_, k) => i + k));
    }

    busy = { step: 0, of: batches.length + 1, note: `בונה את מבנה הטיול — ${n} ימים…`, err: "" };
    paint();

    try {
      const sk = (await call({ phase: "skeleton", brief: spec })).skeleton;
      busy.step = 1;
      TripStore.applyPlan(doc.id, sk, []);

      const all = [];
      for (const want of batches) {
        busy.note = `מפרט ${want.length > 1 ? `ימים ${want[0]}–${want[want.length - 1]}` : `יום ${want[0]}`} מתוך ${n}…`;
        paint();
        const got = await call({ phase: "detail", brief: spec, skeleton: sk, want });
        all.push(...(got.days || []));
        // שופכים כל מנה מיד: גם אם משהו ייפול בהמשך, מה שנבנה נשמר
        TripStore.applyPlan(doc.id, sk, got.days || []);
        busy.step++;
        paint();
      }

      const missed = all.flatMap((d) => d.unresolved || []);
      busy = null;
      ctx.onDone(TripStore.setActive(doc.id), { missed, note: sk.note || "" });
    } catch (e) {
      busy.err = e.message || "הבנייה נכשלה.";
      // המסמך כבר קיים ושמור. מי שלא רוצה לנסות שוב — יש לו טיול לערוך.
      busy.doneId = doc.id;
      paint();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  אירועים                                                           */
  /* ------------------------------------------------------------------ */

  function next() {
    const bad = problem(STEPS[at]);
    if (bad) { el.dataset.err = bad; return paint(); }
    el.dataset.err = "";
    at = Math.min(at + 1, STEPS.length - 1);
    paint();
  }

  function bind() {
    el.addEventListener("click", (e) => {
      const t = e.target;

      if (t.closest("[data-wz-x]")) return ctx.onCancel();
      if (t.closest("[data-wz-prev]")) {
        if (!at) return ctx.onCancel();
        at--; el.dataset.err = ""; return paint();
      }
      if (t.closest("[data-wz-next]")) return next();
      if (t.closest("[data-wz-back-edit]")) { busy = null; return paint(); }

      const kind = t.closest("[data-wz-kind]");
      if (kind) { b.kind = kind.dataset.wzKind; el.dataset.err = ""; paint(); return next(); }

      const add = t.closest("[data-wz-add]");
      if (add) { b.stops.push({ name: "", nights: 2, place: null, state: "" }); return paint(); }

      const del = t.closest("[data-wz-del]");
      if (del) {
        if (b.stops.length > 1) b.stops.splice(Number(del.dataset.wzDel), 1);
        return paint();
      }
      const up = t.closest("[data-wz-up]");
      if (up) {
        const i = Number(up.dataset.wzUp);
        if (i > 0) b.stops.splice(i - 1, 0, b.stops.splice(i, 1)[0]);
        return paint();
      }

      const cp = t.closest("[data-wz-couples]");
      if (cp) { b.couples = Number(cp.dataset.wzCouples); return paint(); }

      const pace = t.closest("[data-wz-pace]");
      if (pace) { b.pace = pace.dataset.wzPace; return paint(); }

      const bud = t.closest("[data-wz-budget]");
      if (bud) { b.budget = bud.dataset.wzBudget; return paint(); }

      const lod = t.closest("[data-wz-lodging]");
      if (lod) { b.lodging = lod.dataset.wzLodging; return paint(); }

      const int = t.closest("[data-wz-int]");
      if (int) {
        const v = int.dataset.wzInt;
        const i = b.interests.indexOf(v);
        if (i >= 0) b.interests.splice(i, 1);
        else b.interests.push(v);
        return paint();
      }

      if (t.closest("[data-wz-make]")) {
        const bad = STEPS.map(problem).find(Boolean);
        if (bad) { el.dataset.err = bad; busy = null; at = STEPS.findIndex((s) => problem(s)); return paint(); }
        return build();
      }

      if (t.closest("[data-wz-empty]")) {
        const bad = STEPS.map(problem).find(Boolean);
        if (bad) { el.dataset.err = bad; at = STEPS.findIndex((s) => problem(s)); return paint(); }
        return allLookups().then(() => ctx.onDone(makeDoc(), { missed: [], note: "" }));
      }
    });

    el.addEventListener("input", (e) => {
      const t = e.target;
      const f = t.dataset.wzF;
      if (f) { b[f] = t.value; if (f === "from" || f === "to") paintHint(); return; }

      const si = t.dataset.wzStop;
      if (si !== undefined) { b.stops[Number(si)].name = t.value; return; }

      const ni = t.dataset.wzNights;
      if (ni !== undefined) { b.stops[Number(ni)].nights = t.value; return; }

      const nm = t.dataset.wzName;
      if (nm !== undefined) { b.names[Number(nm)] = t.value; return; }
    });

    // איתור היעד קורה ביציאה מהשדה, לא בכל הקשה
    el.addEventListener("focusout", (e) => {
      const si = e.target.dataset?.wzStop;
      if (si !== undefined) lookup(Number(si));
    });
  }

  /** עדכון שורת האורך בלי לצייר מחדש — אחרת שדה התאריך מאבד מיקוד */
  function paintHint() {
    const hint = el.querySelector(".wz__hint");
    if (!hint) return;
    const n = days();
    hint.textContent = n ? `${n} ימים · ${Math.max(n - 1, 0)} לילות` : "בחרו תאריכים";
  }

  /* ------------------------------------------------------------------ */
  /*  חוץ                                                                */
  /* ------------------------------------------------------------------ */

  function init(host) {
    ctx = host;
    el = document.getElementById("tripsWizard");
    if (el) bind();
  }

  function open() {
    if (!el) return;
    at = 0;
    b = blank();
    busy = null;
    lookups = new Map();
    el.dataset.err = "";
    paint();
  }

  return { init, open, KINDS };
})();

if (typeof window !== "undefined") window.TripWizard = TripWizard;
