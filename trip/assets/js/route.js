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

  function arrive(auto) {
    const day = ctx.day(st.n);
    const list = stops(day);
    if (!list.length) return;
    if (!st.done.includes(st.idx)) st.done.push(st.idx);
    if (st.idx < list.length - 1) st.idx++;
    st.auto = Boolean(auto);
    save();
    render();
  }

  function goTo(i) {
    st.idx = i;
    save();
    render();
  }

  function undo(i) {
    st.done = st.done.filter((x) => x !== i);
    st.idx = i;
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

  /** התחנה הנוכחית — החלק הגדול של המסך */
  function currentHTML(day, list) {
    const i = Math.min(st.idx, list.length - 1);
    const p = list[i];
    const next = list[i + 1] || null;
    const match = ctx.stopMatch(day)[(day.points || []).indexOf(p)] || {};
    const legs = metres(p, next);
    const t = travel(legs);

    // המרחק ממני לתחנה — הוא שקובע איזו דרך מוצעת ראשונה
    const me = pos
      ? travel(metres({ lat: pos.latitude, lng: pos.longitude }, p))
      : null;

    const left = list.length - 1 - i;

    return `
      <section class="rt__now">
        <header class="rt__now-head">
          <span class="rt__now-icon" aria-hidden="true">${ctx.icon(p.type)}</span>
          <div>
            <span class="rt__now-tag">תחנה ${i + 1} מתוך ${list.length}${
              match.time ? ` · ${esc(match.time)}` : ""
            }</span>
            <h3>${esc(p.name)}</h3>
            <span class="rt__now-kind">${esc(ctx.label(p.type) || "")}</span>
          </div>
        </header>

        ${match.text
          ? `<p class="rt__what"><b>מה עושים כאן:</b> ${esc(match.text)}</p>`
          : day.summary
          ? `<p class="rt__what">${esc(day.summary)}</p>`
          : ""}

        ${geoHTML(p)}

        <div class="rt__acts">
          <a class="btn btn--primary" target="_blank" rel="noopener"
             href="${esc(navLink(p, me?.mode || "walking"))}">🧭 נווט לתחנה הזו${
               me ? ` · ${esc(travelText(me))}` : ""
             }</a>
          <a class="btn" target="_blank" rel="noopener"
             href="${esc(navLink(p, me?.far ? "walking" : "driving"))}">${
               me?.far ? "🚶 ברגל" : "🚗 ברכב"
             }</a>
          <a class="btn" target="_blank" rel="noopener"
             href="${esc(ctx.placeLink(p.name, p.lat, p.lng))}">ℹ️ על המקום</a>
          <button class="btn" data-rt-arrive>✅ הגעתי</button>
        </div>

        ${next
          ? `<div class="rt__next">
               <span class="rt__next-tag">אחר כך</span>
               <b>${ctx.icon(next.type)} ${esc(next.name)}</b>
               <span>${
                 (() => {
                   const nm = ctx.stopMatch(day)[(day.points || []).indexOf(next)] || {};
                   return nm.time ? `${esc(nm.time)} · ` : "";
                 })()
               }${esc(human(legs))}${t ? ` · ${esc(travelText(t))}` : ""}</span>
               <a class="btn btn--sm" target="_blank" rel="noopener"
                  href="${esc(navLink(next, t?.mode || "walking"))}">נווט לשם</a>
             </div>`
          : `<p class="rt__next is-last">זו התחנה האחרונה של היום.
               ${day.hotel?.name ? `אחריה חוזרים ל-${esc(day.hotel.name)}.` : ""}</p>`}

        ${left > 0 ? `<p class="rt__left">נשארו עוד ${left} תחנות אחרי זו.</p>` : ""}
      </section>`;
  }

  /** המפה */
  function mapHTML(day, list) {
    const p = list[Math.min(st.idx, list.length - 1)];
    const key = (localStorage.getItem(GKEY) || "").trim();
    return `
      <section class="rt__map">
        <div class="rt__map-head">
          <h4>🗺️ המסלול לתחנה</h4>
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

  /** רשימת כל התחנות, עם מה שנעשה ומה שלא */
  function listHTML(day, list) {
    const match = ctx.stopMatch(day);
    const pts = day.points || [];

    return `
      <section class="rt__list">
        <h4>כל התחנות של היום</h4>
        <ol>
          ${list
            .map((p, i) => {
              const m = match[pts.indexOf(p)] || {};
              const done = st.done.includes(i);
              const cur = i === st.idx;
              const cls = done ? "is-done" : cur ? "is-cur" : "";
              const gap = i > 0 ? metres(list[i - 1], p) : null;
              return `<li class="${cls}">
                <button class="rt__row" data-rt-go="${i}">
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
        </ol>
      </section>`;
  }

  function render() {
    if (!st) return;
    const day = ctx.day(st.n);
    const list = day ? stops(day) : [];
    const body = el.querySelector("[data-rt-body]");
    const head = el.querySelector("[data-rt-head]");

    if (!day || !list.length) {
      head.textContent = "מסלול היום";
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
      <small>${st.done.length}/${list.length} תחנות${started ? ` · יצאנו ב-${esc(started)}` : ""}</small>`;

    const pct = Math.round((st.done.length / list.length) * 100);

    body.innerHTML =
      `<div class="rt__bar"><span style="inline-size:${pct}%"></span></div>` +
      shiftHTML(day) +
      currentHTML(day, list) +
      mapHTML(day, list) +
      listHTML(day, list);
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

      const go = e.target.closest("[data-rt-go]");
      if (go) return goTo(Number(go.dataset.rtGo));

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
