/* =========================================================================
   מסך המסלול היומי — "יוצאים".

   עד כאן המסלול היה **רשימה**: כל היום פרוש לפניך, וכל נקודה שווה לכל
   אחרת. זה טוב לתכנון בערב, וזה לא מה שצריך כשאתה עומד בדלת המלון
   בשתיים עשרה בצהריים. אז יש שאלה אחת: **לאן עכשיו**, ואחריה עוד אחת:
   **מה אחר כך**.

   ── מה המסך הזה עושה ──
   · פתיחה שלו היא היציאה מהמלון. השעה נרשמת, ואם התוכנית כתובה לשעה
     אחרת — הוא מציע להזיז את היום לשעה הזו, כי תוכנית ל-08:30 שמתחילה
     ב-12:00 שקרית בכל שורה.
   · תחנה אחת על המסך, גדולה: לאן הולכים, מה עושים שם, מתי, ומה הבא.
   · ניווט **לתחנה הזו בלבד** — ולא מסלול של כל היום. מי שעומד ליד
     האופרה לא צריך הנחיות שמתחילות בכיכר החירות.
   · מפה של Google עם תוויות בעברית. המפה שבלשונית המסלול היא OSM,
     ובטביליסי התוויות שלה בכתב גאורגי — אי אפשר לקרוא אותה.
   · מיקום חי מהדפדפן: כמה מטרים נשארו, ואישור אוטומטי של תחנה שהגעת
     אליה. מה שנעשה מסומן, מה שלא — לא.

   ── מה שאי אפשר ──
   אין דרך "להתחבר ל-Google Maps של המשתמש": גוגל אינה חושפת את המיקום
   החי של חשבון לאפליקציה אחרת. מה שכן אפשר, וזה אותו דבר בפועל, הוא
   `navigator.geolocation` — אותו GPS, באישור מפורש, בלי חשבון.
   ========================================================================= */

