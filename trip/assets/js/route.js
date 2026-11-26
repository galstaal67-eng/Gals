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
  /** חלון אחר שפתוח מעל מסך המסלול */
  const OTHER_OVERLAY = ".overlay:not(#routeOverlay):not([hidden])";

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
  let showMiss = false;              // האם לוח התחנות שפוספסו פתוח
  let keyEdit = false;               // האם שדה מפתח המפה פתוח
  let mapFrame = null;               // ה-iframe חי מעבר לרינדורים
  let mapShown = "";                 // מה הוא מציג כרגע
  let heading = null;                 // לאן הטלפון מופנה, מעלות מצפון
  let headOn = false;                 // האם חיישן הכיוון מאזין
  let headAsk = false;                // האם צריך אישור מפורש (iOS)
  let outdoor = false;                // מצב חוץ — מסך אחד, גדול, לקריאה בהליכה
  let wake = null;                    // Wake Lock, כדי שהמסך לא ייכבה בדרך
  let rafId = 0;

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
  /*  מצפן                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * לאן ללכת — ולא איפה זה על מפה.
   *
   * מפה דורשת שתמצא בה את עצמך, תסובב אותה בראש ותתרגם לרחוב שמולך.
   * זו עבודה, והיא נעשית כשהעיניים בטלפון ולא בחוץ. חץ שמצביע על
   * התחנה **ביחס לכיוון שאליו אתה מופנה עכשיו** אינו דורש תרגום: מסתכלים
   * שנייה, מרימים את הראש, והולכים לשם.
   *
   * זה גם מה שהמחקר על ניווט להולכי רגל אומר: ממשק דליל שמראה את
   * המקטע הנוכחי ונקודת ציון עבד טוב יותר מממשק שהוסיף מפה, והנחיות
   * לפי נקודות ציון מעובדות מהר יותר ונזכרות טוב יותר מהנחיות לפי
   * שמות רחובות.
   */
  function bearing(a, b) {
    const p = Math.PI / 180;
    const dLng = (b.lng - a.lng) * p;
    const y = Math.sin(dLng) * Math.cos(b.lat * p);
    const x =
      Math.cos(a.lat * p) * Math.sin(b.lat * p) -
      Math.sin(a.lat * p) * Math.cos(b.lat * p) * Math.cos(dLng);
    return (Math.atan2(y, x) / p + 360) % 360;
  }

  /** הפרש זוויות בטווח ‎-180..180 */
  const angDiff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;

  /** המילה שמחליפה את המעלות. מעלות אף אחד לא מתרגם תוך כדי הליכה. */
  function turnWord(rel) {
    const a = Math.abs(rel);
    if (a <= 22) return "ישר קדימה";
    if (a <= 67) return rel > 0 ? "נטה ימינה" : "נטה שמאלה";
    if (a <= 112) return rel > 0 ? "ימינה" : "שמאלה";
    if (a <= 157) return rel > 0 ? "אחורה ימינה" : "אחורה שמאלה";
    return "מאחוריך";
  }

  const ROSE = ["צפון", "צפון־מזרח", "מזרח", "דרום־מזרח", "דרום", "דרום־מערב", "מערב", "צפון־מערב"];
  const roseWord = (deg) => ROSE[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

  /**
   * קריאת כיוון מהחיישן.
   *
   * שני עולמות: ב-iOS יש `webkitCompassHeading`, שהוא כבר מעלות מצפון,
   * ודורש אישור מפורש מתוך לחיצה. בכרום יש אירוע `deviceorientationabsolute`
   * ו-`alpha` שנמדד נגד כיוון השעון. בודקים את מה שבאמת הגיע באירוע ולא
   * את סוג הדפדפן — `alpha` של אירוע יחסי נראה בדיוק אותו דבר ומצביע
   * לכיוון שרירותי, וזו תקלה שקשה לראות.
   */
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === "number" && !Number.isNaN(e.webkitCompassHeading)) {
      h = e.webkitCompassHeading;
    } else if (e.absolute === true && typeof e.alpha === "number") {
      h = (360 - e.alpha) % 360;
    }
    if (h === null) return;

    // החלקה: מחט שרועדת קשה יותר לקריאה ממחט שמאחרת ברבע שנייה
    heading = heading === null ? h : heading + angDiff(h, heading) * 0.25;
    heading = ((heading % 360) + 360) % 360;
    paintCompass();
  }

  async function startHeading() {
    if (headOn) return;
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return;
    if (typeof DOE.requestPermission === "function") {
      try {
        if ((await DOE.requestPermission()) !== "granted") { headAsk = true; return render(); }
      } catch { headAsk = true; return render(); }
    }
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
    headOn = true;
    headAsk = false;
    render();
  }

  function stopHeading() {
    window.removeEventListener("deviceorientationabsolute", onOrient, true);
    window.removeEventListener("deviceorientation", onOrient, true);
    headOn = false;
    heading = null;
  }

  /**
   * עדכון המרחק והכיוון בלי לבנות את המסך מחדש.
   *
   * `watchPosition` מדווח כל כמה שניות. רינדור מלא בכל דיווח מהבהב,
   * מאבד גלילה, וטוען את המפה מחדש. כאן מתחלפים מספר, שתי מילים,
   * וזווית.
   */
  function paintGeo() {
    if (!st) return;
    const day = ctx.day(st.n);
    const list = day ? stops(day) : [];
    const p = list[viewIdx(list)];
    const box = el.querySelector(".rt__compass");
    if (!p || !box) return;

    // בהצצה קדימה המדידה היא מהתחנה שלי אליה, ולא ממני — והיא לא זזה
    if (viewIdx(list) !== st.idx) return;

    const me = pos ? { lat: pos.latitude, lng: pos.longitude } : null;
    const d = me ? metres(me, p) : null;
    const t = travel(d);
    const near = d !== null && d <= NEAR;

    const big = el.querySelector(".rt__big");
    if (big) {
      big.textContent = near ? "אתה כאן" : d !== null ? human(d) : "—";
      big.className = `rt__big${near ? " is-here" : ""}${d === null ? " is-wait" : ""}`;
    }
    const sub = el.querySelector(".rt__sub");
    if (sub) {
      sub.textContent = near
        ? `בתוך ${human(d)} מהתחנה`
        : t
        ? travelText(t)
        : geoErr || "מחפש אותך…";
    }
    box.classList.toggle("is-here", near);

    /*
     * המחט מצביעה מהמקום שבו אני עומד עכשיו.
     *
     * אם אין מחט בכלל, הדיאל נבנה לפני שהמיקום הגיע — אז הוא מציג
     * סיכה ולא חץ, ועדכון בלבד לא יחליף אותו. במקרה הזה בונים פעם
     * אחת מחדש; בלי זה החץ היה מופיע רק ברענון הבא, בעוד חצי דקה.
     */
    const needle = el.querySelector("[data-rt-needle]");
    if (!needle) { if (me) render(); return; }
    if (me) needle.dataset.rtNeedle = bearing(me, p).toFixed(1);

    // הכפתור הראשי: הדרך המתאימה למרחק שהשתנה
    const nav = el.querySelector(".rt__acts .btn--primary");
    if (nav && nav.tagName === "A") {
      nav.href = navLink(p, t?.mode || "walking");
      nav.textContent = `🧭 נווט לתחנה הזו${t ? ` · ${travelText(t)}` : ""}`;
    }

    mountMap(p);
    paintCompass();
  }

  /**
   * סיבוב המחט בלי רינדור מחדש.
   *
   * החיישן מדווח עשרות פעמים בשנייה. בנייה מחדש של ה-HTML בקצב הזה
   * הורסת את הסוללה ואת הגלילה, ולכן כאן נוגעים רק בתכונה שהשתנתה.
   */
  function paintCompass() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const needle = el.querySelector("[data-rt-needle]");
      if (!needle) return;
      const to = Number(needle.dataset.rtNeedle);
      if (!Number.isFinite(to)) return;
      const rel = heading === null ? to : angDiff(to, heading);
      needle.style.transform = `rotate(${rel}deg)`;
      const word = el.querySelector("[data-rt-turn]");
      if (word) {
        word.textContent = heading === null ? roseWord(to) : turnWord(rel);
      }
      const north = el.querySelector("[data-rt-north]");
      if (north) north.style.transform = `rotate(${heading === null ? 0 : -heading}deg)`;
    });
  }

  /* ------------------------------------------------------------------ */
  /*  מצב חוץ                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * מסך אחד, גדול, לקריאה בשמש ותוך כדי הליכה.
   *
   * מה שנשאר: החץ, המרחק, שם התחנה וכפתור אחד — בתחתית, במקום שהאגודל
   * מגיע אליו ביד אחת. מה שנעלם: המפה, הרשימה, הטיפים והטקסט. לא מפני
   * שהם מיותרים, אלא מפני שבחוץ יש שנייה אחת של מבט, ובשנייה הזו דף
   * עמוס אינו נקרא בכלל.
   */
  async function setOutdoor(on) {
    outdoor = on;
    try { localStorage.setItem("route:outdoor", on ? "1" : "0"); } catch { /* מלא */ }
    if (on) {
      startHeading();
      try {
        if (navigator.wakeLock && !wake) wake = await navigator.wakeLock.request("screen");
      } catch { /* הדפדפן לא תומך, או שהמסך לא פעיל */ }
    } else if (wake) {
      try { await wake.release(); } catch { /* כבר שוחרר */ }
      wake = null;
    }
    render();
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
    showMiss = false;
    keyEdit = false;
    headAsk = false;
    try { outdoor = localStorage.getItem("route:outdoor") === "1"; } catch { outdoor = false; }
    if (outdoor) startHeading();
    centred = null;
    el.hidden = false;
    // is-route ולא רק is-locked: הכפתורים הצפים צריכים לדעת שהמסך
    // שמעליהם הוא **מסך המסלול** ולא חלון דיאלוג כלשהו
    document.body.classList.add("is-locked", "is-route");
    render();
    startGeo();
    clearInterval(tick);
    // רענון תקופתי — אבל לא בזמן שמקלידים מפתח לתוך שדה
    tick = setInterval(() => { if (!keyEdit) render(); }, 30000);
  }

  function close() {
    el.hidden = true;
    document.body.classList.remove("is-locked", "is-route");
    stopGeo();
    stopHeading();
    mapFrame = null;
    mapShown = "";
    if (wake) { try { wake.release(); } catch { /* כבר שוחרר */ } wake = null; }
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
        autoArrive();        // הגעה היא שינוי מצב, והיא כן בונה מחדש
        paintGeo();
      },
      (e) => {
        geoErr =
          e.code === 1 ? "אין הרשאת מיקום"
          : e.code === 3 ? "המיקום לא נקלט"
          : "שגיאת מיקום";
        paintGeo();
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
      if (nearHits >= 2) {
        /*
         * רטט בהגעה. כל הרעיון של המסך הזה הוא שלא צריך להחזיק עליו
         * עיניים, ולכן ההודעה החשובה ביותר שלו צריכה להגיע גם בלי
         * להסתכל. (ספארי ב-iOS מתעלם, וזה בסדר — הוא לא שובר כלום.)
         */
        try { navigator.vibrate?.([60, 40, 60]); } catch { /* אין רטט */ }
        arrive(true);
        nearHits = 0;
      }
    } else {
      nearHits = 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  התקדמות                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * מה קרה עם התחנה הזו.
   *
   * "פוספסה" אינו מצב שמישהו מסמן — הוא **נגזר**: תחנה שנשארה מאחור
   * ולא סומנה כמבוקרת היא תחנה שלא היינו בה. זה חוסך מצב שאפשר לשקר
   * בו (דגל שנשמר בנפרד ויכול לסתור את המיקום), והוא גם מה שבאמת קרה
   * בשטח: עברנו הלאה בלי לעצור.
   *
   * done · here · miss · todo
   */
  function stateOf(i) {
    if (st.done.includes(i)) return "done";
    if (i === st.idx) return "here";
    return i < st.idx ? "miss" : "todo";
  }

  const missed = (list) =>
    list.map((_, i) => i).filter((i) => stateOf(i) === "miss");

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

  /**
   * דילוג: מתקדמים בלי לסמן ביקור.
   *
   * אין כאן דגל חדש — עצם ההתקדמות **היא** הדילוג, והתחנה נשארת מאחור
   * בלי ✓. כך גם תחנה שפשוט עברנו אותה בלי ללחוץ כלום נראית בדיוק
   * אותו דבר, וזה נכון: שתיהן לא קרו.
   */
  function skip() {
    const list = stops(ctx.day(st.n));
    if (st.idx >= list.length - 1) return;
    st.done = st.done.filter((x) => x !== st.idx);
    st.idx++;
    view = null;
    save();
    render();
  }

  /** "בכל זאת הייתי כאן" — תיקון של תחנה שנראית מפוספסת */
  function markDone(i) {
    if (!st.done.includes(i)) st.done.push(i);
    save();
    if (showMiss && !missed(stops(ctx.day(st.n))).length) showMiss = false;
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

  /**
   * החלק שנקרא בשנייה אחת: חץ, מרחק, מילה.
   *
   * המרחק גדול מכל דבר אחר על המסך, כי הוא מה שבודקים שוב ושוב תוך
   * כדי הליכה. מתחתיו נקודת הציון — מאיפה הגענו — כי הנחיה שנתלית על
   * מקום מוכר נקראת מהר יותר משם של רחוב.
   */
  function compassHTML(p, list, i) {
    const me = pos ? { lat: pos.latitude, lng: pos.longitude } : null;
    const from = me || (i > 0 ? list[i - 1] : null);
    const d = me ? metres(me, p) : null;
    const t = travel(d);
    const to = from ? bearing(from, p) : null;
    const rel = to === null ? null : heading === null ? to : angDiff(to, heading);

    const word = to === null
      ? ""
      : heading === null
      ? roseWord(to)
      : turnWord(rel);

    const near = d !== null && d <= NEAR;

    /* הכותרת הגדולה: או "אתה כאן", או המרחק */
    const big = near
      ? `<b class="rt__big is-here">אתה כאן</b>`
      : d !== null
      ? `<b class="rt__big">${esc(human(d))}</b>`
      : `<b class="rt__big is-wait">—</b>`;

    const sub = near
      ? `<span class="rt__sub">בתוך ${esc(human(d))} מהתחנה</span>`
      : d !== null && t
      ? `<span class="rt__sub">${esc(travelText(t))}</span>`
      : geoErr
      ? `<span class="rt__sub">${esc(geoErr)}</span>`
      : `<span class="rt__sub">מחפש אותך…</span>`;

    /* נקודת ציון: ממה יוצאים. מוכר תמיד עדיף על נ"צ. */
    const land = i > 0 && !me
      ? `מ${shortName(list[i - 1].name)}`
      : i > 0 && d !== null && d > NEAR
      ? `אחרי ${shortName(list[i - 1].name)}`
      : "";

    return `
      <div class="rt__compass${near ? " is-here" : ""}">
        <div class="rt__dial" role="img"
             aria-label="${esc(word || "אין כיוון")} אל ${esc(p.name)}">
          <!-- בלי חיישן הדיאל הוא צפון־למעלה; עם חיישן הוא "מה שמולך
               למעלה", והצפון נודד לאן שהוא באמת -->
          <span class="rt__dial-n" data-rt-north
                style="transform: rotate(${heading === null ? 0 : (-heading).toFixed(1)}deg)"
                aria-hidden="true"><i>צ</i></span>
          ${to === null
            ? `<span class="rt__needle is-off" aria-hidden="true">📍</span>`
            : `<span class="rt__needle" data-rt-needle="${to.toFixed(1)}"
                 style="transform: rotate(${(rel ?? 0).toFixed(1)}deg)" aria-hidden="true"></span>`}
        </div>
        <div class="rt__read">
          ${big}
          ${sub}
          ${word ? `<span class="rt__turn" data-rt-turn>${esc(word)}</span>` : ""}
          ${land ? `<span class="rt__land">${esc(land)}</span>` : ""}
        </div>
      </div>
      ${to !== null && heading === null && !headAsk && window.DeviceOrientationEvent
        ? `<button class="rt__cta" data-rt-head>🧭 הפעל מצפן — שהחץ יצביע לכיוון שאתה עומד בו</button>`
        : ""}
      ${to !== null && heading === null && !headAsk && !window.DeviceOrientationEvent
        ? `<p class="rt__land rt__land--note">אין חיישן כיוון במכשיר הזה, ולכן החץ מצביע לפי
             מצפן העולם: צפון למעלה.</p>`
        : ""}
      ${headAsk
        ? `<p class="rt__geo is-off">אין הרשאת מצפן. החץ מצביע לפי מצפן העולם (צפון למעלה).
             <button class="btn btn--sm" data-rt-head>נסה שוב</button></p>`
        : ""}`;
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
              const stt = stateOf(i);
              const cls = `is-${stt}${i === vi ? " is-view" : ""}`;
              const mark = stt === "done" ? "✓" : stt === "here" ? "●" : stt === "miss" ? "✕" : i + 1;
              return `<li class="${cls}">
                <button data-rt-peek="${i}"
                        title="${esc(p.name)}${stt === "miss" ? " — פוספסה" : ""}">
                  <span class="rt__dot" aria-hidden="true">${mark}</span>
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
    const miss = missed(list);

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
        ${miss.length
          ? `<button class="rt__status-miss" data-rt-missed
               aria-expanded="${showMiss}"
               title="התחנות שלא סומנו — אפשר לתקן">✕ פוספסו ${miss.length}</button>`
          : ""}
        ${wx
          ? `<span class="rt__status-wx">${esc(wx.icon)} ${esc(wx.now)}${
              wx.span ? ` · ${esc(wx.span)}` : ""
            }${wx.rain ? ` · ${esc(wx.rain)}` : ""}</span>`
          : ""}
      </p>`;
  }

  /**
   * התחנות שנשארו בלי ✓ — ותיקון שלהן במקום אחד.
   *
   * "פוספסה" נגזר מכך שעברנו הלאה בלי לסמן, וזה נכון ברוב המקרים
   * ושגוי בחלקם: היינו שם, פשוט לא נגענו במסך. לתקן את זה תחנה-תחנה
   * דרך הכרטיס אפשר היה גם קודם, אבל רק מי שידע לחפש מצא — ולכן
   * המונה עצמו פותח עכשיו את הרשימה, עם כפתור לכל שורה ואחד לכולן.
   */
  function missedHTML(day, list) {
    if (!showMiss) return "";
    const miss = missed(list);
    if (!miss.length) return "";

    const match = ctx.stopMatch(day);
    const pts = day.points || [];

    return `
      <div class="rt__missed">
        <button class="rt__alert-x" data-rt-missed aria-label="סגירה">✕</button>
        <b>${miss.length} תחנות בלי סימון</b>
        <p>עברנו אותן בלי לסמן הגעה. אם בכל זאת הייתם שם — סמנו כאן.</p>
        <ul>
          ${miss
            .map((i) => {
              const m = match[pts.indexOf(list[i])] || {};
              return `<li>
                <button class="rt__missed-go" data-rt-peek="${i}">
                  <span>${ctx.icon(list[i].type)}</span>
                  <b>${esc(list[i].name)}</b>
                  ${m.time ? `<small>${esc(m.time)}</small>` : ""}
                </button>
                <button class="btn btn--sm" data-rt-was="${i}">✅ הייתי</button>
              </li>`;
            })
            .join("")}
        </ul>
        ${miss.length > 1
          ? `<button class="btn btn--sm btn--primary" data-rt-was-all>✅ הייתי בכולן</button>`
          : ""}
      </div>`;
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
    const stt = stateOf(i);
    const done = stt === "done";
    const miss = stt === "miss";
    const ahead = i !== st.idx;

    // המרחק ממני לתחנה — הוא שקובע איזו דרך מוצעת ראשונה
    const me = pos ? travel(metres({ lat: pos.latitude, lng: pos.longitude }, p)) : null;
    const tips = ctx.tips ? ctx.tips(day, p) : [];

    return `
      <section class="rt__now${ahead ? " is-peek" : ""}${done ? " is-done" : ""}${
        miss ? " is-miss" : ""
      }">
        ${ahead
          ? `<button class="rt__peekbar${miss ? " is-miss" : ""}" data-rt-peek="${st.idx}">
               ${miss
                 ? `✕ התחנה הזו פוספסה · חזרה לתחנה שלי (${st.idx + 1})`
                 : i < st.idx
                 ? `↩︎ מסתכלים אחורה · חזרה לתחנה שלי (${st.idx + 1})`
                 : `👀 מציצים קדימה · חזרה לתחנה שלי (${st.idx + 1})`}
             </button>`
          : ""}

        <header class="rt__now-head">
          <span class="rt__now-icon" aria-hidden="true">${
            done ? "✅" : miss ? "✕" : ctx.icon(p.type)
          }</span>
          <div>
            <span class="rt__now-tag">תחנה ${i + 1} מתוך ${list.length}${
              m.time ? ` · ${esc(m.time)}` : ""
            }${done ? " · היינו" : miss ? " · פוספסה" : ""}</span>
            <h3>${esc(p.name)}</h3>
            <span class="rt__now-kind">${esc(ctx.label(p.type) || "")}</span>
          </div>
        </header>

        ${ahead ? aheadHTML(list, i) : compassHTML(p, list, i)}

        ${m.text
          ? `<p class="rt__what"><b>מה יש כאן:</b> ${esc(m.text)}</p>`
          : day.summary
          ? `<p class="rt__what">${esc(day.summary)}</p>`
          : ""}

        ${tips.length
          ? `<ul class="rt__tips">${tips.map((x) => `<li>💡 ${esc(x)}</li>`).join("")}</ul>`
          : ""}

        <div class="rt__acts">
          <a class="btn btn--primary" target="_blank" rel="noopener"
             href="${esc(navLink(p, me?.mode || "walking"))}">🧭 נווט לתחנה הזו${
               !ahead && me ? ` · ${esc(travelText(me))}` : ""
             }</a>
          ${/* במצב חוץ נשארים שני כפתורים בלבד, ואלה שני אלה: לאן, והגעתי */ ""}
          ${outdoor ? "" : `<a class="btn" target="_blank" rel="noopener"
             href="${esc(navLink(p, me?.far ? "walking" : "driving"))}">${
               me?.far ? "🚶 ברגל" : "🚗 ברכב"
             }</a>`}
          ${outdoor ? "" : `<a class="btn" target="_blank" rel="noopener"
             href="${esc(ctx.placeLink(p.name, p.lat, p.lng))}">ℹ️ על המקום</a>`}
          ${done
            ? `<button class="btn" data-rt-undo="${i}">↩︎ לא הייתי</button>`
            : miss
            ? `<button class="btn btn--primary" data-rt-was="${i}">✅ בכל זאת הייתי כאן</button>`
            : ahead
            ? `<button class="btn" data-rt-jump="${i}">📍 אני כאן</button>`
            : `<button class="btn" data-rt-arrive>✅ הגעתי</button>`}
          ${!ahead && !done && !outdoor && st.idx < list.length - 1
            ? `<button class="btn rt__skip" data-rt-skip
                 title="להתקדם לתחנה הבאה בלי לסמן ביקור">⤼ מדלגים</button>`
            : ""}
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

  /**
   * הזהות של מה שהמפה מציגה.
   *
   * זה מה שמונע את הקפיצות. ה-iframe נטען מחדש בכל פעם שה-`src` שלו
   * משתנה, והמיקום מהחיישן משתנה כל כמה שניות — כך שמפה שנבנית מחדש
   * עם כל קריאה נטענת מחדש בלי סוף. כאן המיקום מעוגל לשלוש ספרות
   * אחרי הנקודה, כלומר לכ-100 מטר: רעידות ה-GPS לא נחשבות שינוי,
   * והליכה אמיתית כן.
   */
  function mapKey(p) {
    const me = pos
      ? `${pos.latitude.toFixed(3)},${pos.longitude.toFixed(3)}`
      : "";
    const t = pos ? travel(metres({ lat: pos.latitude, lng: pos.longitude }, p)) : null;
    return `${p.lat},${p.lng}|${me}|${t?.far ? "d" : "w"}|${(localStorage.getItem(GKEY) || "").trim()}`;
  }

  /**
   * ה-iframe נוצר פעם אחת ו**עובר** בין הרינדורים.
   *
   * בניית ה-HTML מחדש יוצרת אלמנט חדש, ואלמנט חדש הוא טעינה חדשה של
   * המפה — הבהוב, קפיצה חזרה לזום ההתחלתי, ואיבוד הגרירה של המשתמש.
   * לכן אותו אלמנט בדיוק מועבר למקומו החדש, ו-`src` נכתב רק כשהזהות
   * שלמעלה באמת השתנתה.
   */
  function mountMap(p) {
    const sec = el.querySelector("[data-rt-map]");
    const slot = el.querySelector("[data-rt-frame]");
    if (!sec || !slot) return;

    sec.hidden = !p;
    if (!p) return;

    /*
     * ה-iframe נוצר פעם אחת ונשאר בדיוק במקומו.
     *
     * הניסיון הקודם היה להעביר אותו אל ה-DOM החדש בכל רינדור — וזו
     * בדיוק הפעולה שטוענת iframe מחדש. לכן הגוף מחולק: מה שמשתנה
     * נבנה מחדש מסביב למפה, והמפה עצמה לא נוגעים בה.
     */
    if (!mapFrame) {
      mapFrame = document.createElement("iframe");
      mapFrame.className = "rt__frame";
      mapFrame.loading = "lazy";
      mapFrame.referrerPolicy = "no-referrer-when-downgrade";
      slot.appendChild(mapFrame);
    }

    // הכותרת וההערה כן מתחלפות — הן טקסט, לא מסגרת
    const head = el.querySelector("[data-rt-map-head]");
    if (head) {
      head.innerHTML =
        `<h4>🗺️ ${esc(shortName(p.name))}</h4>
         <a class="btn btn--sm" target="_blank" rel="noopener"
            href="${esc(navLink(p, "walking"))}">פתח באפליקציה</a>`;
    }
    const note = el.querySelector("[data-rt-map-note]");
    if (note) note.innerHTML = keyHTML();

    const want = mapKey(p);
    if (want === mapShown) return;
    mapShown = want;
    mapFrame.title = `מפת Google לתחנה ${p.name}`;
    mapFrame.src = mapSrc(p);
  }

  /** שדה המפתח — בתוך המסך, ולא חלונית של הדפדפן */
  function keyHTML() {
    const key = (localStorage.getItem(GKEY) || "").trim();
    if (!keyEdit) {
      return `<p class="rt__map-note">
        ${key
          ? "מפה רשמית של Google Maps, עם המסלול מצויר."
          : "מפת Google בעברית. מפתח Embed API יצייר גם את המסלול עצמו על המפה."}
        <button class="btn btn--sm" data-rt-key>${key ? "שנה מפתח" : "הזן מפתח"}</button>
      </p>`;
    }
    return `
      <form class="rt__key" data-rt-key-form>
        <label for="rtKeyInput">מפתח Google Maps Embed API</label>
        <input id="rtKeyInput" type="text" dir="ltr" spellcheck="false"
               autocomplete="off" autocapitalize="off" placeholder="AIza…"
               value="${esc(key)}" />
        <div class="rt__key-acts">
          <button type="submit" class="btn btn--sm btn--primary">שמור</button>
          <button type="button" class="btn btn--sm" data-rt-key-cancel>ביטול</button>
          ${key ? `<button type="button" class="btn btn--sm" data-rt-key-clear>הסר מפתח</button>` : ""}
        </div>
        <small>נשמר במכשיר הזה בלבד ואינו נשלח לשום שרת.
          השימוש ב-Maps Embed API אצל Google חינמי וללא הגבלה.</small>
      </form>`;
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
              const stt = stateOf(i);
              const done = stt === "done";
              const gap = i > 0 ? metres(list[i - 1], p) : null;
              return `<li class="is-${stt}">
                <button class="rt__row" data-rt-peek="${i}">
                  <span class="rt__row-mark" aria-hidden="true">${
                    done ? "✅" : stt === "here" ? "▶️" : stt === "miss" ? "✕" : ctx.icon(p.type)
                  }</span>
                  <span class="rt__row-txt">
                    <b>${esc(p.name)}</b>
                    <small>${m.time ? esc(m.time) : ""}${
                      gap !== null ? `${m.time ? " · " : ""}${esc(human(gap))} מהקודמת` : ""
                    }${!m.time && gap === null ? "תחנה ראשונה" : ""}${
                      stt === "miss" ? " · פוספסה" : ""
                    }</small>
                  </span>
                </button>
                ${done
                  ? `<button class="rt__undo" data-rt-undo="${i}" title="לא הייתי שם">↩︎</button>`
                  : stt === "miss"
                  ? `<button class="rt__undo" data-rt-was="${i}" title="בכל זאת הייתי שם">✓</button>`
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
    const flow = el.querySelector("[data-rt-flow]");
    const tail = el.querySelector("[data-rt-tail]");
    const head = el.querySelector("[data-rt-head-txt]");
    const top = el.querySelector("[data-rt-top]");

    if (!day || !list.length) {
      head.textContent = "מסלול היום";
      top.innerHTML = "";
      tail.innerHTML = "";
      mountMap(null);
      flow.innerHTML = `<div class="rt__empty">
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
    el.querySelector(".rt").classList.toggle("is-out", outdoor);

    const toggle = el.querySelector("[data-rt-out]");
    if (toggle) {
      toggle.textContent = outdoor ? "⤢" : "🔆";
      toggle.title = outdoor ? "חזרה למסך המלא" : "מצב חוץ — גדול, לקריאה בהליכה";
      toggle.setAttribute("aria-pressed", String(outdoor));
    }

    flow.innerHTML =
      missedHTML(day, list) +
      alertHTML() +
      shiftHTML(day) +
      stopHTML(day, list);
    tail.innerHTML = listHTML(day, list);

    mountMap(list[viewIdx(list)]);

    // גלילה חלקה רק כשבאמת עברנו תחנה; ברענון התקופתי — בלי תנועה
    const vi = viewIdx(list);
    centreSpine(centred !== null && centred !== vi);
    centred = vi;
  }

  let centred = null;        // איזו תחנה כבר ממורכזת ברצועה

  /**
   * מרכוז הרצועה על התחנה שמוצגת.
   *
   * **לא `scrollIntoView`.** הוא נראה הפתרון הנקי, והוא גולל *כל* אב
   * שאפשר לגלול — כולל קופסאות `overflow: hidden`, שהן קופסאות גלילה
   * לכל דבר מבחינת סקריפט. זה מה שהזיז את כל הגיליון כמה פיקסלים
   * שמאלה, ודחף את הסרגל הצדי אל מחוץ למסך.
   *
   * במקומו: הפרש בין מרכז הסימון למרכז הרצועה, ו-`scrollLeft +=`. זה
   * נכון בלי לדעת מה מוסכמת ה-RTL של הדפדפן (אפס בהתחלה? שלילי?), כי
   * מודדים מלבנים אמיתיים ומזיזים יחסית — ונוגעים **רק** ברצועה.
   *
   * והוא לא רץ כשאין מה לעשות: הקוביה מתרעננת כל חצי דקה, וגלילה חלקה
   * בכל רענון היא רצועה שקופצת בלי סיבה.
   */
  function centreSpine(smooth) {
    const spine = el.querySelector("[data-rt-spine]");
    const mark = spine?.querySelector("li.is-view");
    if (!spine || !mark) return;

    const sb = spine.getBoundingClientRect();
    const mb = mark.getBoundingClientRect();
    const delta = Math.round(mb.left + mb.width / 2 - (sb.left + sb.width / 2));
    if (Math.abs(delta) <= 2) return;       // כבר במרכז

    spine.scrollTo({ left: spine.scrollLeft + delta, behavior: smooth ? "smooth" : "auto" });
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
      if (e.target.closest("[data-rt-skip]")) return skip();
      if (e.target.closest("[data-rt-head]")) return startHeading();
      if (e.target.closest("[data-rt-out]")) return setOutdoor(!outdoor);

      if (e.target.closest("[data-rt-missed]")) { showMiss = !showMiss; return render(); }

      if (e.target.closest("[data-rt-was-all]")) {
        const list = stops(ctx.day(st.n));
        missed(list).forEach((i) => { if (!st.done.includes(i)) st.done.push(i); });
        save();
        showMiss = false;
        return render();
      }

      const was = e.target.closest("[data-rt-was]");
      if (was) return markDone(Number(was.dataset.rtWas));

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
        keyEdit = true;
        render();
        el.querySelector("#rtKeyInput")?.focus();
        return;
      }
      if (e.target.closest("[data-rt-key-cancel]")) {
        keyEdit = false;
        return render();
      }
      if (e.target.closest("[data-rt-key-clear]")) {
        try { localStorage.removeItem(GKEY); } catch { /* מלא */ }
        keyEdit = false;
        mapShown = "";                 // המפה נטענת מחדש, הפעם בלי מפתח
        return render();
      }
    });

    el.addEventListener("submit", (e) => {
      if (!e.target.closest("[data-rt-key-form]")) return;
      e.preventDefault();
      const v = (el.querySelector("#rtKeyInput")?.value || "").trim();
      try {
        if (v) localStorage.setItem(GKEY, v);
        else localStorage.removeItem(GKEY);
      } catch { /* אחסון מלא */ }
      keyEdit = false;
      mapShown = "";                   // המפתח השתנה — המפה נטענת מחדש
      render();
    });

    document.addEventListener("keydown", (e) => {
      // Escape סוגר קודם את השדה, ורק אחר כך את המסך
      if (e.key !== "Escape" || !isOpen()) return;
      /* חלון שנפתח מעל המסלול — העוזר, כרטיס העלייה — סוגר את עצמו
         ב-Escape. בלי הבדיקה הזו אותה הקשה סגרה **גם** את המסלול
         שמתחתיו, והמשתמש מצא את עצמו בחוץ אחרי שאלה אחת לעוזר. */
      if (document.querySelector(OTHER_OVERLAY)) return;
      if (keyEdit) { keyEdit = false; return render(); }
      close();
    });
  }

  /**
   * מה כבר נעשה היום, לפי שם התחנה.
   *
   * מבט העל צובע את התרשים שלו מכאן, ולא מחשבון משלו: המצב נשמר
   * במסך המסלול, וסימון "היינו שם" שם חייב להיראות גם כאן. ההתאמה
   * לפי שם ולא לפי אינדקס, כי `stops()` מסנן את המלון ואת שדה
   * התעופה — ושני המספרים אינם אותו מספר.
   */
  function progress(day) {
    const out = {};
    if (!day || !ctx || typeof ctx.inDest !== "function") return out;
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SKEY(day.date)) || "null"); } catch { return out; }
    if (!s || s.n !== day.n || !s.startedAt) return out;
    const list = stops(day);
    const done = Array.isArray(s.done) ? s.done : [];
    list.forEach((p, i) => {
      if (done.includes(i)) out[p.name] = "done";
      else if (i === s.idx) out[p.name] = "now";
    });
    return out;
  }

  return { init, open, close, isOpen, progress, started: (date) => {
    try {
      const s = JSON.parse(localStorage.getItem(SKEY(date)) || "null");
      return s?.startedAt || null;
    } catch { return null; }
  } };
})();