const DayRoute = (() => {
  const SKEY = (date) => `route:${date}`;
  const GKEY = "gmaps:key";          // מפתח Embed API, אם המשתמש הזין
  const NEAR = 120;                  // מטרים שמהם נחשב "הגעת"
  const WALK = 4.5;                  // קמ"ש הליכה בעיר, כולל רמזורים
  const DRIVE = 22;                  // קמ"ש ברכב בעיר, כולל פקקים

  let ctx = null;                    // מה שהאפליקציה מספקת
  let st = null;                     // מצב היום הפתוח
  let el = null;                     // האלמנט של השכבה
  let watchId = null;
  let pos = null;                    // GeolocationPosition.coords
  let geoErr = "";
  let nearHits = 0;                  // קריאות רצופות בתוך הרדיוס
  let askShift = false;              // האם ההצעה להזיז את היום פתוחה
  let tick = null;
  let openList = false;              // האם הרשימה המלאה פרושה
  let showAll = false;               // האם רשימת ההתראות שנסגרו פתוחה

  /**
   * **איפה אני** ו**במה אני מסתכל** הם שני דברים.
   *
   * `st.idx` הוא המקום שבו אני באמת עומד. `view` הוא התחנה שהכרטיס
   * הגדול מציג. מי שרוצה לראות מה מחכה בתחנה הרביעית לא אמור לשלם על
   * זה בכך שהמסך "ישכח" איפה הוא — ולכן הצצה קדימה אינה מזיזה את
   * המיקום, ויש פס שמזכיר שזו לא התחנה שלך ומחזיר אליה בלחיצה.
   */
  let view = null;                   // null = עוקב אחרי st.idx

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (m) => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`;
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  /* ------------------------------------------------------------------ */
  /*  מרחקים                                                            */
  /* ------------------------------------------------------------------ */

  /** מטרים בין שתי נקודות. Haversine — מדויק דיו לעיר. */
  function metres(a, b) {
    if (!a || !b) return null;
    const R = 6371000;
    const p = Math.PI / 180;
    const dLat = (b.lat - a.lat) * p;
    const dLng = (b.lng - a.lng) * p;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(s)));
  }

  const human = (m) =>
    m === null ? "" : m < 950 ? `${m} מ'` : `${(m / 1000).toFixed(1)} ק"מ`;

  /**
   * כמה זמן זה לוקח — ובאיזו דרך.
   *
   * קו אווירי אינו מסלול, ולכן מוסיפים 25%: רחובות אינם ישרים. מעל
   * קילומטר וחצי זו כבר לא הליכה שעושים בלי להתכוון אליה, ואז נאמר גם
   * מה זה ברכב.
   */
  function travel(m) {
    if (m === null) return null;
    const km = (m * 1.25) / 1000;
    const walk = Math.max(1, Math.round((km / WALK) * 60));
    const drive = Math.max(1, Math.round((km / DRIVE) * 60));
    /*
     * שלושה מרחקים ושלוש תשובות. "225 דקות הליכה" הוא מספר נכון
     * שאינו עצה: לשלושה עשר קילומטר לא הולכים, ומי שקורא את זה למד
     * רק שהמסך לא מבין מה הוא שואל.
     */
    const far = m > 2500;        // מכאן זו כבר נסיעה
    const hike = m <= 4000;      // מעבר לזה הליכה אינה אופציה
    return { walk, drive, far, hike, mode: far ? "driving" : "walking" };
  }

  /** "11 דק' הליכה", או "18 דק' ברכב · 24 דק' הליכה" */
  function travelText(t) {
    if (!t) return "";
    if (!t.far) return `${t.walk} דק' הליכה`;
    return `${t.drive} דק' ברכב${t.hike ? ` · ${t.walk} דק' הליכה` : ""}`;
  }

  /* ------------------------------------------------------------------ */
  /*  מצב                                                               */
  /* ------------------------------------------------------------------ */

  function load(day) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SKEY(day.date)) || "null"); } catch { /* ריק */ }
    if (saved && saved.n === day.n) return saved;
    return { n: day.n, date: day.date, startedAt: null, idx: 0, done: [] };
  }

  function save() {
    if (!st) return;
    try { localStorage.setItem(SKEY(st.date), JSON.stringify(st)); } catch { /* מלא */ }
  }

  /**
   * מה נחשב תחנה במסלול היומי.
   *
   * לא כל נקודה ביום היא תחנה שהולכים אליה. שדה תעופה הוא איך הגענו,
   * והמלון הוא **מאיפה יצאנו** — פתיחת המסך הזה היא היציאה ממנו. מי
   * שעומד בלובי לא צריך הנחיה "לך למלון". אם יש חזרה אליו, היא נאמרת
   * בשורה האחרונה, ולא כעצירה שצריך לנווט אליה.
   */
  function stops(day) {
    return (day.points || []).filter(
      (p) =>
        p && p.name &&
        Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
        ctx.inDest(p) &&
        p.type !== "airport" &&
        p.type !== "hotel"
    );
  }

  /* ------------------------------------------------------------------ */
  /*  פתיחה וסגירה                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * פתיחת המסך היא היציאה למסלול.
   *
   * זו הסיבה שהשעה נרשמת כאן ולא בכפתור נפרד: אף אחד לא לוחץ "יצאתי"
   * כשהוא יוצא, אבל כולם פותחים את המסלול כשהם יוצאים.
   */
  function open(n) {
    const day = ctx.day(n);
    if (!day) return;

    st = load(day);
    if (!st.startedAt) {
      st.startedAt = Date.now();
      save();
    }

    // התוכנית אומרת שעה אחת, השעון אומר אחרת — שואלים פעם אחת
    const from = firstStopTime(day);
    askShift = Boolean(from) && Math.abs(ctx.min(from) - nowMin()) >= 20;

    view = null;
    openList = false;
    showAll = false;
    el.hidden = false;
    document.body.classList.add("is-locked");
    render();
    startGeo();
    clearInterval(tick);
    tick = setInterval(render, 30000);
  }

  function close() {
    el.hidden = true;
    document.body.classList.remove("is-locked");
    stopGeo();
    clearInterval(tick);
    tick = null;
    st = null;
    ctx.changed();
  }

  const isOpen = () => Boolean(st) && !el.hidden;

  /* ------------------------------------------------------------------ */
  /*  מיקום חי                                                          */
  /* ------------------------------------------------------------------ */

  function startGeo() {
    if (watchId !== null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        pos = p.coords;
        geoErr = "";
        autoArrive();
        render();
      },
      (e) => {
        geoErr =
          e.code === 1 ? "אין הרשאת מיקום"
          : e.code === 3 ? "המיקום לא נקלט"
          : "שגיאת מיקום";
        render();
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
  }

  function stopGeo() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    pos = null;
    geoErr = "";
    nearHits = 0;
  }

  /**
   * סימון אוטומטי של תחנה שהגעת אליה.
   *
   * שתי קריאות רצופות ולא אחת: GPS בעיר צפופה קופץ, וקפיצה אחת למאה
   * מטר מהאופרה אינה סיבה לסמן שהיית בה. גם דיוק גרוע מ-200 מ' אינו
   * ראיה לכלום, ואז לא נוגעים בכלום.
   */
  function autoArrive() {
    const day = ctx.day(st?.n);
    const list = day ? stops(day) : [];
    const cur = list[st?.idx];
    if (!cur || !pos || pos.accuracy > 200) { nearHits = 0; return; }

    const d = metres({ lat: pos.latitude, lng: pos.longitude }, cur);
    if (d !== null && d <= NEAR) {
      nearHits++;
      if (nearHits >= 2) { arrive(true); nearHits = 0; }
    } else {
      nearHits = 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  התקדמות                                                           */
  /* ------------------------------------------------------------------ */

  const viewIdx = (list) => {
    const i = view === null ? st.idx : view;
    return Math.max(0, Math.min(i, list.length - 1));
  };

  function arrive(auto) {
    const day = ctx.day(st.n);
    const list = stops(day);
    if (!list.length) return;
    if (!st.done.includes(st.idx)) st.done.push(st.idx);
    if (st.idx < list.length - 1) st.idx++;
    st.auto = Boolean(auto);
    view = null;                       // הגעה מחזירה את המבט למקום שבו אני
    save();
    render();
  }

  /** הצצה בתחנה — מזיזה את המבט בלבד */
  function peek(i) {
    view = i === st.idx ? null : i;
    render();
  }

  /** "אני כאן" — הזזה של המיקום עצמו, מתוך הפס העליון */
  function jump(i) {
    st.idx = i;
    st.done = st.done.filter((x) => x < i);
    view = null;
    save();
    render();
  }

  function undo(i) {
    st.done = st.done.filter((x) => x !== i);
    st.idx = i;
    view = null;
    save();
    render();
  }

  /* ------------------------------------------------------------------ */
  /*  קישורי ניווט                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * ניווט **לתחנה אחת**.
   *
   * בלי `origin`, כדי שהמפות יתחילו מאיפה שאתה עומד — זה המקור היחיד
   * שאינו ניחוש. היעד נשלח גם כשם וגם כנ"צ: נ"צ לבד נותנת סיכה בלי
   * כרטיס מקום, ושם לבד עלול לנחות על מקום אחר באותו שם.
   */
  function navLink(p, mode) {
    /*
     * היעד נשלח כנ"צ ולא כשם. שם הוא חיפוש, וחיפוש יכול לנחות על
     * מקום אחר באותו שם — בניווט זו טעות שעולה בזמן ובכסף. את כרטיס
     * המקום (שעות, ביקורות, תמונות) נותן הקישור "על המקום" שלצידו,
     * ושם השם דווקא נחוץ.
     */
    return (
      `https://www.google.com/maps/dir/?api=1` +
      `&destination=${encodeURIComponent(`${p.lat},${p.lng}`)}` +
      `&travelmode=${mode || "walking"}`
    );
  }

  /**
   * המפה שבמסך — Google Maps אמיתי, עם תוויות בעברית.
   *
   * עם מפתח Embed API משתמשים ב-API הרשמי, שיודע לצייר את המסלול עצמו.
   * בלי מפתח יש את `output=embed`, שגוגל מגישה בלי מפתח מאז ומתמיד אך
   * אינה מתחייבת עליה. לכן יש כפתור שמחליף למפה של האפליקציה — תמיד
   * יש מפה, גם אם אחת מהשתיים תיפול.
   */
  function mapSrc(p) {
    const key = (localStorage.getItem(GKEY) || "").trim();
    const me = pos ? `${pos.latitude},${pos.longitude}` : "";
    const dest = `${p.lat},${p.lng}`;
    const t = pos ? travel(metres({ lat: pos.latitude, lng: pos.longitude }, p)) : null;
    const drive = Boolean(t && t.far);

    if (key) {
      return me
        ? `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(key)}` +
          `&origin=${me}&destination=${dest}&mode=${drive ? "driving" : "walking"}` +
          `&language=iw&region=GE`
        : `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}` +
          `&q=${dest}&zoom=16&language=iw&region=GE`;
    }
    return me
      ? `https://maps.google.com/maps?saddr=${me}&daddr=${dest}` +
        `&dirflg=${drive ? "d" : "w"}&hl=iw&output=embed`
      : `https://maps.google.com/maps?q=${dest}&hl=iw&z=16&output=embed`;
  }

  /* ------------------------------------------------------------------ */
  /*  תצוגה                                                             */
  /* ------------------------------------------------------------------ */

  /** שורת המיקום החי */
  function geoHTML(cur) {
    if (!navigator.geolocation) {
      return `<p class="rt__geo is-off">הדפדפן הזה אינו מדווח מיקום</p>`;
    }
    if (geoErr) {
      return `<p class="rt__geo is-off">📍 ${esc(geoErr)}
        <button class="btn btn--sm" data-rt-geo>נסה שוב</button></p>`;
    }
    if (!pos) {
      return `<p class="rt__geo is-wait">📍 מחפש אותך…</p>`;
    }

    const d = metres({ lat: pos.latitude, lng: pos.longitude }, cur);
    const t = travel(d);
    if (d !== null && d <= NEAR) {
      return `<p class="rt__geo is-here"><b>📍 אתה כאן</b>
        <i>· ${esc(human(d))} מהתחנה</i>
        <small>דיוק ±${Math.round(pos.accuracy)} מ'</small></p>`;
    }
    return `<p class="rt__geo is-on">
      <b>📍 ${esc(human(d))}</b> לתחנה
      ${t ? `<i>· ${esc(travelText(t))}</i>` : ""}
      <small>דיוק ±${Math.round(pos.accuracy)} מ'</small>
    </p>`;
  }

  /**
   * השעה שבה התחנה הראשונה במסלול אמורה לקרות.
   *
   * זו נקודת הייחוס להזזה, ולא השורה הראשונה של היום: שורות של טיסה
   * והגעה כבר קרו, והן לא זזות בגלל שיצאנו מאוחר לסיור.
   */
  function firstStopTime(day) {
    const match = ctx.stopMatch(day);
    const pts = day.points || [];
    for (const p of stops(day)) {
      const m = match[pts.indexOf(p)];
      if (m && m.time) return m.time;
    }
    return "";
  }

  /** ההצעה להזיז את שעות המסלול לשעה שבה באמת יצאנו */
  function shiftHTML(day) {
    if (!askShift) return "";
    const from = firstStopTime(day);
    if (!from) return "";
    const to = hhmm(nowMin());
    return `<div class="rt__shift">
      <p>המסלול כתוב להתחיל ב-${esc(from)}, ויצאנו ב-${esc(to)}.
         אפשר להזיז את כל התחנות בהתאם — ההפרשים ביניהן נשמרים.</p>
      <div class="rt__shift-acts">
        <button class="btn btn--sm btn--primary"
          data-rt-shift="${esc(to)}" data-rt-from="${esc(from)}">הזז את המסלול ל-${esc(to)}</button>
        <button class="btn btn--sm" data-rt-shift-no>השאר כמו שכתוב</button>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------------------ */
  /*  מבט על — הפס העליון                                               */
  /* ------------------------------------------------------------------ */

  /**
   * רצועת היום: כל התחנות, תמיד על המסך.
   *
   * זה החצי שחסר לכרטיס הגדול. כרטיס לבדו עונה "לאן עכשיו" ומשאיר את
   * השאלה "איפה אני בתוך היום" בלי תשובה — וזו בדיוק השאלה שעולה אחרי
   * התחנה השנייה. הרצועה עונה עליה במבט: מה מאחור, איפה אני, מה לפניי,
   * וכמה עוד נשאר.
   *
   * לחיצה על תחנה היא **הצצה** ולא קפיצה: המבט זז, המיקום נשאר.
   */
  function spineHTML(day, list) {
    const match = ctx.stopMatch(day);
    const pts = day.points || [];
    const vi = viewIdx(list);

    return `
      <div class="rt__spine" data-rt-spine>
        <ol>
          ${list
            .map((p, i) => {
              const m = match[pts.indexOf(p)] || {};
              const done = st.done.includes(i);
              const here = i === st.idx;
              const cls = [
                done ? "is-done" : "",
                here ? "is-here" : "",
                i === vi ? "is-view" : "",
                !done && !here ? "is-todo" : "",
              ].filter(Boolean).join(" ");
              return `<li class="${cls}">
                <button data-rt-peek="${i}" title="${esc(p.name)}">
                  <span class="rt__dot" aria-hidden="true">${done ? "✓" : here ? "●" : i + 1}</span>
                  <span class="rt__spine-time">${m.time ? esc(m.time) : "—"}</span>
                  <span class="rt__spine-name">${esc(shortName(p.name))}</span>
                </button>
              </li>`;
            })
            .join("")}
        </ol>
      </div>`;
  }

  /** "פארק ריקה — תחנת רכבל" ברצועה צרה הוא שלוש שורות; זה השם הקצר */
  const shortName = (n) =>
    String(n || "").split(/\s[—–-]\s/)[0].replace(/\s*\(.*$/, "").trim();

  /**
   * שורת המצב: איפה אני ביום, ביחס לשעון ולמזג האוויר.
   *
   * "מאחרים ב-40 דקות" אינו נזיפה אלא מידע שמשנה החלטות — אפשר לוותר
   * על תחנה, אפשר לקצר, ואפשר להזיז את היום. בלעדיו מגלים את זה בחוץ,
   * בחשכה, ליד האתר שנסגר.
   */
  function statusHTML(day, list) {
    const match = ctx.stopMatch(day);
    const pts = day.points || [];
    const here = list[st.idx];
    const m = match[pts.indexOf(here)] || {};
    const left = list.length - st.idx - (st.done.includes(st.idx) ? 0 : 1);

    /*
     * כשההצעה להזיז את היום עוד פתוחה, "מאחרים ב-155 דקות" הוא לא
     * אמת אלא תקלה בניסוח: התוכנית פשוט כתובה לשעה אחרת, ועוד לא
     * הוכרע מה עושים עם זה. הפיגור נאמר רק אחרי שהוכרע.
     */
    let drift = "";
    if (m.time && !askShift) {
      const d = nowMin() - ctx.min(m.time);
      if (Math.abs(d) >= 25) {
        drift = d > 0
          ? `<i class="is-late">מאחרים ב-${Math.round(d / 5) * 5} דק'</i>`
          : `<i class="is-early">מקדימים ב-${Math.round(-d / 5) * 5} דק'</i>`;
      } else {
        drift = `<i class="is-ok">בזמן</i>`;
      }
    }

    const wx = ctx.wx ? ctx.wx(day.n) : null;

    return `
      <p class="rt__status">
        <b>${st.done.length}/${list.length}</b>
        <span>${
          st.done.includes(st.idx) && st.idx === list.length - 1
            ? "סיימנו את היום"
            : `עכשיו: ${esc(shortName(here.name))}`
        }</span>
        ${drift}
        ${left > 0 ? `<span class="rt__status-left">נשארו ${left}</span>` : ""}
        ${wx
          ? `<span class="rt__status-wx">${esc(wx.icon)} ${esc(wx.now)}${
              wx.span ? ` · ${esc(wx.span)}` : ""
            }${wx.rain ? ` · ${esc(wx.rain)}` : ""}</span>`
          : ""}
      </p>`;
  }

  /* ------------------------------------------------------------------ */
  /*  התראות                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * מה שהליווי הפעיל מצא, כאן ולא רק בקוביה.
   *
   * אתר שנסגר היום, כביש חסום, גשם שמתחיל בארבע — זה מידע שנוגע לתחנה
   * הבאה, ומי שעומד ברחוב עם המסך הזה פתוח לא אמור לצאת ממנו כדי
   * לראות אותו.
   */
  function alertHTML() {
    if (typeof TripWatch === "undefined") return "";
    const f = TripWatch.unseen();
    if (!f) {
      const all = TripWatch.found();
      if (!all.length) return "";
      if (!showAll) {
        return `<button class="rt__bell" data-rt-bell>⚠️ ${all.length} התראות שהיו</button>`;
      }
      return `<div class="rt__alert is-list">
        <button class="rt__alert-x" data-rt-bell aria-label="סגירה">✕</button>
        <b>ההתראות שהיו</b>
        <ul>${all
          .map((x) => `<li><time>${new Date(x.at).toLocaleTimeString("he-IL", {
            hour: "2-digit", minute: "2-digit",
          })}</time> ${x.alert ? "⚠️ " : ""}${esc(x.headline)}</li>`)
          .join("")}</ul>
      </div>`;
    }
    return `
      <div class="rt__alert${f.alert ? " is-urgent" : ""}">
        <button class="rt__alert-x" data-rt-seen="${esc(f.id)}" aria-label="סגירה">✕</button>
        <b>${f.alert ? "⚠️ " : "💡 "}${esc(f.headline)}</b>
        ${(f.bullets || []).length
          ? `<ul>${f.bullets.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
          : ""}
        ${f.caution ? `<small>${esc(f.caution)}</small>` : ""}
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /*  מבט נקודתי — התחנה הגדולה                                         */
  /* ------------------------------------------------------------------ */

  function stopHTML(day, list) {
    const i = viewIdx(list);
    const p = list[i];
    const next = list[i + 1] || null;
    const match = ctx.stopMatch(day);
    const pts = day.points || [];
    const m = match[pts.indexOf(p)] || {};
    const legs = metres(p, next);
    const t = travel(legs);
    const done = st.done.includes(i);
    const ahead = i !== st.idx;

    // המרחק ממני לתחנה — הוא שקובע איזו דרך מוצעת ראשונה
    const me = pos ? travel(metres({ lat: pos.latitude, lng: pos.longitude }, p)) : null;
    const tips = ctx.tips ? ctx.tips(day, p) : [];

    return `
      <section class="rt__now${ahead ? " is-peek" : ""}${done ? " is-done" : ""}">
        ${ahead
          ? `<button class="rt__peekbar" data-rt-peek="${st.idx}">
               👀 מציצים קדימה · חזרה לתחנה שלי (${st.idx + 1})
             </button>`
          : ""}

        <header class="rt__now-head">
          <span class="rt__now-icon" aria-hidden="true">${done ? "✅" : ctx.icon(p.type)}</span>
          <div>
            <span class="rt__now-tag">תחנה ${i + 1} מתוך ${list.length}${
              m.time ? ` · ${esc(m.time)}` : ""
            }${done ? " · היינו" : ""}</span>
            <h3>${esc(p.name)}</h3>
            <span class="rt__now-kind">${esc(ctx.label(p.type) || "")}</span>
          </div>
        </header>

        ${m.text
          ? `<p class="rt__what"><b>מה יש כאן:</b> ${esc(m.text)}</p>`
          : day.summary
          ? `<p class="rt__what">${esc(day.summary)}</p>`
          : ""}

        ${tips.length
          ? `<ul class="rt__tips">${tips.map((x) => `<li>💡 ${esc(x)}</li>`).join("")}</ul>`
          : ""}

        ${ahead ? aheadHTML(list, i) : geoHTML(p)}

        <div class="rt__acts">
          <a class="btn btn--primary" target="_blank" rel="noopener"
             href="${esc(navLink(p, me?.mode || "walking"))}">🧭 נווט לתחנה הזו${
               !ahead && me ? ` · ${esc(travelText(me))}` : ""
             }</a>
          <a class="btn" target="_blank" rel="noopener"
             href="${esc(navLink(p, me?.far ? "walking" : "driving"))}">${
               me?.far ? "🚶 ברגל" : "🚗 ברכב"
             }</a>
          <a class="btn" target="_blank" rel="noopener"
             href="${esc(ctx.placeLink(p.name, p.lat, p.lng))}">ℹ️ על המקום</a>
          ${done
            ? `<button class="btn" data-rt-undo="${i}">↩︎ לא הייתי</button>`
            : ahead
            ? `<button class="btn" data-rt-jump="${i}">📍 אני כאן</button>`
            : `<button class="btn" data-rt-arrive>✅ הגעתי</button>`}
        </div>

        ${next
          ? `<button class="rt__next" data-rt-peek="${i + 1}">
               <span class="rt__next-tag">התחנה הבאה</span>
               <b>${ctx.icon(next.type)} ${esc(next.name)}</b>
               <span>${(() => {
                 const nm = match[pts.indexOf(next)] || {};
                 return nm.time ? `${esc(nm.time)} · ` : "";
               })()}${esc(human(legs))}${t ? ` · ${esc(travelText(t))}` : ""}</span>
               <span class="rt__peek-cue">להציץ</span>
             </button>`
          : `<p class="rt__next is-last">זו התחנה האחרונה של היום.
               ${day.hotel?.name ? `אחריה חוזרים ל-${esc(day.hotel.name)}.` : ""}</p>`}
      </section>`;
  }

  /** בהצצה קדימה אין "כמה נשאר לי" אלא "כמה זה מהמקום שבו אני עומד" */
  function aheadHTML(list, i) {
    const from = list[st.idx];
    const to = list[i];
    const d = metres(from, to);
    const t = travel(d);
    return `<p class="rt__geo is-wait">
      מהתחנה שלך (${esc(shortName(from.name))}) · ${esc(human(d))}${
        t ? ` · ${esc(travelText(t))}` : ""
      }</p>`;
  }

  /* ------------------------------------------------------------------ */
  /*  מפה ורשימה                                                        */
  /* ------------------------------------------------------------------ */

  function mapHTML(day, list) {
    const p = list[viewIdx(list)];
    const key = (localStorage.getItem(GKEY) || "").trim();
    return `
      <section class="rt__map">
        <div class="rt__map-head">
          <h4>🗺️ ${esc(shortName(p.name))}</h4>
          <a class="btn btn--sm" target="_blank" rel="noopener"
             href="${esc(navLink(p, "walking"))}">פתח באפליקציה</a>
        </div>
        <iframe class="rt__frame" src="${esc(mapSrc(p))}"
                loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                title="מפת Google לתחנה ${esc(p.name)}"></iframe>
        <p class="rt__map-note">
          ${key
            ? "מפה רשמית של Google Maps, עם המסלול מצויר."
            : "מפת Google בעברית. אפשר להזין מפתח Embed API כדי שהמסלול עצמו ייוצר על המפה."}
          <button class="btn btn--sm" data-rt-key>${key ? "שנה מפתח" : "הזן מפתח"}</button>
        </p>
      </section>`;
  }

  /**
   * הרשימה המלאה — פרושה רק כשמבקשים.
   *
   * הרצועה למעלה כבר נותנת את מבט העל, והרשימה היא הגרסה המפורטת שלו:
   * מרחקים בין תחנות, שעות, וניווט מכל שורה. שתיהן פתוחות תמיד היו
   * אותו מידע פעמיים, ולכן זו נפתחת בלחיצה.
   */
  function listHTML(day, list) {
    const match = ctx.stopMatch(day);
    const pts = day.points || [];

    return `
      <section class="rt__list">
        <button class="rt__list-head" data-rt-list aria-expanded="${openList}">
          <span>כל התחנות של היום</span>
          <span class="rt__chev" aria-hidden="true">${openList ? "⌃" : "⌄"}</span>
        </button>
        ${!openList ? "" : `<ol>
          ${list
            .map((p, i) => {
              const m = match[pts.indexOf(p)] || {};
              const done = st.done.includes(i);
              const cur = i === st.idx;
              const cls = done ? "is-done" : cur ? "is-cur" : "";
              const gap = i > 0 ? metres(list[i - 1], p) : null;
              return `<li class="${cls}">
                <button class="rt__row" data-rt-peek="${i}">
                  <span class="rt__row-mark" aria-hidden="true">${done ? "✅" : cur ? "▶️" : ctx.icon(p.type)}</span>
                  <span class="rt__row-txt">
                    <b>${esc(p.name)}</b>
                    <small>${m.time ? esc(m.time) : ""}${
                      gap !== null ? `${m.time ? " · " : ""}${esc(human(gap))} מהקודמת` : ""
                    }${!m.time && gap === null ? "תחנה ראשונה" : ""}</small>
                  </span>
                </button>
                ${done
                  ? `<button class="rt__undo" data-rt-undo="${i}" title="לא הייתי שם">↩︎</button>`
                  : `<a class="rt__row-nav" target="_blank" rel="noopener"
                       href="${esc(navLink(p, "walking"))}" title="ניווט לתחנה">🧭</a>`}
              </li>`;
            })
            .join("")}
        </ol>`}
      </section>`;
  }

  /* ------------------------------------------------------------------ */
  /*  הרכבה                                                             */
  /* ------------------------------------------------------------------ */

  function render() {
    if (!st) return;
    const day = ctx.day(st.n);
    const list = day ? stops(day) : [];
    const body = el.querySelector("[data-rt-body]");
    const head = el.querySelector("[data-rt-head]");
    const top = el.querySelector("[data-rt-top]");

    if (!day || !list.length) {
      head.textContent = "מסלול היום";
      top.innerHTML = "";
      body.innerHTML = `<div class="rt__empty">
        <p>ליום הזה אין תחנות שהולכים אליהן — מה שיש בו הוא טיסה, לינה,
        או נקודות בלי מיקום.</p>
        <p class="muted">שדות תעופה והמלון אינם תחנות במסלול: המלון הוא
        מאיפה יוצאים, ולטיסה יש את כרטיס העלייה ואת החבר/ה המלווה.
        אפשר להוסיף נקודות בעריכת היום.</p>
      </div>`;
      return;
    }

    if (st.idx > list.length - 1) st.idx = list.length - 1;

    const started = st.startedAt
      ? new Date(st.startedAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
      : "";
    head.innerHTML = `יום ${day.n} · ${esc(day.title)}
      <small>${esc(day.dow || "")}${started ? ` · יצאנו ב-${esc(started)}` : ""}</small>`;

    /*
     * מבט העל דבוק לראש המסך ואינו נגלל איתו. זו כל הנקודה: בכל רגע,
     * ובלי לגלול, רואים גם איפה אני ביום וגם את התחנה שמולי.
     */
    top.innerHTML = statusHTML(day, list) + spineHTML(day, list);

    body.innerHTML =
      alertHTML() +
      shiftHTML(day) +
      stopHTML(day, list) +
      mapHTML(day, list) +
      listHTML(day, list);

    centreSpine();
  }

  /** הרצועה נגללת לבד לתחנה שמוצגת — אחרת היא נכונה ולא נראית */
  function centreSpine() {
    const spine = el.querySelector("[data-rt-spine]");
    const mark = spine?.querySelector("li.is-view");
    if (!spine || !mark) return;
    const off = mark.offsetLeft - (spine.clientWidth - mark.clientWidth) / 2;
    spine.scrollTo({ left: Math.max(0, off), behavior: "smooth" });
  }

  /* ------------------------------------------------------------------ */
  /*  חיווט                                                             */
  /* ------------------------------------------------------------------ */

  function init(hostCtx) {
    ctx = hostCtx;
    el = document.getElementById("routeOverlay");
    if (!el) return;

    el.addEventListener("click", (e) => {
      if (e.target === el || e.target.closest("[data-rt-close]")) return close();

      if (e.target.closest("[data-rt-arrive]")) return arrive(false);
      if (e.target.closest("[data-rt-geo]")) { stopGeo(); startGeo(); return render(); }
      if (e.target.closest("[data-rt-list]")) { openList = !openList; return render(); }
      if (e.target.closest("[data-rt-bell]")) { showAll = !showAll; return render(); }

      const seen = e.target.closest("[data-rt-seen]");
      if (seen) {
        if (typeof TripWatch !== "undefined") TripWatch.dismiss(seen.dataset.rtSeen);
        ctx.changed();
        return render();
      }

      const pk = e.target.closest("[data-rt-peek]");
      if (pk) return peek(Number(pk.dataset.rtPeek));

      const jp = e.target.closest("[data-rt-jump]");
      if (jp) return jump(Number(jp.dataset.rtJump));

      const un = e.target.closest("[data-rt-undo]");
      if (un) return undo(Number(un.dataset.rtUndo));

      const sh = e.target.closest("[data-rt-shift]");
      if (sh) {
        ctx.shiftDay(st.n, sh.dataset.rtFrom, sh.dataset.rtShift);
        askShift = false;
        return render();
      }
      if (e.target.closest("[data-rt-shift-no]")) { askShift = false; return render(); }

      if (e.target.closest("[data-rt-key]")) {
        const cur = localStorage.getItem(GKEY) || "";
        const v = window.prompt(
          "מפתח Google Maps Embed API (נשמר במכשיר בלבד).\n" +
            "ריק = מפה בלי מפתח.",
          cur
        );
        if (v !== null) {
          try {
            if (v.trim()) localStorage.setItem(GKEY, v.trim());
            else localStorage.removeItem(GKEY);
          } catch { /* מלא */ }
          render();
        }
        return;
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) close();
    });
  }

  return { init, open, close, isOpen, started: (date) => {
    try {
      const s = JSON.parse(localStorage.getItem(SKEY(date)) || "null");
      return s?.startedAt || null;
    } catch { return null; }
  } };
})();
