/* =========================================================================
   אפליקציית הטיולים — לוגיקת צד לקוח

   תלוי ב-trips.js (המאגר), ב-data.js (הטיולים המובנים) וב-Leaflet
   (אופציונלי — יש נפילה חיננית).

   TRIP אינו קבוע: הוא מצביע על הטיול הפעיל, ומוחלף במעבר בין טיולים.
   כל הרנדררים קוראים ממנו, ולכן מעבר טיול הוא renderTrip() אחד.
   ========================================================================= */
(function () {
  "use strict";

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** הטיול הפעיל. נקבע ב-init ומוחלף ב-switchTrip. */
  let TRIP = null;

  /** מפתח האחסון המקומי משויך לטיול — אחרת הוצאות זולגות בין טיולים */
  const storeKey = () => `trip:${TRIP?.id || "none"}:v1`;

  /* ==================================================================== */
  /*  עזרי פורמט                                                          */
  /* ==================================================================== */

  const nfILS = new Intl.NumberFormat("he-IL", {
    style: "currency", currency: "ILS", maximumFractionDigits: 0,
  });
  const nfILS2 = new Intl.NumberFormat("he-IL", {
    style: "currency", currency: "ILS", minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const nfNum = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });

  const ils  = (n) => nfILS.format(Math.round(n || 0));
  const ils2 = (n) => nfILS2.format(n || 0);

  /** טווח סכומים. הפורמט העברי מוסיף סימני כיווניות סביב כל מספר, ולכן
   *  מקף בין שניים נשבר בגלישת שורה ומתהפך. bdi + nowrap מבודדים אותו. */
  const ilsRange = (a, b) => `<bdi class="rng">${ils(a)} – ${ils(b)}</bdi>`;

  /** dd/mm — לתצוגה קומפקטית */
  function shortDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  function fullDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("he-IL", { day: "numeric", month: "long" });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ==================================================================== */
  /*  אחסון מקומי                                                         */
  /* ==================================================================== */

  const DEFAULT_STATE = {
    theme: "dark",
    rates: { "₾": 1.33, "$": 3.45, "€": 4.00, "£": 4.65, "₪": 1 },
    people: [
      { name: "גל",  group: 1 },
      { name: "נועה", group: 1 },
      { name: "חזי",  group: 2 },
      { name: "שרון", group: 2 },
    ],
    expenses: [],
    budget: null,
    packing: {},
    costOverrides: {},        // "groupKey:index" -> { low, high }
    costIncludeExtras: true,
  };

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(storeKey());
      if (!raw) return structuredClone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      return Object.assign(structuredClone(DEFAULT_STATE), parsed);
    } catch (err) {
      console.warn("שחזור הנתונים נכשל, מתחילים מחדש:", err);
      return structuredClone(DEFAULT_STATE);
    }
  }

  function save() {
    try {
      localStorage.setItem(storeKey(), JSON.stringify(state));
    } catch (err) {
      console.warn("שמירת הנתונים נכשלה:", err);
    }
  }

  /* ==================================================================== */
  /*  ערכת נושא                                                           */
  /* ==================================================================== */

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    $("#themeToggle").textContent = state.theme === "dark" ? "🌙" : "☀️";
  }

  $("#themeToggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    save();
  });

  $("#printBtn").addEventListener("click", () => window.print());
  $("#summaryBtn").addEventListener("click", printSummary);

  /* ==================================================================== */
  /*  לשוניות                                                             */
  /* ==================================================================== */

  const tabs = $$(".tab");

  function selectTab(tabEl) {
    tabs.forEach((t) => {
      const on = t === tabEl;
      t.setAttribute("aria-selected", String(on));
      $("#" + t.getAttribute("aria-controls")).classList.toggle("is-active", on);
    });
    // Leaflet מחשב גודל שגוי כשהמכל היה מוסתר — מרעננים בעת חשיפה
    if (tabEl.id === "tab-map" && map) setTimeout(() => map.invalidateSize(), 60);

    // בנייד סרגל הלשוניות נגלל אופקית; מוודאים שהנבחרת נראית במלואה
    tabEl.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    // ולא לראש הדף: מבט על יושב מעל הלשוניות, והקופץ אליו לא היה רואה
    // את מה שבחר. scroll-margin-top מפצה על הסרגל הדביק.
    $("main").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  tabs.forEach((t) => t.addEventListener("click", () => selectTab(t)));

  /* ==================================================================== */
  /*  ספירה לאחור                                                         */
  /* ==================================================================== */

  /**
   * מצב הטיול ביחס להיום.
   * אותו חישוב מזין את המשפט שבראש הדף ואת האריח בלשונית המידע.
   */
  function tripClock() {
    const start = new Date(TRIP.meta.startDate).getTime();
    const end = new Date(TRIP.meta.endDate).getTime();
    const now = Date.now();

    if (now < start) {
      const days = Math.ceil((start - now) / 86400000);
      return {
        tile: days === 1 ? "מחר!" : days + " ימים",
        label: "עד היציאה",
        lead: days === 1 ? "יוצאים מחר" : `עוד ${days} ימים ליציאה`,
      };
    }
    if (now <= end) {
      const n = Math.floor((now - start) / 86400000) + 1;
      return { tile: "יום " + n, label: "בטיול עכשיו", lead: `יום ${n} בטיול` };
    }
    return { tile: "הסתיים", label: "טיול שהיה", lead: "הטיול הסתיים" };
  }

  function tickCountdown() {
    const c = tripClock();
    const tile = $("#countdown");
    if (tile) {
      tile.textContent = c.tile;
      if (tile.nextElementSibling) tile.nextElementSibling.textContent = c.label;
    }
    const lead = $("#heroLead");
    if (lead) lead.textContent = c.lead;
  }

  /* ==================================================================== */
  /*  קוביית "עכשיו" — מה רלוונטי בשעה הזו                                */
  /* ==================================================================== */

  /**
   * מה שמוצג מתחת לכותרת הוא מה שצריך **ברגע הזה**, ולא סיכום של הטיול.
   * בבוקר של יום טיסה זו הטיסה, בשעת העלייה זו התראה ללכת לשער, באוויר
   * זה כמה נשאר, ובמהלך יום רגיל זו השורה הבאה בתוכנית.
   *
   * השוואות הזמן נעשות מול השעון של המכשיר, שהוא השעון של המקום שבו
   * המטייל נמצא — ולכן הן נכונות לשדה היציאה. **משך** הטיסה משמש לחישוב
   * מה שנותר באוויר ולא שעת הנחיתה, כי הנחיתה רשומה בשעון היעד: טיסת
   * החזרה ממריאה ב-12:05 בטביליסי ונוחתת ב-12:45 בישראל, וחיסור ישיר
   * שלהן היה נותן ארבעים דקות במקום שעתיים וארבעים.
   */

  const MIN = (hhmm) => {
    const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };

  const nowMin = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };

  const hhmm = (mins) => {
    const m = ((mins % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };

  /** "עוד 1:40" / "עוד 25 דק'" */
  function left(mins) {
    if (mins <= 0) return "עכשיו";
    if (mins < 60) return `עוד ${mins} דק'`;
    return `עוד ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")} שעות`;
  }

  /** קישור ניווט בין שתי נקודות, באופן ההגעה שנבחר */
  function dirLink(from, to, mode) {
    if (!from?.lat || !to?.lat) return "";
    return (
      "https://www.google.com/maps/dir/?api=1" +
      `&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}` +
      `&travelmode=${mode}`
    );
  }

  /* ------------------------------------------------------------------ */
  /*  שני שעונים                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * הפרש השעות בין היעד לבית, בדקות.
   *
   * אם אזור הזמן של היעד שמור במסמך — משתמשים בו. אם לא, הוא נגזר
   * מהטיסה עצמה: ההמראה רשומה בשעון המוצא והנחיתה בשעון היעד, ולכן
   * ההפרש ביניהן פחות משך הטיסה הוא בדיוק הפרש השעונים. בטביליסי:
   * 11:55 פחות (07:20 ועוד 2:35) = שעתיים.
   */
  function destDelta() {
    const out = TRIP.flights?.out;
    const dep = MIN(out?.dep);
    const arr = MIN(out?.arr);
    const dur = MIN(out?.duration);
    if (dep === null || arr === null || dur === null) return null;
    let d = arr - (dep + dur);
    while (d > 720) d -= 1440;
    while (d <= -720) d += 1440;
    return d;
  }

  /** השעה באזור זמן נתון, או null אם השם אינו מוכר לדפדפן */
  function timeIn(tz, when) {
    try {
      return new Intl.DateTimeFormat("he-IL", {
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
      }).format(when);
    } catch {
      return null;
    }
  }

  /**
   * שעון הבית ושעון היעד.
   *
   * שעון הבית מחושב תמיד מאזור הזמן ולא מהמכשיר, כי המכשיר מראה את
   * המקום שבו המטייל נמצא — ואחרי הנחיתה זה כבר לא הבית.
   */
  function clocks() {
    const now = new Date();
    const homeTz = TRIP.meta?.homeTz || "Asia/Jerusalem";
    const home = timeIn(homeTz, now) || hhmm(nowMin());

    const destTz = TRIP.meta?.tz;
    let dest = destTz ? timeIn(destTz, now) : null;
    if (!dest) {
      const d = destDelta();
      dest = d === null ? null : hhmm(MIN(home) + d);
    }
    if (!dest) return null;

    return {
      home,
      dest,
      label: TRIP.meta?.title || "היעד",
      same: home === dest,
    };
  }

  /**
   * הטמפרטורה במקום שאנחנו בו, בין שני השעונים.
   *
   * עדיפות ל-`tNow` — המדידה של עכשיו — ורק בהיעדרה לטווח היומי. השניים
   * אינם אותו דבר: 11°/2° אומר מה צפוי היום, ו-7° אומר מה ללבוש בדקה
   * הזו, וזה מה שמחפשים ברצועה שנמצאת תמיד על המסך.
   */
  function tempNow() {
    if (typeof LiveView === "undefined" || !LiveView.weatherFor) return "";
    const wx = LiveView.weatherFor();
    const today = todayISO();
    const d = (wx || []).find((x) => x.date === today);
    if (!d) return "";

    const value =
      d.tNow !== null && d.tNow !== undefined
        ? `${Math.round(d.tNow)}°`
        : d.tMax === null && d.tMin === null
        ? ""
        : `${Math.round(d.tMax ?? 0)}°/${Math.round(d.tMin ?? 0)}°`;
    if (!value) return "";

    const title = `${d.text} ב${d.place}`;
    return `<span class="clock clock--temp" title="${esc(title)}">
              <b>${esc(d.icon || "🌡️")} ${esc(value)}</b><small>${esc(d.place)}</small>
            </span>`;
  }

  function renderClocks() {
    const box = $("#heroClocks");
    if (!box) return;
    const c = clocks();
    if (!c) { box.hidden = true; return; }

    box.innerHTML = `
      <span class="clock clock--dest">
        <b>${esc(c.dest)}</b><small>${esc(c.label)}</small>
      </span>
      ${tempNow()}
      <span class="clock clock--home">
        <b>${esc(c.home)}</b><small>בית</small>
      </span>`;
    box.hidden = false;
  }

  /** מרחק אווירי בק"מ בין שתי נקודות */
  function kmBetween(a, b) {
    if (!a?.lat || !b?.lat) return null;
    const R = 6371;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /** שדה התעופה שנוחתים בו ביום הזה — זה שבתוך תיבת היעד */
  function arrivalPort(day) {
    return (day?.points || []).find((pt) => pt.type === "airport" && inDestination(pt)) || null;
  }

  /**
   * טיפ מהיום שמתאים למה שקורה עכשיו.
   *
   * ההתאמה היא לפי מילה משותפת ארוכה בין שורת התוכנית לבין הטיפ — שם
   * של מקום, בדרך כלל. זו לא הבנה של טקסט, ולכן כשאין התאמה לא מוצג
   * טיפ אקראי: טיפ שאינו קשור למה שמול העיניים הוא רעש.
   */
  function tipFor(day, item) {
    const tips = (day?.tips || []).filter(Boolean);
    if (!tips.length || !item?.text) return "";
    const words = String(item.text)
      .split(/[^\u0590-\u05FFA-Za-z']+/)
      .filter((w) => w.length >= 5);
    if (!words.length) return "";
    return tips.find((t) => words.some((w) => t.includes(w))) || "";
  }

  /** שעת העלייה למטוס. אם אינה רשומה בכרטיס — אומדן, ונאמר שהוא אומדן. */
  function boardingOf(leg) {
    const dep = MIN(leg.dep);
    if (leg.boarding && MIN(leg.boarding) !== null) {
      return { at: MIN(leg.boarding), exact: true };
    }
    return dep === null ? null : { at: dep - 40, exact: false };
  }

  /** רק השם, בלי קוד השדה והטרמינל שבתוך הסוגריים */
  const placeName = (s) => String(s || "").split("(")[0].replace(/·.*$/, "").trim();

  /* ---------- איך מגיעים מהשדה ללינה ---------- */

  /**
   * אופני ההגעה. מה שכתוב בהם מגיע ממסמך הטיול (`TRIP.arrival`), ולכן
   * הוא מה שהמטייל עצמו אישר ולא ידע כללי שהומצא כאן.
   *
   * הקישור למפות הוא התשובה שתמיד נכונה: הוא נפתח באפליקציית המפות עם
   * המוצא, היעד ואופן ההגעה שנבחר, והמסלול מחושב שם לפי המצב באותו רגע.
   */
  const WAYS = [
    { key: "taxi", icon: "🚕", label: "מונית", mode: "driving" },
    { key: "transit", icon: "🚌", label: "תחבורה ציבורית", mode: "transit" },
    { key: "walk", icon: "🚶", label: "ברגל", mode: "walking" },
  ];

  // הבחירה חיה כל עוד הקוביה פתוחה; היא מצוירת מחדש כל חצי דקה
  let arriveWay = null;

  /** כמה דקות לוקח לפי מה שכתוב באופציה ("20–25 דק'", "~שעה") */
  function wayMinutes(opt) {
    const t = String(opt?.time || "");
    const hours = t.match(/(\d+)\s*שעות/);
    if (hours) return Number(hours[1]) * 60;
    if (/שעה/.test(t)) return 60;
    const mins = [...t.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
    return mins.length ? Math.max(...mins) : null;
  }

  function arrivalCard(day, leg, from, m, preview) {
    /*
     * שעת ההגעה המשוערת נמדדת משעת הנחיתה כשמציצים קדימה, ומהשעה
     * הנוכחית כשבאמת נחתנו. הסיבה היא אזורי זמן: הזמן המוצג בהצצה הוא
     * בשעון המוצא, ושעת הנחיתה רשומה בשעון היעד — ובלי ההבחנה הזו
     * ההצצה הייתה מבטיחה הגעה למלון שעתיים לפני הנחיתה.
     */
    const base = preview && MIN(leg?.arr) !== null ? MIN(leg.arr) + 15 : m ?? nowMin();
    const hotel = day.hotel;
    const ways = (TRIP.arrival?.options || []).reduce((m, o) => ({ ...m, [o.key]: o }), {});
    // הליכה מוצעת רק כשהיא באמת אפשרית. משדה תעופה היא כמעט אף פעם לא.
    const far = kmBetween(from, hotel);
    const offered = WAYS.filter((w) => w.key !== "walk" || (far !== null && far < 4));
    const way = offered.find((w) => w.key === arriveWay);
    const chosen = way ? ways[way.key] : null;

    return {
      tone: "arrive",
      icon: "🧳",
      title: "נחתנו",
      main: hotel?.name ? `איך מגיעים ל-${hotel.name}?` : "איך מגיעים ללינה?",
      sub: way
        ? (chosen?.steps || []).join(" · ") ||
          "פתחו את המפות — המסלול מחושב שם לפי המצב עכשיו."
        : hotel?.area || "",
      facts: way
        ? [
            chosen?.time,
            chosen?.cost,
            // שעת ההגעה המשוערת ללינה — מה שבאמת רוצים לדעת ברגע הזה
            wayMinutes(chosen) && `מגיעים ~${hhmm(base + wayMinutes(chosen))}`,
            far && `${far.toFixed(0)} ק"מ אווירי`,
          ].filter(Boolean)
        : [
            leg?.arr && `נחתנו ב-${leg.arr}`,
            far && `${far.toFixed(0)} ק"מ מהשדה`,
          ].filter(Boolean),
      ways: offered.map((w) => ({ ...w, on: w.key === arriveWay })),
      dir: way ? dirLink(from, hotel, way.mode) : "",
      next: `כשתגיעו למלון אעבור אתכם על התוכנית של יום ${day.n}`,
      day: day.n,
    };
  }

  /**
   * מה להציג עכשיו. מחזיר תיאור בלבד — הציור נפרד, כדי שאפשר יהיה
   * לבדוק את ההחלטה עצמה בלי DOM.
   */
  function nowCard(at) {
    const f = TRIP.flights || {};
    const today = at?.date || todayISO();
    const m = at?.m ?? nowMin();

    /* ---------- טיסה היום ---------- */
    for (const key of ["out", "back"]) {
      const leg = f[key];
      if (!leg || leg.date !== today) continue;

      const dep = MIN(leg.dep);
      if (dep === null) continue;
      const board = boardingOf(leg);
      const dur = MIN(leg.duration) || 0;
      const land = dep + dur;
      const from = placeName(leg.from);
      const to = placeName(leg.to);

      // הטרמינל נלקח מתוך שם השדה ולא משדה terminal, שאינו עקבי: בהלוך
      // הוא טרמינל היציאה ובחזור הוא טרמינל הנחיתה. לפני הטיסה מעניין
      // מאיפה יוצאים, ובאוויר לאן מגיעים.
      const term = (txt) => (String(txt || "").match(/טרמינל\s*(\S+)/) || [])[1];
      const depTerm = term(leg.from);
      const arrTerm = term(leg.to);

      const facts = [
        leg.flightNo && `✈️ ${leg.flightNo}`,
        leg.gate && `שער ${leg.gate}`,
        (leg.seats || []).length && `מושב ${leg.seats.map((x) => x.seat).join(" · ")}`,
        leg.duration && `משך ${leg.duration}`,
      ].filter(Boolean);

      /*
       * אחרי הנחיתה: שעתיים של ליווי מהשדה ללינה.
       *
       * החלון נבדק פעמיים בכוונה. שעון המכשיר הוא שעון המקום שבו
       * המטייל נמצא: לפני ההמראה הוא שעון המוצא, ואחרי הנחיתה הוא כבר
       * שעון היעד. `land` מחושב משעת ההמראה ולכן נכון בשעון המוצא,
       * ו-`arr` רשומה בשעון היעד — כל אחד מהם נכון בצד שלו, ולכן
       * מקבלים את שניהם. המחיר הוא כיסוי רחב מהדרוש כששני השעונים
       * רחוקים זה מזה, וזה מחיר זול מאשר לפספס את הרגע שבו באמת צריך
       * את זה: יוצאים מהטרמינל עם מזוודות ומחפשים איך מגיעים.
       */
      const day = TRIP.days.find((d) => d.date === today);
      const arrM = MIN(leg.arr);
      const nearLanding =
        (m > land && m <= land + 120) || (arrM !== null && m >= arrM && m <= arrM + 120);
      if (nearLanding && key === "out" && day?.hotel) {
        return arrivalCard(day, leg, arrivalPort(day), m, Boolean(at));
      }
      if (m > land + 20) break;

      if (m >= board.at && m <= dep + 20) {
        return {
          tone: "alert",
          icon: "🛫",
          title: "עלייה למטוס",
          main: leg.gate
            ? `לכו לשער ${leg.gate} — ההמראה ב-${leg.dep}`
            : `לכו לשער. ההמראה ב-${leg.dep}${board.exact ? "" : " · שעת העלייה משוערת"}`,
          facts: [depTerm && `טרמינל ${depTerm}`, ...facts].filter(Boolean),
          pass: key,
          status: leg.flightNo,
          next:
            key === "out"
              ? "כשתנחתו אתן לכם את הדרכים להגיע למלון — מונית, תחבורה ציבורית, מחיר וזמן"
              : "אחרי ההמראה אראה לכם כמה נשאר עד הנחיתה",
        };
      }

      if (m > dep + 20 && m <= land) {
        return {
          tone: "air",
          icon: "🛬",
          title: "באוויר",
          main: `נוחתים${to ? " ב" + to : ""} ב-${leg.arr || hhmm(land)} — ${left(land - m)}`,
          facts: [arrTerm && `נחיתה בטרמינל ${arrTerm}`, ...facts].filter(Boolean),
          status: leg.flightNo,
          next:
            key === "out"
              ? "כשתנחתו אלווה אתכם מהטרמינל ועד המלון, עם מחיר וזמן לכל דרך"
              : "אחרי הנחיתה — הביתה. נתראה בטיול הבא.",
        };
      }

      const beAt = dep - Math.round((f.checkIn?.airportBefore ?? 3) * 60);
      return {
        tone: "soon",
        icon: "✈️",
        title: "טיסה היום",
        main: `${from} → ${to} · המראה ב-${leg.dep} · ${left(dep - m)}`,
        facts: [
          `עלייה למטוס ${hhmm(board.at)}${board.exact ? "" : " (משוער)"}`,
          m < beAt ? `להיות בשדה ב-${hhmm(beAt)}` : "",
          depTerm && `טרמינל ${depTerm}`,
          ...facts,
        ].filter(Boolean),
        pass: key,
        status: leg.flightNo,
        next: `ב-${hhmm(board.at)} אתריע לכם ללכת לשער, ואחרי ההמראה אלווה אתכם עד המלון`,
      };
    }

    /* ---------- יום בטיול ---------- */
    const day = TRIP.days.find((d) => d.date === today);
    if (day) {
      // הכול נגזר מ-m ולא מהשעון, כדי שהצצה לשלב הבא תראה את מה שיהיה
      // אז — ולא את מה שקורה עכשיו עם כותרת אחרת
      const rows = (day.plan || []).filter((p) => MIN(p.time) !== null);
      const past = rows.filter((p) => MIN(p.time) <= m);
      const now_ = past[past.length - 1];
      const next = rows.find((p) => MIN(p.time) > m);
      const prog = rows.length ? { done: past.length, total: rows.length } : null;

      /*
       * "💸 ₪2,720" לבדו אינו אומר אם זו ההוצאה של היום או של הטיול.
       * לכן שתי מילים: כמה יצא היום, וכמה יצא עד כה.
       */
      const spentToday = dayMoney(day);
      const spentTrip = state.expenses.length ? ils2(state.expenses.reduce((n, e) => n + toILS(e), 0)) : "";
      const facts = [
        prog && `${prog.done} מתוך ${prog.total} בתוכנית`,
        day.hotel?.name && `🛏️ ${day.hotel.name}`,
        spentToday ? `💸 ${spentToday} היום` : "💸 עדיין אין הוצאות היום",
        spentTrip && `📊 ${spentTrip} בטיול`,
      ].filter(Boolean);

      if (next) {
        const after = rows[rows.indexOf(next) + 1];
        return {
          tone: "day",
          icon: "📍",
          title: `יום ${day.n} · ${day.title || ""}`.trim(),
          main: `הבא בתור ${next.time} — ${next.text}`,
          sub: now_ ? `עכשיו: ${now_.text}` : "",
          tip: tipFor(day, now_ || next),
          facts,
          day: day.n,
          next: after
            ? `ואחר כך ${after.time} — ${after.text}`
            : day.hotel?.name
            ? `בסוף היום — חזרה ל${day.hotel.name}`
            : "",
        };
      }
      const tomorrow = TRIP.days.find((d) => d.n === day.n + 1);
      const first = (tomorrow?.plan || []).find((x) => MIN(x.time) !== null);
      return {
        tone: "night",
        icon: now_ ? "🌙" : "📍",
        title: `יום ${day.n} · ${day.title || ""}`.trim(),
        main: now_ ? "התוכנית של היום הושלמה." : "אין שעות בתוכנית של היום.",
        sub: day.hotel?.name ? `לינה: ${day.hotel.name}` : "",
        tip: tipFor(day, now_),
        facts,
        day: day.n,
        next: tomorrow
          ? `מחר — יום ${tomorrow.n}: ${tomorrow.title || ""}${first ? ` · מתחילים ב-${first.time}` : ""}`
          : "מחר — היום האחרון",
      };
    }

    /* ---------- לפני ואחרי ---------- */
    const out = f.out;
    const start = new Date(TRIP.meta.startDate).getTime();
    const nowTs = new Date(`${today}T12:00:00`).getTime();
    if (out?.date && nowTs < start) {
      const days = Math.ceil((new Date(out.date + "T12:00:00").getTime() - nowTs) / 86400000);
      return {
        tone: "pre",
        icon: "🧳",
        title: days <= 1 ? "יוצאים מחר" : `עוד ${days} ימים ליציאה`,
        main: `${placeName(out.from)} → ${placeName(out.to)} · המראה ב-${out.dep}${
          out.date ? " · " + fullDate(out.date) : ""
        }`,
        facts: [
          out.flightNo && `✈️ ${out.flightNo}`,
          (String(out.from || "").match(/טרמינל\s*(\S+)/) || [])[1] &&
            `טרמינל ${(out.from.match(/טרמינל\s*(\S+)/) || [])[1]}`,
        ].filter(Boolean),
        pass: "out",
        status: out.flightNo,
        next: "ביום הטיסה אלווה אתכם מהבית ועד המלון — מתי לצאת, מתי לעלות, ואיך מגיעים",
      };
    }
    return null;
  }

  /* ---------- התראת העלייה למטוס ---------- */
  /* התראת דפדפן נשלחת פעם אחת לטיסה, וכשהמשתמש אישר. היא עובדת כל עוד
     האפליקציה פתוחה בלשונית — אין כאן Service Worker, ולכן אין הבטחה
     שתגיע כשהטלפון נעול. הקוביה עצמה היא ההתראה האמיתית. */
  let notified = null;

  function notifyBoarding(card) {
    if (card.tone !== "alert") return;
    const key = `${todayISO()}:${card.pass}`;
    if (notified === key) return;
    notified = key;
    try {
      if (window.Notification && Notification.permission === "granted") {
        new Notification("עלייה למטוס", { body: card.main, tag: "boarding" });
      }
    } catch { /* דפדפן בלי התראות */ }
  }

  function askNotify() {
    if (!window.Notification) return;
    Notification.requestPermission().then(() => renderNow());
  }

  /**
   * בדיקת סטטוס הטיסה.
   *
   * אין כאן קריאה ל-API של סטטוס טיסות: שירות אמין כזה דורש מפתח בתשלום
   * (ראו "מה עוד אפשר לחבר" ב-README), ולהמציא מספר שער או עיכוב זה
   * בדיוק סוג המידע שאסור לנחש. הכפתור פותח חיפוש על מספר הטיסה, שבו
   * מופיע לוח הטיסות החי של גוגל — עם שער, עיכוב וסטטוס.
   */
  const statusLink = (flightNo) =>
    `https://www.google.com/search?q=${encodeURIComponent(String(flightNo) + " flight status")}`;

  /* ---------- מתי מתחילים את היום ---------- */

  /**
   * הזזה של כל שעות היום, כך שהשורה הראשונה נופלת בשעה שנבחרה.
   *
   * לא "להתעלם ממה שעבר": תוכנית שכתוב בה 08:30 ומתחילים אותה ב-11:00
   * שקרית בכל שורה ממנה והלאה. ההפרשים בין הסעיפים נשמרים — הם מה
   * שבאמת תוכנן — והשעות זזות יחד.
   */
  let startEdit = null;        // מספר היום שהעורך פתוח עליו

  /**
   * הזזה של **חלק** מהיום: כל שורה מ-`fromMin` והלאה.
   *
   * ביום טיסה אסור להזיז את כל היום. התוכנית פותחת ב-06:00 בנתב"ג,
   * וכשיוצאים לסיור ב-11:14 ההמראה לא זזה לאחר הצהריים — היא קרתה.
   * מה שזז הוא מה שעוד לא קרה, ומשם והלאה ההפרשים נשמרים.
   */
  function shiftFrom(day, fromMin, toMin) {
    const rows = (day.plan || []).filter(
      (p) => MIN(p.time) !== null && MIN(p.time) >= fromMin
    );
    if (!rows.length) return 0;
    const delta = toMin - MIN(rows[0].time);
    if (!delta) return 0;
    rows.forEach((row) => { row.time = hhmm(MIN(row.time) + delta); });
    return delta;
  }

  function shiftPlan(day, toMin) {
    const rows = (day.plan || []).filter((p) => MIN(p.time) !== null);
    if (!rows.length) return 0;
    const delta = toMin - MIN(rows[0].time);
    if (!delta) return 0;
    rows.forEach((row) => { row.time = hhmm(MIN(row.time) + delta); });
    return delta;
  }

  function startEditHTML(card) {
    if (startEdit !== card.day) return "";
    const day = TRIP.days.find((d) => d.n === card.day);
    const rows = (day?.plan || []).filter((p) => MIN(p.time) !== null);
    if (!rows.length) return "";
    const first = rows[0].time;
    const last = rows[rows.length - 1].time;
    return `
      <div class="now__start">
        <label>מתחילים את היום ב־
          <input type="time" data-start-at value="${esc(first)}" />
        </label>
        <p class="now__start-note" data-start-note>היום מתחיל עכשיו ב-${esc(first)} ונגמר ב-${esc(last)}.</p>
        <div class="now__start-acts">
          <button class="btn btn--sm" data-start-cancel>ביטול</button>
          <button class="btn btn--sm btn--primary" data-start-save>הזז את היום</button>
        </div>
      </div>`;
  }

  /** התיאור שמתחת לשדה, שמתעדכן עם כל שינוי */
  function startPreview() {
    const box = $("#nowBox");
    const input = $("[data-start-at]", box);
    const note = $("[data-start-note]", box);
    if (!input || !note) return;

    const day = TRIP.days.find((d) => d.n === startEdit);
    const rows = (day?.plan || []).filter((p) => MIN(p.time) !== null);
    const to = MIN(input.value);
    if (!rows.length || to === null) return;

    const delta = to - MIN(rows[0].time);
    const last = hhmm(MIN(rows[rows.length - 1].time) + delta);
    note.textContent = !delta
      ? `זו כבר שעת ההתחלה של היום.`
      : `${rows.length} שעות יזוזו ב-${Math.abs(Math.round(delta))} דקות ` +
        `${delta > 0 ? "קדימה" : "אחורה"}. היום ייגמר ב-${last}.`;
  }

  /* ---------- השלב הבא ---------- */

  /**
   * מתי מתחיל השלב הבא, ואיך קוראים לו.
   *
   * זה מה שמאפשר להציג אותו **עכשיו**: במקום לתאר אותו במילים, הכרטיס
   * של אותו רגע נבנה מראש ומוצג כמו שהוא. אותה פונקציה בדיוק, עם זמן
   * אחר — ולכן אין כאן תיאור שני שעלול לסתור את הראשון.
   */
  function nextStage(card) {
    const f = TRIP.flights || {};
    const today = todayISO();
    const leg = card.pass ? f[card.pass] : null;
    const dep = MIN(leg?.dep);
    const dur = MIN(leg?.duration) || 0;

    if (card.tone === "pre" && leg?.date) {
      return { date: leg.date, m: Math.max(0, dep - 120), label: "בוקר הטיסה" };
    }
    if (card.tone === "soon" && leg) {
      const b = boardingOf(leg);
      return { date: today, m: b.at + 5, label: "שעת העלייה למטוס" };
    }
    if (card.tone === "alert" && leg) {
      // מדלגים על "באוויר": הרמז בשעת העלייה מבטיח את הדרכים למלון,
      // וההצצה צריכה להראות בדיוק את מה שהובטח
      return card.pass === "out"
        ? { date: today, m: dep + dur + 15, label: "כשתנחתו" }
        : { date: today, m: dep + 40, label: "באוויר" };
    }
    if (card.tone === "air" && leg) {
      return { date: today, m: dep + dur + 10, label: "אחרי הנחיתה" };
    }
    if (card.tone === "arrive") {
      const day = TRIP.days.find((d) => d.date === today);
      const row = (day?.plan || []).find((x) => MIN(x.time) !== null && MIN(x.time) > nowMin());
      return row
        ? { date: today, m: MIN(row.time) + 1, label: `התוכנית של יום ${day.n}` }
        : null;
    }
    if (card.day) {
      const day = TRIP.days.find((d) => d.n === card.day);
      const rows = (day?.plan || []).filter((x) => MIN(x.time) !== null);
      const row = rows.find((x) => MIN(x.time) > nowMin());
      if (row) return { date: today, m: MIN(row.time) + 1, label: `השלב הבא · ${row.time}` };
      const tomorrow = TRIP.days.find((d) => d.n === card.day + 1);
      if (!tomorrow) return null;
      const first = (tomorrow.plan || []).find((x) => MIN(x.time) !== null);
      return { date: tomorrow.date, m: MIN(first?.time) ?? 540, label: `מחר · יום ${tomorrow.n}` };
    }
    return null;
  }

  // האם תצוגת השלב הבא פתוחה
  let peeking = false;

  /** הבחירות והמידע של כרטיס — אותו גוף בדיוק, בקוביה ובהצצה */
  function cardGuts(card) {
    return `
      ${card.sub ? `<p class="now__sub">${esc(card.sub)}</p>` : ""}
      ${card.ways
        ? `<p class="now__ways">${card.ways
            .map(
              (w) => `<button class="now__way ${w.on ? "is-on" : ""}" data-now-way="${w.key}">
                        ${w.icon} ${esc(w.label)}</button>`
            )
            .join("")}</p>`
        : ""}
      ${card.tip ? `<p class="now__tip">💡 ${esc(card.tip)}</p>` : ""}
      ${card.facts?.length
        ? `<p class="now__facts">${card.facts.map((t) => `<span>${esc(t)}</span>`).join("")}</p>`
        : ""}`;
  }

  /**
   * ההצצה אינה תקציר של השלב הבא אלא **השלב הבא עצמו**: אותן בחירות,
   * אותו מידע, ואותם כפתורים. מי שמציץ בשלב ההגעה יכול כבר עכשיו לבחור
   * מונית או תחבורה ציבורית ולראות מחיר, זמן ומסלול — ולא לחכות לנחיתה
   * כדי להתחיל להתארגן.
   */
  function peekHTML(card) {
    if (!peeking) return "";
    const at = nextStage(card);
    const soon = at ? nowCard(at) : null;
    if (!soon) {
      return '<div class="now__peek">אין שלב נוסף אחרי זה.</div>';
    }
    return `
      <div class="now__peek">
        <span class="now__peek-when">${esc(at.label)}</span>
        <b>${esc(soon.icon)} ${esc(soon.title)}</b>
        <p class="now__peek-main">${esc(soon.main)}</p>
        ${cardGuts(soon)}
        ${soon.dir
          ? `<p class="now__peek-go"><a class="btn btn--sm btn--primary" target="_blank"
               rel="noopener" href="${esc(soon.dir)}">🗺️ נווט</a></p>`
          : ""}
      </div>`;
  }

  /* ---------- לשאול את החבר ---------- */

  /**
   * השאלה שנשאלת בלחיצה אחת, לפי מה שקורה עכשיו.
   *
   * זו הנקודה שבה הקוביה מפסיקה להיות לוח מידע: היא יודעת איפה אנחנו
   * ומה הלאה, ולכן היא יכולה לשאול את השאלה הנכונה בלי שנקליד אותה.
   */
  function askPrompt(card) {
    const f = TRIP.flights || {};
    const leg = card.pass ? f[card.pass] : null;
    const place = TRIP.meta?.title || "";

    if (leg && ["soon", "alert", "air", "pre"].includes(card.tone)) {
      return (
        `מה הסטטוס של טיסה ${leg.flightNo} בתאריך ${fullDate(leg.date)}? ` +
        "האם יש עיכוב, מאיזה שער היא יוצאת, ומה השעה המעודכנת?"
      );
    }
    if (card.tone === "arrive") {
      return (
        `נחתנו עכשיו בנמל התעופה של ${place}. מה הדרך הכי טובה להגיע ל-` +
        `${TRIP.days?.[0]?.hotel?.name || "המלון"} עכשיו, כמה זה עולה וכמה זמן זה לוקח?`
      );
    }
    if (card.day) {
      return (
        `אנחנו ב${place}, ${card.main}. מה כדאי לדעת על זה עכשיו — שעות ` +
        "פתיחה, מחיר כניסה, תורים, ואיפה אוכלים טוב בסביבה?"
      );
    }
    return `מה כדאי לדעת היום על ${place} — מזג אוויר, אירועים, ומשהו ששווה לראות?`;
  }

  let answer = null;      // התשובה האחרונה, חיה כל עוד הדף פתוח
  let asking = false;

  /** מה שהחבר צריך לדעת כדי לענות — אותו הקשר לשאלה ולבדיקה היזומה */
  /**
   * איפה אנחנו ברגע הזה — בזמן, במסלול, ובמרחב.
   *
   * העוזר קיבל עד כה רק את התאריך, ולכן על "המלץ על מסעדה ביעד הבא" הוא
   * ענה "לא ברור לאיזה יום מתכוונים". זו הייתה שאלה שאפשר לענות עליה:
   * האפליקציה יודעת איזה יום היום, מה השעה, איזו עצירה כבר עברנו, ומי
   * שנתן הרשאת מיקום — גם איפה הוא עומד. שאלה שהמשתמש צודק בכך שאינה
   * אמורה להישאל.
   *
   * המיקום מגיע ממסך המסלול, שהוא היחיד שמבקש הרשאה. אם לא נתנו הרשאה
   * `where` הוא null, והמודל יודע שאין לו מיקום — ולא מנחש אחד.
   */
  function whereAmI() {
    const t = todayISO();
    const days = TRIP.days || [];
    const i = days.findIndex((d) => d.date === t);
    const day = i >= 0 ? days[i] : null;
    const after = i >= 0 ? days[i + 1] : days.find((d) => d.date > t);
    const d = new Date();
    const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

    const out = {
      date: t,
      clock,
      weekday: new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(d),
      beforeTrip: Boolean(days.length && t < days[0].date),
      afterTrip: Boolean(days.length && t > days[days.length - 1].date),
      today: day ? { n: day.n, title: day.title || "", region: day.region || "" } : null,
      tomorrow: after
        ? { n: after.n, date: after.date, title: after.title || "", region: after.region || "" }
        : null,
      doingNow: null,
      nextUp: null,
      visited: [],
      where: null,
    };

    if (day) {
      // מה כבר עבר ומה הבא בתור — לפי השעון, מתוך לוח הזמנים של היום
      const rows = (day.plan || []).filter((r) => /^\d{1,2}:\d{2}/.test(String(r.time || "")));
      const past = rows.filter((r) => r.time <= clock);
      out.doingNow = past.length ? { time: past[past.length - 1].time, text: past[past.length - 1].text } : null;
      const next = rows.find((r) => r.time > clock);
      out.nextUp = next ? { time: next.time, text: next.text } : null;

      // ומה סומן במסך המסלול עצמו — "היינו שם" ידני גובר על השעון
      const marks = (typeof DayRoute !== "undefined" && DayRoute.progress ? DayRoute.progress(day) : {}) || {};
      out.visited = Object.keys(marks).filter((k) => marks[k] === "done");
      const here = Object.keys(marks).find((k) => marks[k] === "now");
      if (here) out.atStop = here;
    }

    const fix = typeof DayRoute !== "undefined" && DayRoute.where ? DayRoute.where() : null;
    if (fix) {
      out.where = {
        lat: +fix.lat.toFixed(5),
        lng: +fix.lng.toFixed(5),
        accuracyM: fix.acc,
        minutesAgo: Math.round((Date.now() - fix.at) / 60000),
      };
      /* הנקודה הקרובה ביותר — "אני ליד X" קריא בהרבה מזוג קואורדינטות.
         החיפוש הוא על כל הטיול ולא רק על היום: מי שסטה מהמסלול עומד ליד
         מקום אמיתי, ושיוך היום אומר למודל אם הוא על המסלול או מחוצה לו. */
      let best = null;
      for (const dd of days) {
        for (const q of dd.points || []) {
          if (!q || !Number.isFinite(q.lat) || !Number.isFinite(q.lng)) continue;
          const km = kmBetween(fix, q);
          if (km !== null && (!best || km < best.km)) best = { km, name: q.name, day: dd.n };
        }
      }
      if (best) {
        out.where.nearest = {
          name: best.name,
          metres: Math.round(best.km * 1000),
          ofDay: best.day,
        };
      }
    }

    return out;
  }

  /** המיקום כמשפט אחד, לשאלות החיות של "בדוק עכשיו" */
  function spotLine() {
    const h = whereAmI();
    const bits = [];
    if (h.today) bits.push(`יום ${h.today.n} בטיול — ${h.today.title}`);
    if (h.where?.nearest) {
      bits.push(
        `אני ליד ${h.where.nearest.name} (${h.where.nearest.metres} מ׳)` +
          (h.where.minutesAgo > 10 ? `, מיקום מלפני ${h.where.minutesAgo} דקות` : "")
      );
    }
    if (h.doingNow) bits.push(`עכשיו לפי התוכנית: ${h.doingNow.time} ${h.doingNow.text}`);
    return bits.join(". ");
  }

  function nowContext() {
    const box = $("#nowBox");
    const leg = TRIP.flights?.out;
    return {
      trip: TRIP.meta?.title,
      place: TRIP.meta?.countries?.join(", ") || TRIP.meta?.title,
      when: new Date().toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }),
      state: box ? box.className.replace(/.*is-/, "") : "",
      now: $("#nowBox .now__sub")?.textContent || "",
      next: $("#nowBox .now__main")?.textContent || "",
      hotel: TRIP.days?.find((d) => d.date === todayISO())?.hotel?.name || "",
      /* ‎/api/ask מקבל שדות קצרים ומנוקים בלבד, ולכן המיקום מגיע אליו
         כמשפט אחד ולא כאובייקט. העוזר הגדול מקבל את הבלוק המלא. */
      spot: spotLine(),
      flight: leg ? `${leg.flightNo} ${leg.from} ${leg.dep} → ${leg.to} ${leg.arr}` : "",
    };
  }

  async function runAsk(question) {
    if (asking) return;
    asking = true;
    answer = { question, loading: true };
    renderNow();

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          code: localStorage.getItem("ai:code") || "",
          context: nowContext(),
        }),
      });
      const out = await TripAPI.readJson(res);
      if (!res.ok || !out || out.error) {
        throw new Error(out?.error || `הבדיקה נכשלה (${res.status})`);
      }
      answer = { question, ...out, at: new Date() };
    } catch (err) {
      answer = { question, error: err.message || "הבדיקה נכשלה." };
    } finally {
      asking = false;
      renderNow();
    }
  }

  /** החלק שמוצג אחרי שהחבר בדק */
  function answerHTML() {
    if (!answer) return "";

    // תשובה על שער, עיכוב או שעת פתיחה מתיישנת מהר. אחרי חצי שעה היא
    // נעלמת מעצמה, כדי שלא תישאר על המסך ותיראה כמו המצב עכשיו.
    if (answer.at && Date.now() - answer.at.getTime() > 30 * 60_000) {
      answer = null;
      return "";
    }

    const close = '<button class="now__x" data-now-close aria-label="סגירה">✕</button>';
    if (answer.loading) {
      return '<div class="now__answer is-wait">בודק ברשת…</div>';
    }
    if (answer.error) {
      return `<div class="now__answer is-bad">${close}${esc(answer.error)}</div>`;
    }
    const src = (answer.sources || [])
      .map(
        (x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>`
      )
      .join("");
    return `
      <div class="now__answer">
        ${close}
        <b>${esc(answer.headline || "")}</b>
        ${(answer.bullets || []).length
          ? `<ul>${answer.bullets.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
          : ""}
        ${answer.caution ? `<p class="now__warn">⚠️ ${esc(answer.caution)}</p>` : ""}
        <p class="now__src">
          ${answer.fresh ? "נבדק ברשת" : "מידע כללי, בלי חיפוש"}
          ${answer.at ? ` · ${answer.at.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}` : ""}
          ${src}
        </p>
        <form class="now__more" data-now-more>
          <input type="text" placeholder="לשאול משהו אחר…" aria-label="שאלה לחבר" />
          <button class="btn btn--sm" type="submit">שאל</button>
        </form>
      </div>`;
  }

  /**
   * שורת מזג האוויר שבראש הקוביה.
   *
   * היא מופיעה בכל מצב ולא רק ביום טיולים: גם בשדה התעופה ההחלטה מה
   * ללבוש כשיוצאים מהטרמינל היא החלטה, וגם בלילה מה לקחת למחר.
   * הטמפרטורה של עכשיו קודמת לטווח, והטווח נשאר לצידה — "9° עכשיו,
   * 11°/2° היום" זה מה שבאמת שואלים.
   */
  function wxLine(dayN) {
    if (typeof LiveView === "undefined" || !LiveView.weatherFor) return "";
    const wx = LiveView.weatherFor() || [];
    const d = wx.find((x) => x.n === dayN) || wx.find((x) => x.date === todayISO());
    if (!d) return "";

    const now =
      d.tNow !== null && d.tNow !== undefined ? `<b>${Math.round(d.tNow)}°</b>` : "";
    const span =
      d.tMax === null && d.tMin === null
        ? ""
        : `${Math.round(d.tMax ?? 0)}° / ${Math.round(d.tMin ?? 0)}°`;
    const rain = d.rainChance > 0 ? `💧 ${d.rainChance}%` : "";

    return `<p class="now__wx">
      <span aria-hidden="true">${esc(d.icon || "🌤️")}</span>
      ${now}${now && span ? ' <i>·</i> ' : ""}${esc(span)}
      <i>${esc(d.text || "")}</i>${rain ? ` <i>${esc(rain)}</i>` : ""}
      <small>${esc(d.place || "")}</small>
    </p>`;
  }

  // האם רשימת ההתראות שנסגרו פתוחה
  let showFound = false;

  /** כל מה שנמצא עד כה — נפתח מהמשולש, אחרי שסוגרים התראה */
  function foundListHTML() {
    const all = TripWatch.found();
    if (!showFound || !all.length) return "";
    return `
      <div class="now__found is-list">
        <button class="now__x" data-found-list="0" aria-label="סגירה">✕</button>
        <span class="now__found-tag">ההתראות שהיו</span>
        <ul>${all
          .map(
            (f) => `<li>
              <time>${new Date(f.at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}</time>
              ${f.alert ? "⚠️ " : ""}${esc(f.headline)}
            </li>`
          )
          .join("")}</ul>
      </div>`;
  }

  /** הידיעה האחרונה שהבדיקה היזומה מצאה, עד שסוגרים אותה */
  function foundHTML() {
    const found = TripWatch.unseen();
    if (!found) return foundListHTML();
    const src = (found.sources || [])
      .map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>`)
      .join("");
    const when = new Date(found.at).toLocaleTimeString("he-IL", {
      hour: "2-digit", minute: "2-digit",
    });
    return `
      <div class="now__found ${found.alert ? "is-alert" : ""}">
        <button class="now__x" data-found-close="${esc(found.id)}" aria-label="סגירה">✕</button>
        <span class="now__found-tag">${found.alert ? "⚠️ שים לב" : "מצאתי"} · ${esc(when)}</span>
        <b>${esc(found.headline)}</b>
        ${found.bullets.length
          ? `<ul>${found.bullets.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
          : ""}
        ${found.caution ? `<p class="now__warn">⚠️ ${esc(found.caution)}</p>` : ""}
        ${src ? `<p class="now__src">${src}</p>` : ""}
      </div>`;
  }

  /* ---------- רמת הליווי ---------- */

  function renderWatch() {
    const box = $("#watchLevels");
    if (!box) return;
    const now = TripWatch.level();
    box.innerHTML = TripWatch.LEVELS.map(
      (l) => `<button class="watch__level ${l.key === now ? "is-on" : ""}" data-watch="${l.key}">
                <b>${esc(l.label)}</b><small>${esc(l.note)}</small>
              </button>`
    ).join("");

    const chips = $("#watchTopics");
    const picked = TripWatch.topics();
    chips.innerHTML = TripWatch.TOPICS.map(
      (t) => `<button class="watch__topic ${picked.includes(t.key) ? "is-on" : ""}"
                data-topic="${t.key}">${t.icon} ${esc(t.label)}</button>`
    ).join("");

    const list = $("#watchLog");
    const rows = TripWatch.found();
    list.innerHTML = rows.length
      ? rows
          .map(
            (f) => `<li>
              <time>${new Date(f.at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}</time>
              <b>${esc(f.headline)}</b>
            </li>`
          )
          .join("")
      : '<li class="muted sm">עדיין לא נמצא משהו שהצדיק להפריע.</li>';
  }

  /* ------------------------------------------------------------------ */
  /*  חץ היום                                                            */
  /* ------------------------------------------------------------------ */
  /**
   * החץ שבצד הקוביה: כל תחנות היום מלמעלה למטה, ואיפה אנחנו עליו.
   *
   * הקוביה אומרת מה הבא בתור, אבל לא איפה זה יושב בתוך היום — האם זו
   * התחנה השנייה מתוך שמונה או האחרונה. החץ עונה על זה במבט: מה שמאחורינו
   * מלא, מה שלפנינו חלול, והנקודה הכחולה היא אנחנו.
   *
   * ── מאיפה יודעים איפה אנחנו ──
   * שלושה מקורות, מהאמין לפחות אמין, והראשון שיש לו מה לומר מנצח:
   *
   * 1. **מה שסומן במסך המסלול.** "הגעתי" ידני הוא עובדה ולא הערכה.
   * 2. **ה-GPS**, אם ניתנה הרשאה והמיקום טרי ואנחנו ממש ליד תחנה.
   * 3. **השעון מול לוח הזמנים.** בין שתי תחנות שיש להן שעה הנקודה נעה
   *    ביחס לזמן שעבר. זו הערכה — היא מניחה שעומדים בתוכנית — אבל היא
   *    תמיד זמינה, גם בלי הרשאה ובלי שפתחו את מסך המסלול.
   *
   * יום שאין לאף תחנה בו שעה, ושלא סומן בו דבר, מצויר בלי נקודה: חץ
   * שמראה מיקום מנוחש גרוע מחץ שאינו מראה מיקום.
   */
  function railState(day) {
    const pts = (day.points || []).filter((q) => q && q.name);
    const n = pts.length;
    const state = pts.map(() => "");
    let at = null;              // המיקום על החץ, ביחידות של תחנות: 2.5 = בין השלישית לרביעית

    const marks = dayMarks(day);
    const fix = typeof DayRoute !== "undefined" && DayRoute.where ? DayRoute.where() : null;
    const d = new Date();
    const clock = d.getHours() * 60 + d.getMinutes();

    if (Object.keys(marks).length) {
      let last = -1;
      pts.forEach((q, i) => {
        state[i] = marks[q.name] || "";
        if (state[i]) last = i;
      });
      const here = state.indexOf("now");
      // בין תחנה שסומנה לבאה אחריה: באמצע הדרך, כי אין מה שיאמר יותר מזה
      at = here >= 0 ? here : last >= 0 ? Math.min(last + 0.5, n - 1) : null;
    } else {
      const times = pts.map((q) => MIN(pointTime(day, q)));
      const timed = times.map((t, i) => (t === null ? -1 : i)).filter((i) => i >= 0);
      const k = [...timed].reverse().find((i) => times[i] <= clock);
      if (k !== undefined) {
        const m = timed.find((i) => i > k);
        const f = m === undefined ? 0 : (clock - times[k]) / Math.max(times[m] - times[k], 1);
        at = m === undefined ? k : k + (m - k) * Math.min(f, 1);
        pts.forEach((_, i) => { if (i < at - 0.2) state[i] = "done"; });
        if (Math.abs(at - Math.round(at)) <= 0.2) state[Math.round(at)] = "now";
      } else if (timed.length) {
        at = -1;                // היום עוד לא התחיל
      }
    }

    // GPS טרי ליד תחנה גובר על השעון, אבל לא על סימון ידני
    if (fix && !Object.keys(marks).length && Date.now() - fix.at < 15 * 60_000) {
      let best = null;
      pts.forEach((q, i) => {
        if (!Number.isFinite(q.lat) || !Number.isFinite(q.lng)) return;
        const km = kmBetween(fix, q);
        if (km !== null && km <= 0.2 && (!best || km < best.km)) best = { km, i };
      });
      if (best) {
        at = best.i;
        pts.forEach((_, i) => { state[i] = i < best.i ? "done" : i === best.i ? "now" : ""; });
      }
    }

    return { pts, state, at };
  }

  function railHTML(day) {
    if (!day || typeof DayScene === "undefined") return "";
    const { pts, state, at } = railState(day);
    if (pts.length < 2) return "";

    const n = pts.length;
    const attrs = stopAttrs(day);
    /* התחנות מפוזרות ברווחים שווים, ולכן מיקום על החץ הוא חלק יחסי מהגובה
       שבין מרכז התחנה הראשונה למרכז האחרונה. שני הקבועים הם הריפוד
       שמעל הראשונה ומתחת לאחרונה — אותם ערכים שב-CSS. */
    const along = (t) =>
      `calc(var(--rail-top) + var(--rail-dot) / 2 + (100% - var(--rail-top) - var(--rail-end) - var(--rail-dot)) * ${
        Math.round((Math.max(0, Math.min(t, n - 1)) / (n - 1)) * 1000) / 1000})`;

    const done = at === null || at < 0 ? "0px" : along(at);
    const between = at !== null && at >= 0 && !state.includes("now");

    const here = state.indexOf("now");
    const label =
      here >= 0 ? `אנחנו ב${pts[here].name}`
      : at === null ? "תחנות היום"
      : at < 0 ? "היום עוד לא התחיל"
      : `אנחנו בין ${pts[Math.floor(at)].name} ל${pts[Math.min(Math.ceil(at), n - 1)].name}`;

    return `
      <div class="now__rail" style="--rail-n:${n}" role="group" aria-label="${esc(label)}" title="${esc(label)}">
        <i class="now__rail-done" style="block-size:${done}"></i>
        ${pts
          .map(
            (q, i) => `<button type="button" class="now__stop${state[i] ? " is-" + state[i] : ""}"
              ${attrs(q, i, n)} aria-label="${esc(q.name)}">
              <svg viewBox="0 0 24 24" aria-hidden="true">${DayScene.glyph(DayScene.kindOf(q))}</svg>
            </button>`
          )
          .join("")}
        ${between ? `<i class="now__me" style="inset-block-start:${along(at)}"></i>` : ""}
      </div>`;
  }

  function renderNow() {
    const box = $("#nowBox");
    // נקראת גם מתוך זרימת הסנכרון, שרצה לפני שהטיול נטען
    if (!box || !TRIP?.days?.length) return;
    const card = nowCard();
    if (!card) { box.hidden = true; return; }

    const wantsBell =
      card.tone !== "alert" &&
      Boolean(card.pass) &&
      window.Notification &&
      Notification.permission === "default";

    const at = nextStage(card);

    box.className = `now wrap is-${card.tone}`;
    box.innerHTML = `
      <span class="now__walker" aria-hidden="true"><span>🚶</span></span>
      <div class="now__side">
        <span class="now__icon" aria-hidden="true">${card.icon}</span>
        ${card.day ? railHTML(TRIP.days.find((d) => d.n === card.day)) : ""}
      </div>
      <div class="now__body">
        <button class="now__who" data-now-settings
                title="רמת הליווי ונושאי העניין">חבר/ה מלווה ⚙︎</button>
        <b class="now__title">${esc(card.title)}</b>
        ${wxLine(card.day)}
        <p class="now__main">${esc(card.main)}</p>
        ${cardGuts(card)}
        ${startEditHTML(card)}
        ${card.next
          ? `<button class="now__next" data-now-peek aria-expanded="${peeking}">
               ${esc(card.next)}
               ${at ? `<span class="now__peek-cue">${peeking ? "סגירה" : "להציץ"}</span>` : ""}
             </button>`
          : ""}
        ${peekHTML(card)}
        ${foundHTML()}
        ${answerHTML()}
      </div>
      <div class="now__acts">
        ${!TripWatch.unseen() && TripWatch.found().length
          ? `<button class="btn btn--sm now__bell" data-found-list="1"
               title="ההתראות שנסגרו">⚠️<span>${TripWatch.found().length}</span></button>`
          : ""}
        <button class="btn btn--sm" data-now-ask ${asking ? "disabled" : ""}
                title="בדיקה ברשת לרגע הזה">${asking ? "בודק…" : "🔎 בדוק עכשיו"}</button>
        ${card.dir ? `<a class="btn btn--sm btn--primary" target="_blank" rel="noopener"
             href="${esc(card.dir)}">🗺️ נווט</a>` : ""}
        ${card.pass ? `<button class="btn btn--sm${card.tone === "alert" ? " btn--primary" : ""}"
             data-pass-leg="${esc(card.pass)}">🎫 כרטיס עלייה</button>` : ""}
        ${card.status ? `<a class="btn btn--sm" target="_blank" rel="noopener"
             title="סטטוס הטיסה, עיכובים ושער — נפתח בחיפוש"
             href="${esc(statusLink(card.status))}">🔄 סטטוס</a>` : ""}
        ${card.day ? `<button class="btn btn--sm btn--primary" data-route-day="${card.day}"
             title="מסך המסלול: תחנה־תחנה, עם ניווט לכל אחת">🚶 יוצאים למסלול</button>` : ""}
        ${card.day ? `<button class="btn btn--sm" data-start-day="${card.day}">🕐 שעת התחלה</button>` : ""}
        ${card.day ? `<button class="btn btn--sm" data-food-near=""
             title="מסעדות, בתי קפה וברים ליד המקום שבו אנחנו">🍽️ אוכל</button>` : ""}
        ${card.day ? `<button class="btn btn--sm" data-add-exp>➕ הוצאה</button>` : ""}
        ${card.day ? `<button class="btn btn--sm" data-ov-open="${card.day}">היום המלא</button>` : ""}
        ${wantsBell ? '<button class="btn btn--sm" data-now-bell title="התראה בשעת העלייה למטוס, כל עוד האפליקציה פתוחה">🔔</button>' : ""}
      </div>`;
    box.hidden = false;
    notifyBoarding(card);
  }

  /* ==================================================================== */
  /*  מפה                                                                 */
  /* ==================================================================== */

  let map = null;
  const dayLayers = new Map();   // מספר יום -> L.LayerGroup
  let activeDay = "all";

  // נקבע ב-renderDays; משמש את החלונית שמעל המפה כדי לקפוץ לכרטיס היום המלא
  let openDayCard = () => {};

  const TYPE_ICON = {
    airport: "✈️", station: "🚆", hotel: "🛏️", sight: "📷",
    hike: "🥾", food: "🍽️", town: "🏘️", car: "🚗", pass: "⛰️",
  };

  /* =====================================================================
     מבט על הטיול — החלק המוביל של המסך

     מי שפותח את האפליקציה צריך לראות קודם כל **את הטיול**: מה המבנה שלו,
     איך הוא זורם, מה עושים בכל יום ואיפה אנחנו בתוכו. המספרים (כמה ימים,
     כמה ק"מ) הם מידע על הטיול, לא הטיול עצמו — הם ירדו למשפט אחד בראש
     הדף ולאריחים בלשונית המידע.

     הטווח נבחר כמו בלוח שנה — כל הטיול, השבוע, שלושה ימים או היום — וכל
     יום נפתח במקום לתכנון היומי המלא שלו.
     ===================================================================== */

  /* =====================================================================
     מבט על הטיול — הלשונית הראשונה

     זה המסך שנפתח: הרצועה, ובה עמודה לכל יום עם הנקודות שבו. לחיצה על
     יום פותחת **חלון** של אותו יום בלבד, ולא מנווטת ללשונית אחרת —
     המסלול היומי המלא ממשיך לחיות בלשונית שלו.

     בוחר הטווח ירד. הוא קבע כמה עמודות נכנסות לרוחב המסך, ואין יותר
     עמודות: הבוחר מראה את כל ימי הטיול, והמסך מראה יום אחד בכל פעם.
     בטיול של שישה ימים הוא ממילא הסתיר ימים בלי להרוויח דבר.
     ===================================================================== */

  /** צבע לכל סוג נקודה. אותם טוקנים ששאר האפליקציה משתמשת בהם. */
  const OV_TONE = {
    airport: "rose", station: "rose",
    hotel: "heather",
    sight: "moss", town: "moss",
    food: "gold",
    hike: "sky", pass: "sky", car: "sky",
  };

  /** שם הסוג בעברית, למי שלא מזהה את האייקון */
  const TYPE_LABEL = {
    airport: "שדה תעופה", station: "תחנה", hotel: "לינה", sight: "אתר",
    hike: "מסלול הליכה", food: "אוכל", town: "עיירה", car: "רכב",
    pass: "מעבר הרים", city: "עיר",
  };

  /**
   * תאריך היום לפי השעון של המכשיר.
   *
   * לא toISOString(): הוא מחזיר UTC, ולכן בחצות ועד השעתיים שאחריה הוא
   * היה מחזיר את אתמול — בדיוק בשעות שבהן יוצאים לטיסת בוקר.
   */
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  };
  const ovShortDate = (iso) => (iso ? `${+iso.slice(8, 10)}.${+iso.slice(5, 7)}` : "");
  const ovSlashDate = (iso) => (iso ? `${+iso.slice(8, 10)}/${+iso.slice(5, 7)}` : "");

  /** היום שאליו גוללים: הנוכחי אם הטיול רץ, אחרת קצה הטיול */
  function anchorIndex() {
    const t = todayISO();
    const i = TRIP.days.findIndex((d) => d.date === t);
    if (i >= 0) return i;
    return TRIP.days[0] && t < TRIP.days[0].date ? 0 : Math.max(TRIP.days.length - 1, 0);
  }

  function dayStatus(day) {
    const t = todayISO();
    if (day.date < t) return "past";
    if (day.date === t) return "now";
    return "future";
  }

  /**
   * איפה אנחנו בתוך היום, לפי השעון.
   * השעות מרופדות באפס ("09:00"), ולכן השוואת מחרוזות נכונה כאן.
   */
  function dayProgress(day) {
    const rows = (day.plan || []).filter((p) => /^\d{1,2}:\d{2}/.test(String(p.time || "")));
    if (!rows.length) return null;
    const now = new Date();
    const hhmm =
      String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    return {
      done: rows.filter((p) => p.time <= hhmm).length,
      total: rows.length,
      next: rows.find((p) => p.time > hhmm) || null,
    };
  }

  /** סך ההוצאות שנרשמו בתאריך הזה, בשקלים */
  function dayMoney(day) {
    const rows = (state.expenses || []).filter((e) => e.date === day.date);
    return rows.length ? ils2(rows.reduce((sum, e) => sum + toILS(e), 0)) : "";
  }

  /**
   * רגל הטיסה שמתרחשת ביום הזה, אם יש כזו.
   *
   * ההתאמה לפי תאריך ולא לפי מספר היום: רגל שעברה ליום אחר אחרי עריכה
   * עדיין תימצא, ויום שאינו יום טיסה לא ייתפס בטעות.
   */
  function flightOfDay(day) {
    const f = TRIP.flights || {};
    if (f.out?.date && f.out.date === day.date) return f.out;
    if (f.back?.date && f.back.date === day.date) return f.back;
    return null;
  }

  /**
   * יום השבוע בקיצור, לעמודות צרות: ג׳ במקום שלישי.
   *
   * נגזר מהתאריך ולא מהמחרוזת שבמסמך, כי המחרוזת יכולה להיות כתובה
   * בכל צורה — ואות ראשונה של "שישי" ושל "שבת" היא אותה אות.
   */
  function dowShort(day) {
    if (!day?.date) return "";
    try {
      const d = new Date(day.date + "T12:00:00");
      // he-IL מחזיר כבר "ג׳" עם גרש; הוספת גרש נוספת נתנה "ג׳׳"
      return new Intl.DateTimeFormat("he-IL", { weekday: "narrow" }).format(d);
    } catch {
      return String(day.dow || "").slice(0, 1);
    }
  }

  /** צ'יפ אחד: אייקון תמיד, ערך כשיש מקום לו בעמודה */
  const ovChip = (icon, value, attr = "") =>
    `<span class="ov-chip" ${attr} ${value ? "" : "hidden"}><b>${icon}</b><i>${esc(value || "")}</i></span>`;

  /* ------------------------------------------------------------------ */
  /*  הרצועה                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * היום שמוצג בתרשים. `null` עד הציור הראשון, שבוחר את היום הנוכחי.
   * הערך "all" הוא התרשים של כל הטיול: כל הימים זה לצד זה.
   */
  let ovDay = null;
  const OV_ALL = "all";

  /* ------------------------------------------------------------------ */
  /*  בוחר הימים + התרשים של היום הנבחר                                  */
  /* ------------------------------------------------------------------ */
  /**
   * קודם היה כאן בר לכל יום: עמודה של קוביות אפורות. זו הייתה רשימה
   * שמחופשת לתמונה — יום הליכה בעיר העתיקה, יום נסיעה בכביש הררי ויום
   * טיסה נראו בה אותו דבר בדיוק, ונבדלו רק בטקסט שבתוך הקוביות.
   *
   * עכשיו למעלה יש שורת ימים — מספר, יום בשבוע ותאריך — ומתחתיה היום
   * שנבחר **מצויר**: מסלול מתפתל בין התחנות על רקע שמתאים לאופי היום.
   * הציור עצמו חי ב-scene.js; כאן רק מרכיבים לו את הנתונים.
   */
  function renderOverview() {
    const strip = $("#ovDays");
    const scene = $("#ovScene");
    if (!strip || !scene) return;

    const all = TRIP.days || [];
    if (!all.some((d) => (d.points || []).some((q) => q && q.name))) {
      strip.innerHTML = "";
      scene.className = "ovs";
      scene.innerHTML =
        '<p class="overview__empty">לטיול הזה עדיין אין נקודות על המפה. ' +
        'הוסיפו אותן בעריכת היום או דרך העוזר, והן יופיעו כאן.</p>';
      return;
    }

    const days = all;
    if (ovDay === null) {
      const anchor = (all[anchorIndex()] || {}).n;
      ovDay = days.some((d) => d.n === anchor) ? anchor : days[0].n;
    } else if (ovDay !== OV_ALL && !days.some((d) => d.n === ovDay)) {
      ovDay = days[0].n;
    }

    /* "כל הטיול" ראשון בשורה, לפני יום 1: הוא אינו עוד יום אלא המבט
       הרחב שממנו יורדים אל יום. בטיול של יום אחד אין לו מה להוסיף. */
    const allOn = ovDay === OV_ALL;
    const allBtn = days.length > 1
      ? `<button type="button" role="tab" aria-selected="${allOn}"
            class="ovd ovd--all${allOn ? " is-on" : ""}"
            data-ov-day-pick="${OV_ALL}" title="תרשים של כל ימי הטיול">
            <b>כל הטיול</b>
            <i>${days.length} ימים</i>
            <i class="ovd__date">${ovSlashDate(days[0].date)}–${ovSlashDate(days[days.length - 1].date)}</i>
          </button>`
      : "";
    if (allOn && !allBtn) ovDay = days[0].n;

    strip.innerHTML = allBtn + days
      .map((day) => {
        const on = day.n === ovDay;
        return `<button type="button" role="tab" aria-selected="${on}"
            class="ovd is-${dayStatus(day)}${on ? " is-on" : ""}"
            data-ov-day-pick="${day.n}" title="${esc(day.title || "")}">
            <b>יום ${day.n}</b>
            <i class="ovd__dow">יום ${esc(dowShort(day))}</i>
            <i class="ovd__date">${ovSlashDate(day.date)}</i>
          </button>`;
      })
      .join("");

    paintScene();
    scrollToDay();
  }

  /** מה כבר נעשה ביום — נקרא ממסך המסלול, לא מחושב כאן מחדש */
  /* `const DayRoute` בקובץ סקריפט רגיל אינו נכס של window — הוא קיים
     כשם בלבד. בדיקה דרך window הייתה תמיד שקרית, והסימונים לא הופיעו. */
  const dayMarks = (day) =>
    (typeof DayRoute !== "undefined" && DayRoute.progress ? DayRoute.progress(day) : {}) || {};

  /**
   * התכונות שתחנה נושאת אל החלון שנפתח עליה.
   *
   * פונקציה אחת לשני התרשימים — של היום ושל כל הטיול — כדי שהקשה על
   * אותה תחנה תפתח את אותו חלון בדיוק, לא משנה מאיפה הגיעו אליה.
   */
  function stopAttrs(day) {
    const pts = (day.points || []).filter((q) => q && q.name);
    const leg = flightOfDay(day);
    const firstAir = pts.findIndex((q) => q.type === "airport");

    /* קצה טיסה נושא את פרטי ההמראה או הנחיתה, וכך הכרטיס שנפתח עליו
       הוא כרטיס העלייה למטוס ולא קישור למפה של שדה תעופה */
    const notes = stopMatch(day);
    return (q, i, total) => {
      const at = (day.points || []).indexOf(q);
      const note = explain(q, notes[at]?.text);
      let extra =
        `data-ov-kind="${esc(DayScene.kindOf(q))}"` +
        (note ? ` data-ov-note="${esc(note)}"` : "");
      if (q.type === "airport" && leg) {
        const no = leg.flightNo ? esc(leg.flightNo) + " · " : "";
        const term = leg.terminal ? ` · טרמינל ${esc(leg.terminal)}` : "";
        extra += " " + (
          i === firstAir
            ? `data-ov-icon="🛫" ${leg.dep ? `data-ov-detail="${no}המראה ${esc(leg.dep)}${term}"` : ""}`
            : `data-ov-icon="🛬" ${leg.arr ? `data-ov-detail="${no}נחיתה ${esc(leg.arr)}"` : ""}`);
      }
      return segData(day, q, i, total, extra);
    };
  }

  /**
   * התרשים של כל הטיול: עמודה לכל יום, כל הימים זה לצד זה.
   *
   * הקשה על כותרת של יום יורדת אל התרשים שלו, והקשה על תחנה פותחת את
   * אותו חלון שנפתח בתרשים היומי. הציור עצמו ב-scene.js.
   */
  function paintTrip() {
    const scene = $("#ovScene");
    const days = TRIP.days || [];
    if (!scene || typeof DayScene === "undefined" || !DayScene.tripSvg) return;

    const stops = days.reduce(
      (sum, d) => sum + (d.points || []).filter((q) => q && q.name).length, 0);
    const km = days.reduce((sum, d) => sum + (Number(d.drive?.km) || 0), 0);
    const attrs = new Map();
    const marks = new Map();

    scene.className = "ovs ovs--trip";
    scene.innerHTML = `
      <div class="ovs__head">
        <b>${esc(TRIP.meta?.title || "כל הטיול")}</b>
        <span>${days.length} ימים · ${stops} תחנות</span>
      </div>
      <div class="ovs__art ovs__art--trip" style="--tc-n:${days.length}">${DayScene.tripSvg(days, {
        status: dayStatus,
        dow: (d) => dowShort(d),
        date: (d) => ovSlashDate(d.date),
        foot: (d) => {
          const mode = TRIP.modes?.[d.mode] || {};
          const n = (d.points || []).filter((q) => q && q.name).length;
          return d.drive?.km >= 20
            ? `${mode.icon || "🚗"} ${nfNum.format(d.drive.km)} ק"מ`
            : `${n} תחנות`;
        },
        state: (d, q) => {
          if (!marks.has(d.n)) marks.set(d.n, dayStatus(d) === "now" ? dayMarks(d) : {});
          return marks.get(d.n)[q.name] || "";
        },
        data: (d, q, i, total) => {
          if (!attrs.has(d.n)) attrs.set(d.n, stopAttrs(d));
          return attrs.get(d.n)(q, i, total);
        },
      })}</div>
      <div class="ovs__foot">
        <span class="ovs__meta">הקישו על יום כדי לפתוח את התרשים שלו${
          km ? ` · ${nfNum.format(km)} ק"מ בסך הכול` : ""
        }</span>
      </div>`;

    // טיול ארוך נגלל הצידה, ואז מה שצריך להיות מול העיניים הוא היום הנוכחי
    const art = scene.querySelector(".ovs__art--trip");
    const now = art?.querySelector(".tc-col.is-now .tc-head");
    if (art && now && art.scrollWidth > art.clientWidth + 2) {
      const a = art.getBoundingClientRect();
      const b = now.getBoundingClientRect();
      art.scrollLeft += b.left + b.width / 2 - (a.left + a.width / 2);
    }
  }

  /** התרשים של היום הנבחר, והשורה שמתחתיו */
  function paintScene() {
    const hint = $("#ovHint");
    if (hint) {
      hint.textContent = ovDay === OV_ALL
        ? "כל ימי הטיול בתמונה אחת. הקישו על תחנה כדי לקרוא עליה, ועל כותרת של יום כדי לפתוח את התרשים המלא שלו."
        : "הקישו על תחנה בתרשים כדי לקרוא עליה, ועל ⓘ שבסוף המסלול כדי לפתוח את הפירוט המלא של היום.";
    }
    if (ovDay === OV_ALL) return paintTrip();

    const scene = $("#ovScene");
    const day = (TRIP.days || []).find((d) => d.n === ovDay);
    if (!scene || !day || typeof DayScene === "undefined") return;

    const pts = (day.points || []).filter((q) => q && q.name);
    const marks = dayMarks(day);
    const attrs = stopAttrs(day);

    const mode = TRIP.modes[day.mode] || {};
    const km = day.drive?.km
      ? `${mode.icon || "🚗"} ${nfNum.format(day.drive.km)} ק"מ`
      : `${mode.icon || ""} ${esc(mode.label || "")}`.trim();
    const hhmm = (day.plan || [])
      .map((x) => String(x.time || "").trim())
      .filter((t) => /^\d/.test(t));
    const span = hhmm.length > 1 ? `${hhmm[0]}–${hhmm[hhmm.length - 1]}` : hhmm[0] || "";

    scene.className = `ovs ovs--${DayScene.sceneOf(day)} is-${dayStatus(day)}`;
    scene.innerHTML = `
      <div class="ovs__head">
        <b>${esc(day.profile || day.title || "")}</b>
        <span>${esc(DayScene.sceneLabel(day))} · ${pts.length} תחנות</span>
      </div>
      <div class="ovs__art">${DayScene.svg(day, {
        times: pts.map((q) => pointTime(day, q)),
        state: pts.map((q) => marks[q.name] || ""),
        tone: pts.map((q) => OV_TONE[q.type] || "mute"),
        data: attrs,
      })}</div>
      <div class="ovs__foot">
        <span class="ovs__meta">${km}${span ? ` · <i>${esc(span)}</i>` : ""}</span>
        <span class="ov-day__chips">
          ${ovChip("🌤️", "", `data-jwx="${day.n}"`)}
          ${day.hotel?.name ? ovChip("🛏️", day.hotel.name) : ""}
          ${ovChip("📎", "", `data-jdocs="${day.n}"`)}
          ${ovChip("💸", dayMoney(day), `data-jmoney="${day.n}"`)}
        </span>
      </div>`;
  }

  /**
   * גלילת הבוחר אל היום הנבחר.
   *
   * חישוב הפרש מלבנים ולא scrollIntoView: הוא גולל **כל** אב שאפשר
   * לגלול, כולל תיבות overflow:hidden שהן מבחינת הדפדפן מיכלי גלילה,
   * ובטלפון זה מה שגרם לרצועה לקפוץ.
   */
  function scrollToDay() {
    const strip = $("#ovDays");
    const btn = strip?.querySelector(".ovd.is-on");
    if (!strip || !btn) return;
    const a = strip.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const delta = b.left + b.width / 2 - (a.left + a.width / 2);
    if (Math.abs(delta) > 2) {
      strip.scrollTo({ left: strip.scrollLeft + delta, behavior: "smooth" });
    }
  }

  /** התכונות שהנקודה נושאת איתה אל הכרטיס שמתחת לרצועה */
  /**
   * השעות של עצירות היום, לפי שורות התוכנית שמדברות עליהן.
   *
   * הנקודות עצמן אינן נושאות שעה — השעות חיות בתוכנית היומית, וזה
   * המקום הנכון להן: הן נערכות שם, הן מוזזות שם כששעת ההתחלה משתנה,
   * ואין שני מקומות שיכולים לסתור זה את זה.
   *
   * ההתאמה היא טקסטואלית, ולכן היא גם יכולה לטעות — ושעה שגויה על
   * עצירה גרועה מעצירה בלי שעה. שלושה מסננים מחזיקים אותה ישרה:
   *
   * 1. מילים כלליות (שם העיר, המדינה, "המלון") אינן נחשבות התאמה.
   *    בלעדיהן "המוזיאון הלאומי של גאורגיה" נתלה על שורת הנחיתה,
   *    רק מפני ששתיהן מזכירות את גאורגיה.
   * 2. כששורות אחדות מתאימות, מנצחת זו עם המילה המשותפת הארוכה ביותר.
   * 3. הזמנים חייבים לעלות לפי סדר העצירות. עצירה שמקבלת שעה מוקדמת
   *    משקודמתה — ההתאמה שלה שגויה, והיא נשארת בלי שעה.
   */
  const STOP_WORDS = new Set(["המלון", "מלון", "העיר", "העתיקה", "מרכז", "רחוב", "כיכר"]);

  const timeCache = new Map();

  /**
   * המילים שאפשר לתלות עליהן התאמה לשם של נקודה.
   *
   * שם העיר, שם המדינה ו"המלון" מופיעים בחצי מהשורות ואינם מזהים דבר —
   * בלעדיהם "המוזיאון הלאומי של גאורגיה" היה נתלה על שורת הנחיתה, רק
   * מפני ששתיהן מזכירות את גאורגיה.
   */
  function genericWords() {
    const generic = new Set([...STOP_WORDS]);
    [TRIP.meta?.title, ...(TRIP.meta?.countries || [])].forEach((v) => {
      String(v || "").split(/\s+/).forEach((w) => { if (w.length >= 4) generic.add(w); });
    });
    return generic;
  }

  function nameWords(name) {
    const generic = genericWords();
    return String(name || "")
      .split(/[^\u0590-\u05FFA-Za-z']+/)
      .filter((w) => w.length >= 4 && !generic.has(w));
  }

  /**
   * האם נקודות המפה של היום עדיין מתארות את לוח הזמנים שלו.
   *
   * ליום יש שני ייצוגים — `plan` שאנשים קוראים ו-`points` שמהם נבנים
   * מבט העל, מסלול היום, הקו על המפה, הקישור ל-Google Maps וקובץ
   * הנקודות שיורד. כשהם נסחפים, חמישה מסכים מראים יום אחר מזה שבתכנון.
   *
   * הסימן אינו "השתנה משהו" אלא **כמה מהנקודות אינן מוזכרות בלוח הזמנים
   * בכלל**. שם של נקודה שאינו מופיע באף שורה הוא מקום שאיש כבר לא הולך
   * אליו. שדה תעופה והמלון אינם נספרים — הם לעולם אינם מוזכרים כתחנה,
   * וזה תקין.
   */
  function daySync(day) {
    const pts = (day?.points || []).filter(
      (p) => p && p.name && p.type !== "airport" && p.type !== "hotel"
    );
    const rows = (day?.plan || []).filter((r) => String(r.text || "").trim());
    if (pts.length < 2 || rows.length < 2) return { ok: true, lost: [], total: pts.length };

    const text = rows.map((r) => r.text).join(" | ");
    const lost = pts.filter((p) => {
      const words = nameWords(p.name);
      return words.length ? !words.some((w) => text.includes(w)) : false;
    });

    /*
     * שדה נוסף שנסחף יחד עם היום: ק"מ הנסיעה. יום שהפך לעירוני ונשאר
     * עם 310 ק"מ מציג מספר שגוי בכרטיס, במבט העל ובאריחי העלות. זה
     * נבדק מהעובדות ולא מניחוש: אם כל נקודות היום בטווח קטן, אי אפשר
     * שנסעו בו מאות קילומטרים.
     */
    let far = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = kmBetween(pts[i], pts[j]);
        if (d > far) far = d;
      }
    }
    const km = Number(day?.drive?.km) || 0;
    const drive = pts.length >= 2 && far < 25 && km > 50 ? { km, far: Math.round(far) } : null;

    // עד שליש "אבוד" זה רעש של ניסוח; מעבר לזה היום באמת התחלף
    return { ok: lost.length <= pts.length / 3 && !drive, lost, drive, total: pts.length };
  }

  /** ק"מ אוויריים בין שתי נקודות */
  function kmBetween(a, b) {
    const p = Math.PI / 180;
    const s =
      Math.sin(((b.lat - a.lat) * p) / 2) ** 2 +
      Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lng - a.lng) * p) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(s));
  }

  /** תוצאת ההתאמה האחרונה, מוצגת בכרטיס היום שבו היא נעשתה */
  let syncNote = null;      // { n, text, bad }
  let syncing = 0;

  /**
   * הטיפים של היום שמדברים על נקודה מסוימת.
   *
   * טיפ שנכתב ליום שלם ("קחו מזומן לרכבל") שייך לתחנה שהוא מדבר עליה,
   * ושם הוא גם נקרא — ברשימה הכללית של היום הוא עוד שורה, ובתחנה הוא
   * הדבר שצריך לדעת עכשיו.
   */
  function tipsForPoint(day, p) {
    const words = nameWords(p?.name);
    if (!words.length) return [];
    return (day?.tips || []).filter((t) => words.some((w) => String(t).includes(w)));
  }

  /**
   * ההתאמה עצמה — שעה **וגם** הטקסט של השורה שהתאימה.
   *
   * הטקסט הוא מה שהופך את מסך המסלול למשהו שאפשר ללכת לפיו: "תחנה 3"
   * אינו אומר דבר, ו"סיור בעיר העתיקה, כולל המרחצאות הגופריתיים" אומר
   * לאן אנחנו הולכים ולמה. זה אותו חיפוש שנתן את השעה, ולכן אין כאן
   * מקור שני שיכול לסתור.
   */
  function stopMatch(day) {
    const rows = (day?.plan || []).filter((r) => MIN(r.time) !== null);
    const pts = day?.points || [];
    const key = `${day?.n}|${rows.map((r) => r.time).join()}|${pts.length}`;
    const hit = timeCache.get(key);
    if (hit) return hit;

    const out = pts.map((p) => {
      const words = nameWords(p?.name);
      let best = null;
      for (const r of rows) {
        const text = String(r.text || "");
        for (const w of words) {
          if (text.includes(w) && (!best || w.length > best.len)) {
            best = { time: r.time, text: r.text || "", len: w.length };
          }
        }
      }
      return best ? { time: best.time, text: best.text } : { time: "", text: "" };
    });

    // סדר עולה: עצירה שקיבלה שעה מוקדמת מקודמתה התאימה לשורה הלא נכונה
    let floor = -1;
    for (let i = 0; i < out.length; i++) {
      if (!out[i].time) continue;
      const m = MIN(out[i].time);
      if (m < floor) out[i] = { time: "", text: "" };
      else floor = m;
    }

    timeCache.set(key, out);
    if (timeCache.size > 40) timeCache.clear();
    return out;
  }

  const stopTimes = (day) => stopMatch(day).map((x) => x.time);

  const pointTime = (day, p) => {
    const i = (day?.points || []).indexOf(p);
    return i < 0 ? "" : stopTimes(day)[i] || "";
  };

  function segData(day, p, i, total, extra = "") {
    const geo = Number.isFinite(p.lat) && Number.isFinite(p.lng)
      ? `data-ov-lat="${p.lat}" data-ov-lng="${p.lng}"`
      : "";
    const at = pointTime(day, p);
    return `data-ov-name="${esc(p.name)}" data-ov-type="${esc(p.type || "")}"
      data-ov-day="${day.n}" data-ov-i="${i + 1}" data-ov-total="${total}"
      ${at ? `data-ov-time="${esc(at)}"` : ""}
      ${p.img ? `data-ov-img="${esc(p.img)}"` : ""} ${geo} ${extra}`;
  }

  /**
   * קישור שפותח נקודה באפליקציית המפות של המכשיר.
   *
   * `google.com/maps/search` ולא `geo:` — הסכמה של geo עובדת באנדרואיד
   * ולא בספארי, וכתובת https נפתחת באפליקציה המותקנת בשני המכשירים
   * ונופלת לדפדפן כשאין כזו.
   *
   * **השם והקואורדינטה יחד.** קואורדינטה לבדה פותחת סיכה על מפה, בלי
   * שם, בלי שעות פתיחה, בלי ביקורות ובלי כפתור "ניווט" לשם — וזה בדיוק
   * מה שרוצים ממקום. שם לבדו הוא חיפוש, ו"מצודת נריקלה" עלול לנחות על
   * מצודה אחרת. הצורה `/search/<שם>/@<נ״צ>,17z` מחפשת את השם **סביב**
   * הנקודה, ולכן מקבלים את כרטיס המקום הנכון.
   */
  function placeMapsLink(name, lat, lng) {
    const at = `${lat},${lng}`;
    /*
     * שמות במסמך הם תיאוריים: "פארק ריקה — תחנת רכבל", "סטפנצמינדה
     * (קזבגי)". מה שאחרי המקף או בסוגריים הוא הסבר שלנו ולא שם שגוגל
     * מכיר, והוא מה שיכול להפוך חיפוש מוצלח לחיפוש ריק.
     */
    const q = String(name || "")
      .split(/\s[—–-]\s/)[0]
      .replace(/\s*\(.*$/, "")
      .trim();
    return q
      ? `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${at},17z`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(at)}`;
  }

  function renderJourney() {
    renderOverview();

    // הבחירה שייכת לתרשים שהיה; תרשים חדש מתחיל בלי תחנה נבחרת
    closePop();
    paintJourneyChips();
  }

  /* ------------------------------------------------------------------ */
  /*  הצ'יפים שמגיעים ממקורות אסינכרוניים או משתנים תוך כדי              */
  /* ------------------------------------------------------------------ */

  function setChip(el, icon, value) {
    if (!el) return;
    if (icon) $("b", el).textContent = icon;
    $("i", el).textContent = value || "";
    el.hidden = !value;
  }

  function paintJourneyChips() {
    (TRIP.days || []).forEach((day) => {
      setChip($(`[data-jmoney="${day.n}"]`), "", dayMoney(day));
    });
    if (typeof LiveView !== "undefined") paintJourneyWeather();
  }

  function paintJourneyWeather() {
    const wx = LiveView.weatherFor ? LiveView.weatherFor() : null;
    if (!wx) return;
    wx.forEach((d) => {
      const el = $(`[data-jwx="${d.n}"]`);
      if (!el) return;
      const temps =
        d.tMax === null && d.tMin === null
          ? ""
          : `${Math.round(d.tMax ?? 0)}°/${Math.round(d.tMin ?? 0)}°`;
      setChip(el, d.icon, temps);
      el.title = `${d.text} ב${d.place}`;
    });
    renderClocks();          // הרצועה מציגה את הטמפרטורה של היום
    renderNow();             // והקוביה את מזג האוויר של היום
  }

  /* ------------------------------------------------------------------ */
  /*  הנקודה שנבחרה                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * ברצועה נשאר מקום לאייקון בלבד, ולכן מי שמקיש על נקודה צריך לקבל כאן
   * את כל מה שהיא: השם המלא, לאיזה יום היא שייכת ובאיזה שלב בו, ואיך
   * להגיע אליה על המפה.
   *
   * ה-thumbnail הוא תמונת המקום כשיש כזו (point.img), והאייקון של הסוג
   * כשאין. אין כאן קריאה לשום שירות חיצוני מהדפדפן.
   */
  /** איזו רגל טיסה יוצאת או נוחתת ביום הזה — לפי התאריך */
  function legKeyOfDay(n) {
    const day = TRIP.days.find((d) => d.n === Number(n));
    const f = TRIP.flights || {};
    if (day && f.back?.date === day.date) return "back";
    return "out";
  }

  /**
   * ההסבר שמופיע בחלון התחנה.
   *
   * המקור הוא שורת התוכנית היומית שמדברת על התחנה, ולא טקסט שני שנכתב
   * במיוחד לכאן. טקסט שני היה הופך לסותר ברגע שהעוזר משנה את היום —
   * התוכנית הייתה מתעדכנת וההסבר לא, ואין דרך לדעת מי מהם נכון.
   */
  function explain(p, text) {
    let t = String(text || "").trim();
    if (!t) return "";

    // הכותרת כבר אומרת את השם: "שוק דזרטירי — שוק המזון הגדול של
    // טביליסי" מופיע בחלון כ-"שוק המזון הגדול של טביליסי"
    const name = String(p?.name || "").trim();
    if (name && t.startsWith(name)) {
      t = t.slice(name.length).replace(/^\s*[—–\-:,]\s*/, "").trim() || t;
    }

    // שניים-שלושה משפטים. החלון קטן בכוונה, ומי שרוצה את הכול — הטיפים,
    // שאר שורות התוכנית, המלון והמסמכים — פותח את הפירוט היומי מה-i.
    const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    let out = parts.slice(0, 3).join(" ");
    if (out.length > 240) out = out.slice(0, 239).replace(/\s+\S*$/, "") + "…";
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  חלון התחנה                                                        */
  /* ------------------------------------------------------------------ */
  /**
   * לחיצה על סמל בתרשים פותחת חלון קטן וצף מעליו.
   *
   * קודם נפתח כרטיס מתחת לתרשים, והוא היה רחוק: בתרשים של שמונה תחנות
   * הסמל שנלחץ והכרטיס שנפתח לא היו על המסך יחד, והיה צריך לגלול כדי
   * לקשר ביניהם. חלון שנפתח **ליד הסמל** אינו דורש את הקישור הזה.
   *
   * החלון חי בסוף ה-body ולא בתוך מבט העל: הוא position:fixed, וכל אב
   * עם transform או filter היה הופך אותו לממוקם ביחס לאב במקום למסך.
   */
  let popAt = null;              // הסמל שהחלון תלוי בו

  function openPop(seg) {
    const box = $("#ovPop");
    if (!box) return;
    const d = seg.dataset;
    const label = TYPE_LABEL[d.ovType] || "נקודה";
    // קצה טיסה נושא את פרטי ההמראה או הנחיתה; שאר התחנות את מקומן ביום
    const meta = d.ovDetail
      ? `${d.ovDetail} · יום ${d.ovDay}`
      : `${d.ovTime ? d.ovTime + " · " : ""}${label} · יום ${d.ovDay} · עצירה ${d.ovI} מתוך ${d.ovTotal}`;

    const art = d.ovImg
      ? `<img src="${esc(d.ovImg)}" alt="" loading="lazy" />`
      : `<svg viewBox="0 0 24 24" aria-hidden="true">${
          typeof DayScene === "undefined" ? "" : DayScene.glyph(d.ovKind)
        }</svg>`;

    const act = d.ovDetail
      ? `<button type="button" class="btn btn--sm btn--primary"
           data-pass-leg="${esc(legKeyOfDay(d.ovDay))}">🎫 כרטיס עלייה</button>`
      : d.ovLat && d.ovLng
      ? `<button type="button" class="btn btn--sm" data-food-near="${esc(foodAnchorOf(d))}"
           title="מסעדות, בתי קפה וברים ליד ${esc(d.ovName)}">🍽️ אוכל בסביבה</button>
         <a class="btn btn--sm" target="_blank" rel="noopener"
           title="${esc(d.ovName)} — נפתח באפליקציית המפות, ובמחשב ב-Google Maps"
           href="${esc(placeMapsLink(d.ovName, d.ovLat, d.ovLng))}">🗺️ פתח במפות</a>`
      : `<button type="button" class="btn btn--sm" data-focus="${esc(d.ovDay)}">🗺️ על המפה</button>`;

    box.className = `pop pop--${OV_TONE[d.ovType] || "mute"}`;
    box.innerHTML = `
      <button type="button" class="pop__x" data-pop-close aria-label="סגירת החלון">✕</button>
      <div class="pop__head">
        <span class="pop__art">${art}</span>
        <span class="pop__ttl">
          <b id="ovPopName">${esc(d.ovName)}</b>
          <small>${esc(meta)}</small>
        </span>
      </div>
      ${d.ovNote ? `<p class="pop__txt">${esc(d.ovNote)}</p>` : ""}
      ${rateLine(d.ovName)}
      <div class="pop__acts">${act}</div>`;

    box.hidden = false;
    popAt = seg;
    placePop();
    box.querySelector(".pop__x")?.focus({ preventScroll: true });
  }

  /** הדירוג שנתתם למקום בשטח, אם נתתם */
  function rateLine(name) {
    const r = typeof TripGuide !== "undefined" ? TripGuide.rateOf(name) : null;
    if (!r) return "";
    return (
      `<p class="pop__rate"><b aria-label="${r.stars} מתוך 5">${"★".repeat(r.stars)}` +
      `<i>${"★".repeat(5 - r.stars)}</i></b>${r.note ? ` ${esc(r.note)}` : ""}</p>`
    );
  }

  /**
   * המזהה של תחנה בחיפוש האוכל: המלון, או היום והמקום שלה ברשימת היום.
   * ההתאמה לפי שם ולא לפי המספר שעל הסמל — הסמל סופר רק נקודות שיש להן
   * שם, והחיפוש צריך את המקום ברשימה המלאה.
   */
  function foodAnchorOf(d) {
    if (d.ovType === "hotel") return "hotel";
    const day = (TRIP.days || []).find((x) => x.n === Number(d.ovDay));
    const i = (day?.points || []).findIndex((q) => q && q.name === d.ovName);
    return i >= 0 ? `p:${day.n}:${i}` : "";
  }

  /**
   * מתחת לסמל כשיש מקום, מעליו כשאין, ותמיד בתוך המסך.
   *
   * נקרא גם בגלילה: החלון ממוקם ביחס לחלון התצוגה והסמל ממוקם ביחס
   * לדף, ובלי זה הם היו נפרדים ברגע שהמשתמש גולל.
   */
  function placePop() {
    const box = $("#ovPop");
    if (!box || box.hidden || !popAt) return;
    const a = popAt.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const pad = 8;

    let left = a.left + a.width / 2 - w / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));

    let top = a.bottom + 10;
    if (top + h > window.innerHeight - pad) top = a.top - h - 10;
    top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));

    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  }

  function closePop() {
    const box = $("#ovPop");
    popAt = null;
    if (!box || box.hidden) return;
    box.hidden = true;
    $$("#ovScene .is-on").forEach((el) => el.classList.toggle("is-on", false));
  }

  function bindPop() {
    // סגירה: ה-X, לחיצה מחוץ לחלון, או Escape
    document.addEventListener("click", (e) => {
      if ($("#ovPop")?.hidden) return;
      if (e.target.closest("[data-pop-close]")) return closePop();
      if (e.target.closest("#ovPop")) return;          // פעולה בתוך החלון
      if (e.target.closest("[data-ov-name]")) return;  // מעבר לתחנה אחרת
      closePop();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePop();
    });

    // גלילה ושינוי גודל: החלון נשאר תלוי בסמל שלו
    let waiting = false;
    const follow = () => {
      if (waiting) return;
      waiting = true;
      requestAnimationFrame(() => { waiting = false; placePop(); });
    };
    window.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", follow, { passive: true });
  }

  /* ------------------------------------------------------------------ */
  /*  חלון היום                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * לחיצה על יום פותחת אותו כאן ולא מנווטת ללשונית אחרת.
   *
   * זה אותו גוף בדיוק של כרטיס היום במסלול היומי — הוא נכתב פעם אחת
   * ומשרת את שניהם. העריכה נשארת בלשונית המסלול, כדי שלא יהיו שני
   * עורכים פתוחים על אותו יום.
   */
  function openDayModal(n) {
    const day = TRIP.days.find((d) => d.n === Number(n));
    if (!day) return;
    closePop();

    const prog = dayStatus(day) === "now" ? dayProgress(day) : null;
    const money = dayMoney(day);

    $("#dayOvTitle").textContent =
      `יום ${day.n} · ${day.dow || ""} ${ovShortDate(day.date)}`;

    $("#dayOvBody").innerHTML = `
      <h3 class="day-sheet__title">${esc(day.profile || day.title || "")}</h3>
      <div class="ov-day__chips day-sheet__chips">
        ${ovChip("🌤️", "", `data-jwx="${day.n}"`)}
        ${day.hotel?.name ? ovChip("🛏️", day.hotel.name) : ""}
        ${ovChip("📎", "", `data-jdocs="${day.n}"`)}
        ${ovChip("💸", money, `data-jmoney="${day.n}"`)}
      </div>
      ${prog
        ? `<p class="day-sheet__now">${
            prog.next
              ? `הבא בתור — <b>${esc(prog.next.time)}</b> ${esc(prog.next.text)}`
              : "התוכנית של היום הושלמה."
          } <span class="muted sm">(${prog.done} מתוך ${prog.total})</span></p>`
        : ""}
      ${dayBody(day, { full: false })}`;

    $("#dayOverlay").hidden = false;
    paintJourneyChips();          // מזג האוויר והכסף של החלון שזה עתה נבנה
    renderTripDocs();             // והמסמכים, שנקראים מ-IndexedDB
  }

  function closeDayModal() {
    $("#dayOverlay").hidden = true;
  }

  /* ------------------------------------------------------------------ */

  function bindJourney() {
    bindPop();

    $("#journey").addEventListener("click", (e) => {
      // לחיצה על יום בבוחר מציירת אותו; הפירוט המלא נפתח מה-i שבסוף המסלול
      const pick = e.target.closest("[data-ov-day-pick]");
      if (pick) {
        ovDay = pick.dataset.ovDayPick === OV_ALL ? OV_ALL : Number(pick.dataset.ovDayPick);
        closePop();
        renderOverview();
        paintJourneyChips();
        renderTripDocs();
        return;
      }

      const info = e.target.closest("[data-ov-info]");
      if (info) return openDayModal(info.dataset.ovInfo);

      // השם המלא אינו נכנס למדליון, ובטלפון גם אין ריחוף שיציג אותו
      const seg = e.target.closest("[data-ov-name]");
      if (seg) {
        $$("#ovScene .is-on").forEach((el) => el.classList.toggle("is-on", false));
        seg.classList.add("is-on");
        openPop(seg);
        return;
      }

      const pass = e.target.closest("[data-pass-leg]");
      if (pass) { BoardingPass.open({ leg: pass.dataset.passLeg }); return; }

      const focus = e.target.closest("[data-focus]");
      if (focus) {
        selectTab($("#tab-map"));
        focusDay(focus.dataset.focus);
      }
    });

    // צומת ב-SVG אינו כפתור, ולכן Enter ורווח אינם מפעילים אותו לבד
    $("#journey").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      // כותרת יום בתרשים של כל הטיול היא g ולא button, ולכן גם היא כאן
      const node = e.target.closest?.("[data-ov-name],[data-ov-info],g[data-ov-day-pick]");
      if (!node) return;
      e.preventDefault();
      node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    $("#dayOverlay").addEventListener("click", (e) => {
      if (e.target === $("#dayOverlay") || e.target.closest("#dayOvClose")) {
        return closeDayModal();
      }
      const focus = e.target.closest("[data-focus]");
      if (focus) {
        closeDayModal();
        selectTab($("#tab-map"));
        focusDay(focus.dataset.focus);
        return;
      }
      const syncBtn = e.target.closest("[data-sync-day]");
      if (syncBtn) {
        closeDayModal();
        selectTab($("#tab-route"));
        return syncDayPoints(Number(syncBtn.dataset.syncDay));
      }

      const route = e.target.closest("[data-open-route]");
      if (route) {
        closeDayModal();
        selectTab($("#tab-route"));
        openDayCard(Number(route.dataset.openRoute));
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#dayOverlay").hidden) closeDayModal();
    });
  }

  function initMap() {
    if (typeof L === "undefined") {
      $("#map").style.display = "none";
      $("#mapFallback").classList.add("is-on");
      return;
    }

    const touch = window.matchMedia("(pointer: coarse)").matches;

    map = L.map("map", {
      scrollWheelZoom: false,
      zoomControl: true,
      // במסך מגע הגרירה כבויה עד שמקישים, אחרת אצבע על המפה חוטפת את
      // גלילת הדף ואי אפשר לעבור את המפה בכלל
      dragging: !touch,
      tap: false,
    });

    /*
     * שתי שכבות רקע, ובורר ביניהן.
     *
     * OSM כותב שמות בכתב המקומי, ובטביליסי זה כתב גאורגי — מפה שאי
     * אפשר לקרוא אותה אינה מפה. Esri World Street Map מתעתק שמות
     * לאותיות לטיניות, וזה מה שאפשר לקרוא. הבחירה היא של העין שמסתכלת
     * ולא שלנו, ולכן היא בורר ולא החלפה — והיא נזכרת.
     *
     * מסך המסלול היומי אינו מושפע מכאן: שם המפה היא Google Maps
     * אמיתית, עם תוויות בעברית.
     */
    const bases = {
      "לטינית (Esri)": L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution:
            'Tiles &copy; <a href="https://www.esri.com/" rel="noopener">Esri</a> — Esri, DeLorme, NAVTEQ',
        }
      ),
      "כתב מקומי (OSM)": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }),
    };

    const BASE_KEY = "map:base";
    let pick = null;
    try { pick = localStorage.getItem(BASE_KEY); } catch { /* לא קריטי */ }
    const start = bases[pick] ? pick : "לטינית (Esri)";
    bases[start].addTo(map);
    L.control.layers(bases, null, { position: "topleft" }).addTo(map);
    map.on("baselayerchange", (e) => {
      try { localStorage.setItem(BASE_KEY, e.name); } catch { /* לא קריטי */ }
    });

    map.on("click", () => map.scrollWheelZoom.enable());
    map.on("mouseout", () => map.scrollWheelZoom.disable());

    if (touch) {
      const shell = $("#mapShell");
      const guard = $("#mapGuard");
      shell.classList.add("is-locked");

      const unlock = () => {
        map.dragging.enable();
        shell.classList.remove("is-locked");
      };
      guard.addEventListener("click", unlock);
      guard.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); unlock(); }
      });
    }

    const allBounds = [];

    TRIP.days.forEach((day) => {
      const group = L.layerGroup();
      const mode = TRIP.modes[day.pathMode] || TRIP.modes.drive;

      if (day.path && day.path.length > 1) {
        L.polyline(day.path, {
          color: mode.color,
          weight: mode.weight,
          opacity: 0.85,
          dashArray: mode.dash || undefined,
          lineJoin: "round",
        }).addTo(group);
      }

      (day.points || []).forEach((pt) => {
        const icon = L.divIcon({
          className: "",
          html: `<div class="pin" style="background:${mode.color}"><span>${TYPE_ICON[pt.type] || "📍"}</span></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 28],
          popupAnchor: [0, -26],
        });

        L.marker([pt.lat, pt.lng], { icon, title: pt.name })
          .bindPopup(
            `<b>${esc(pt.name)}</b>` +
            `<small>יום ${day.n} · ${esc(day.title)}</small>`
          )
          .addTo(group);

        allBounds.push([pt.lat, pt.lng]);
      });

      dayLayers.set(day.n, group);
      group.addTo(map);
    });

    // טיול שנוצר באפליקציה מתחיל בלי אף נקודה, ו-fitBounds על גבולות ריקים
    // זורק "Bounds are not valid" — מה שהיה מפיל את כל הרינדור שאחריו.
    if (allBounds.length) {
      map.fitBounds(allBounds, { padding: [30, 30] });
    } else {
      map.setView([31.5, 34.9], 3);      // תצוגת עולם עד שיתווספו נקודות
      $("#mapShell").classList.add("is-empty");
    }
    map.__allBounds = allBounds;
  }

  function focusDay(which) {
    activeDay = which;
    syncNavButton();

    $$("#mapFilter .chip").forEach((c) =>
      c.classList.toggle("is-on", c.dataset.day === String(which))
    );

    if (!map) return;

    dayLayers.forEach((layer, n) => {
      const show = which === "all" || String(n) === String(which);
      if (show) { if (!map.hasLayer(layer)) layer.addTo(map); }
      else if (map.hasLayer(layer)) map.removeLayer(layer);
    });

    if (which === "all") {
      if (map.__allBounds?.length) map.fitBounds(map.__allBounds, { padding: [30, 30] });
    } else {
      const day = TRIP.days.find((d) => String(d.n) === String(which));
      const pts = (day.points || []).map((p) => [p.lat, p.lng]);
      if (pts.length === 1) map.setView(pts[0], 11);
      else if (pts.length) map.fitBounds(pts, { padding: [50, 50] });
    }
  }

  /** פאנל הלינה. מקור אחד לכרטיס היום ולחלונית שמעל המפה, כדי שלא יתפצלו. */
  function hotelPanel(day, { withLinks = true } = {}) {
    const h = day.hotel;
    if (!h) return `<div class="panel"><h4>🛏️ לינה</h4><div class="muted">טיסה חזרה — אין לינה</div></div>`;

    const stars = h.rating
      ? `<div class="hotel-meta"><b>${h.rating}</b>${h.reviews ? ` · ${nfNum.format(h.reviews)} ביקורות` : ""}${
          h.price ? ` · <bdi class="rng">${esc(h.price)}</bdi>` : ""
        }</div>`
      : h.price
      ? `<div class="hotel-meta"><bdi class="rng">${esc(h.price)}</bdi></div>`
      : "";

    const links = withLinks
      ? `<div class="mt-1 pill-row">
           ${h.url ? `<a class="btn btn--sm btn--primary" target="_blank" rel="noopener" href="${esc(h.url)}">הזמנה ב-Booking</a>` : ""}
           <a class="btn btn--sm" target="_blank" rel="noopener"
              href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.name + " " + h.area)}">
              פתח במפות
           </a>
         </div>`
      : "";

    return `<div class="panel panel--hotel">
      <h4>🛏️ לינה</h4>
      <div class="hotel-name">${esc(h.name)}</div>
      <div class="muted">${esc(h.area)}</div>
      ${stars}
      ${h.booked ? `<span class="badge badge--booked mt-1">✓ מוזמן</span>` : ""}
      ${h.alt ? `<div class="hotel-alt">${esc(h.alt)}</div>` : ""}
      ${links}
    </div>`;
  }

  /* ---------- חלונית המסלול היומי שנפתחת מתחת לצ'יפ שמעל המפה ---------- */

  /** אותו תוכן של לשונית "מסלול יומי", בגרסה מקוצרת לחלונית קטנה. */
  function dayPeekHTML(day) {
    const mode = TRIP.modes[day.mode] || TRIP.modes.drive;

    const plan = day.plan
      .map(
        (p) =>
          `<li><time>${p.time ? esc(p.time) : "·"}</time> ${esc(p.text)}</li>`
      )
      .join("");

    const hotel = hotelPanel(day, { withLinks: false });

    const tips = day.tips?.length
      ? `<div class="panel">
           <h4>💡 טיפים ליום הזה</h4>
           <ul>${day.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
         </div>`
      : "";

    const dirLink = gmapsLink(day);

    return `
      <div class="peek__head">
        <b>יום ${day.n} · ${esc(day.title)}</b>
        <button class="peek__close" data-peek-close aria-label="סגירת החלונית">✕</button>
      </div>
      <div class="peek__meta">
        <span>📆 ${fullDate(day.date)}</span>
        <span>${mode.icon} ${esc(mode.label)}</span>
        ${day.drive?.km ? `<span>🚗 ${nfNum.format(day.drive.km)} ק"מ · ${day.drive.hours} ש'</span>` : ""}
      </div>
      <p class="peek__sum">${esc(day.summary)}</p>
      <ul class="timeline">${plan}</ul>
      ${hotel}
      ${tips}
      <div class="peek__actions">
        <button class="btn btn--sm" data-open-day="${day.n}">📅 פתח במסלול המלא</button>
        ${dirLink ? `<a class="btn btn--sm" target="_blank" rel="noopener" href="${dirLink}">🧭 ניווט</a>` : ""}
      </div>`;
  }

  function closePeeks(except) {
    $$("#mapFilter .day-peek").forEach((p) => {
      if (p === except) return;
      p.hidden = true;
      p.style.transform = "";
      $(`[data-peek="${p.dataset.peekFor}"]`)?.setAttribute("aria-expanded", "false");
    });
  }

  // מתחת ל-640px החלונית היא גיליון תחתון קבוע ואין מה למקם
  const peekIsSheet = () => window.matchMedia("(max-width: 640px)").matches;

  /** מוודאת שרצועת הצ'יפים נשארת גלויה מעל הגיליון: הצ'יפ הנבחר למרכז הרצועה,
   *  והרצועה עצמה נצמדת מתחת לסרגל הניווט הדביק. */
  function revealChips(wrap) {
    if (wrap) wrap.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    if (!peekIsSheet()) return;
    const filter = $("#mapFilter");
    const navH = $(".nav")?.getBoundingClientRect().height || 0;
    const y = window.scrollY + filter.getBoundingClientRect().top - navH - 8;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }

  /** מזיזה את החלונית פנימה אם היא חורגת מקצה המסך. עובד גם ב-RTL. */
  function positionPeek(panel) {
    panel.style.transform = "";
    if (peekIsSheet()) return;
    const r = panel.getBoundingClientRect();
    const pad = 8;
    let dx = 0;
    if (r.left < pad) dx = pad - r.left;
    else if (r.right > window.innerWidth - pad) dx = window.innerWidth - pad - r.right;
    if (dx) panel.style.transform = `translateX(${dx}px)`;
  }

  function renderMapControls() {
    const filter = $("#mapFilter");
    filter.innerHTML =
      `<button class="chip is-on" data-day="all">כל הימים</button>` +
      TRIP.days
        .map(
          (d) => `
          <span class="chip-wrap">
            <span class="chip-pair">
              <button class="chip" data-day="${d.n}">${d.n} · ${esc(d.mapLabel || d.region)}</button>
              <button class="chip-peek" data-peek="${d.n}" aria-expanded="false"
                      aria-controls="peek-${d.n}" title="מה מתוכנן ביום ${d.n}"
                      aria-label="הצגת המסלול של יום ${d.n}">⌄</button>
            </span>
            <div class="day-peek" id="peek-${d.n}" data-peek-for="${d.n}" role="dialog"
                 aria-label="מסלול יום ${d.n}" hidden>${dayPeekHTML(d)}</div>
          </span>`
        )
        .join("");

    filter.addEventListener("click", (e) => {
      const closeBtn = e.target.closest("[data-peek-close]");
      if (closeBtn) { closePeeks(); return; }

      const openBtn = e.target.closest("[data-open-day]");
      if (openBtn) {
        closePeeks();
        selectTab($("#tab-route"));
        openDayCard(openBtn.dataset.openDay);
        return;
      }

      const peekBtn = e.target.closest("[data-peek]");
      if (peekBtn) {
        const panel = $(`#peek-${peekBtn.dataset.peek}`);
        const willOpen = panel.hidden;
        closePeeks(willOpen ? panel : null);
        panel.hidden = !willOpen;
        peekBtn.setAttribute("aria-expanded", String(willOpen));
        if (willOpen) {
          positionPeek(panel);
          revealChips(peekBtn.closest(".chip-wrap"));
          focusDay(peekBtn.dataset.peek);
        }
        return;
      }

      const chip = e.target.closest(".chip");
      if (chip) { closePeeks(); focusDay(chip.dataset.day); }
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest("#mapFilter")) closePeeks();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePeeks();
    });
    window.addEventListener("resize", () => {
      const open = $$("#mapFilter .day-peek").find((p) => !p.hidden);
      if (open) positionPeek(open);
    });

    $("#mapLegend").innerHTML = Object.values(TRIP.modes)
      .map(
        (m) =>
          `<span><i class="legend-swatch" style="background:${m.color};${
            m.dash ? "opacity:.85" : ""
          }"></i> ${m.icon} ${esc(m.label)}</span>`
      )
      .join("");
  }

  /* ==================================================================== */
  /*  סטטיסטיקות מסלול                                                    */
  /* ==================================================================== */

  function renderRouteStats() {
    // ק"מ ברכב לפי אזור. הקריטריון הוא ק"מ בפועל ולא סוג היום, כדי לתפוס גם
    // את הסעות הרכב בימי ההליכה — הן נהיגה אמיתית אף שהיום מסומן כהליכה.
    const byRegion = {};
    TRIP.days
      .filter((d) => (d.drive?.km || 0) > 0 && d.mode !== "flight" && d.mode !== "train")
      .forEach((d) => {
        byRegion[d.region] = (byRegion[d.region] || 0) + (d.drive?.km || 0);
      });

    const maxKm = Math.max(...Object.values(byRegion), 1);
    const colors = [ "var(--moss)", "var(--sky)", "var(--heather)", "var(--gold)", "var(--rose)" ];

    $("#regionBars").innerHTML = Object.entries(byRegion)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([region, km], i) => `
        <div class="bar-row">
          <span>${esc(region)}</span>
          <span class="bar-track"><i class="bar-fill" style="width:${(km / maxKm) * 100}%;background:${colors[i % colors.length]}"></i></span>
          <span class="bar-val">${nfNum.format(km)} ק"מ</span>
        </div>`
      )
      .join("");

    // שעות נהיגה יומיות
    const maxH = Math.max(...TRIP.days.map((d) => d.drive?.hours || 0), 1);
    $("#driveSpark").innerHTML = TRIP.days
      .map((d) => {
        const h = d.drive?.hours || 0;
        const pct = (h / maxH) * 100;
        const heavy = h >= 4.5;
        return `
        <div class="spark__col" title="יום ${d.n}: ${h} שעות נהיגה">
          <div class="spark__bar" style="height:${Math.max(pct, 2)}%;${
            heavy ? "background:linear-gradient(180deg,var(--danger),rgba(255,107,107,.3))" : ""
          }"></div>
          <div class="spark__lbl">${d.n}</div>
        </div>`;
      })
      .join("");
  }

  /* ==================================================================== */
  /*  מסלול יומי                                                          */
  /* ==================================================================== */

  /**
   * מסלול נהיגה של יום ב-Google Maps.
   *
   * הנקודות מסוננות ליעד עצמו. בלי זה יום טיסה היה מבקש מגוגל מסלול
   * נהיגה מנתב"ג לכיכר החירות — שלושת אלפים ק"מ, או "לא נמצא מסלול".
   * מה שרוצים ביום כזה הוא מה שקורה אחרי הנחיתה.
   */
  function gmapsLink(day) {
    const pts = (day.points || []).filter((p) => p.lat && p.lng && inDestination(p));
    if (!pts.length) return null;

    /*
     * המסלול מתחיל **מאיפה שאתם**, ולא מנקודה שאנחנו בחרנו.
     *
     * הדרך לומר את זה ל-Google Maps היא פשוט לא לשלוח `origin`: כשהוא
     * חסר, המפות לוקחות את המיקום הנוכחי של המכשיר. זה נכון יותר מכל
     * ניחוש שלנו — גם המלון הוא ניחוש, כי בשמונה בבוקר אתם בו ובשתיים
     * בצהריים כבר לא.
     *
     * כל הנקודות של היום הופכות לעצירות, והאחרונה היא היעד.
     */
    const dest = pts[pts.length - 1];
    const mid = pts.slice(0, -1).slice(0, 9);

    let url =
      `https://www.google.com/maps/dir/?api=1` +
      `&destination=${dest.lat},${dest.lng}`;
    if (mid.length) {
      url += `&waypoints=` + mid.map((p) => `${p.lat},${p.lng}`).join("|");
    }
    return url;
  }

  /* ==================================================================== */
  /*  ייצוא ל-Google Maps                                                 */
  /* ==================================================================== */

  /** תיבה תוחמת של בריטניה — כדי לסנן את נתב"ג ופרנקפורט מהייצוא */
  /**
   * האם הנקודה בתוך תיבת היעד. זה מה שמשאיר מחוץ ל-KML את נתב"ג ואת
   * שדות הקונקשן — הם נקודות של יום הטיסה ולא של המסלול עצמו.
   * התיבה מגיעה מ-TRIP.meta.bbox; בלעדיה לא מסננים כלום.
   */
  const inDestination = (p) => {
    const b = TRIP.meta.bbox;
    if (!b) return true;
    return p.lat > b.latMin && p.lat < b.latMax && p.lng > b.lngMin && p.lng < b.lngMax;
  };

  const xml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
    }[c]));

  /** #rrggbb → aabbggrr, הסדר ההפוך ש-KML משתמש בו */
  const kmlColor = (hex) => {
    const h = hex.replace("#", "");
    return `ff${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toLowerCase();
  };

  /**
   * בונה KML של כל המסלול, בלי מקטעי הטיסה.
   *
   * הקיבוץ הוא לפי אזור ולא לפי יום בכוונה: Google My Maps מגביל ל-10
   * שכבות למפה, ו-14 תיקיות (יום לכל אחת) היו חורגות מזה. חמישה אזורים
   * נכנסים בנוחות, ומספר היום נשאר בשם של כל נקודה.
   */
  function buildKML() {
    const styles = Object.entries(TRIP.modes)
      .map(
        ([key, m]) => `  <Style id="${key}">
    <LineStyle><color>${kmlColor(m.color)}</color><width>4</width></LineStyle>
    <IconStyle><color>${kmlColor(m.color)}</color></IconStyle>
  </Style>`
      )
      .join("\n");

    // סדר האזורים נקבע לפי סדר ההופעה במסלול
    const regions = [];
    TRIP.days.forEach((d) => { if (!regions.includes(d.region)) regions.push(d.region); });

    const folders = regions
      .map((region) => {
        const days = TRIP.days.filter((d) => d.region === region);
        const body = days
          .map((day) => {
            const marks = (day.points || [])
              .filter((p) => p.lat && p.lng && inDestination(p))
              .map(
                (p) => `      <Placemark>
        <name>${xml(`${day.n} · ${p.name}`)}</name>
        <description>${xml(`יום ${day.n}, ${fullDate(day.date)} — ${day.title}`)}</description>
        <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>
      </Placemark>`
              )
              .join("\n");

            // קו המסלול נשמט בימי הטיסה — זה מה ש"ללא טיסות" אומר בפועל
            const line =
              day.pathMode !== "flight" && day.path?.length > 1
                ? `      <Placemark>
        <name>${xml(`מסלול יום ${day.n} — ${day.title}`)}</name>
        <styleUrl>#${day.pathMode}</styleUrl>
        <LineString><tessellate>1</tessellate><coordinates>
          ${day.path.map(([lat, lng]) => `${lng},${lat},0`).join(" ")}
        </coordinates></LineString>
      </Placemark>`
                : "";

            return [marks, line].filter(Boolean).join("\n");
          })
          .filter(Boolean)
          .join("\n");

        return body
          ? `    <Folder>\n      <name>${xml(region)}</name>\n${body}\n    </Folder>`
          : "";
      })
      .filter(Boolean)
      .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xml(`${TRIP.meta.title} · ${TRIP.days[0].date} – ${TRIP.days[TRIP.days.length - 1].date}`)}</name>
    <description>${xml(TRIP.meta.subtitle + " — ללא מקטעי הטיסה")}</description>
${styles}
${folders}
  </Document>
</kml>`;
  }

  /** אותן נקודות ואותו קו, ליום אחד — שכבה אחת ב-Google My Maps */
  function buildDayKML(day) {
    const marks = (day.points || [])
      .filter((p) => p.lat && p.lng && inDestination(p))
      .map(
        (p, i) => `      <Placemark>
        <name>${xml(`${i + 1}. ${p.name}`)}</name>
        <description>${xml(`יום ${day.n}, ${fullDate(day.date)} — ${day.title}`)}</description>
        <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>
      </Placemark>`
      )
      .join("\n");

    const line =
      day.pathMode !== "flight" && day.path?.length > 1
        ? `      <Placemark>
        <name>${xml(`מסלול יום ${day.n}`)}</name>
        <styleUrl>#${day.pathMode}</styleUrl>
        <LineString><tessellate>1</tessellate><coordinates>
          ${day.path.map(([lat, lng]) => `${lng},${lat},0`).join(" ")}
        </coordinates></LineString>
      </Placemark>`
        : "";

    const styles = Object.entries(TRIP.modes)
      .map(
        ([key, m]) => `  <Style id="${key}">
    <LineStyle><color>${kmlColor(m.color)}</color><width>4</width></LineStyle>
    <IconStyle><color>${kmlColor(m.color)}</color></IconStyle>
  </Style>`
      )
      .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xml(`${TRIP.meta.title} · יום ${day.n} · ${day.date}`)}</name>
    <description>${xml(day.title || "")}</description>
${styles}
    <Folder>
      <name>${xml(`יום ${day.n} — ${day.title || ""}`)}</name>
${[marks, line].filter(Boolean).join("\n")}
    </Folder>
  </Document>
</kml>`;
  }

  /** הורדה כקובץ. אותו מסלול בדיוק שבכפתור של כל הטיול, ליום אחד. */
  function saveKML(text, name) {
    const blob = new Blob([text], {
      type: "application/vnd.google-earth.kml+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // שחרור מיידי מדליף פחות מלהשאיר את ה-URL תלוי
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadKML() {
    const from = TRIP.days[0]?.date || "";
    saveKML(buildKML(), `trip-${from}-route.kml`);
  }

  $("#kmlBtn").addEventListener("click", downloadKML);

  // ההורדה ליום בודד מופיעה גם בחלון היום וגם בכרטיס שבמסלול היומי,
  // ולכן היא נתפסת על המסמך ולא על אחד מהם
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-kml-day]");
    if (!btn) return;
    const day = TRIP.days.find((d) => d.n === Number(btn.dataset.kmlDay));
    if (day) saveKML(buildDayKML(day), `trip-day-${day.n}-${day.date}.kml`);
  });

  /** כפתור הניווט פעיל רק כשנבחר יום — לגוגל אין מסלול אחד לכל הטיול */
  function syncNavButton() {
    const btn = $("#navDayBtn");
    const day = TRIP.days.find((d) => String(d.n) === String(activeDay));
    const link = day ? gmapsLink(day) : null;

    btn.disabled = !link;
    btn.dataset.href = link || "";
    btn.textContent = day
      ? `🧭 ניווט ביום ${day.n} ב-Google Maps`
      : "🧭 ניווט ביום הנבחר ב-Google Maps";
    btn.title = link
      ? `${day.title} — נפתח בלשונית חדשה`
      : "בחרו יום מהצ'יפים שמעל המפה. אין ב-Google Maps מסלול יחיד לכל הטיול — לשם כך הורידו את הקובץ.";
  }

  $("#navDayBtn").addEventListener("click", (e) => {
    const href = e.currentTarget.dataset.href;
    if (href) window.open(href, "_blank", "noopener");
  });

  /**
   * גוף היום — הסיכום, לוח הזמנים, הפאנלים והמסמכים.
   *
   * אותו גוף משרת גם את כרטיס היום בלשונית המסלול וגם את הפתיחה של יום
   * במבט העל. full = גרסת המסלול, עם עריכה; בלעדיו זו תצוגה בלבד עם
   * קישור לעריכה במקום שבו היא באמת חיה.
   */
  function dayBody(day, { full }) {
    const plan = (day.plan || [])
      .map(
        (p) =>
          `<li>${p.time ? `<time>${esc(p.time)}</time>` : "<time>·</time>"} ${esc(p.text)}</li>`
      )
      .join("");

    const tips = day.tips?.length
      ? `<div class="panel">
           <h4>💡 טיפים ליום הזה</h4>
           <ul>${day.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
         </div>`
      : "";

    const dirLink = gmapsLink(day);

    return `
      <p class="day__summary">${esc(day.summary || "")}</p>
      <ul class="timeline">${plan}</ul>
      <div class="panels">
        ${hotelPanel(day)}
        ${tips}
        ${day.drive?.note ? `<div class="panel"><h4>🚗 נהיגה</h4><ul><li>${esc(day.drive.note)}</li></ul></div>` : ""}
      </div>
      <!-- המסמכים נקראים מ-IndexedDB ולכן נכנסים לכאן אחרי הרינדור -->
      <div class="day__docs" data-docs="${day.n}" hidden></div>
      ${syncPanel(day)}
      <div class="day__actions">
        <button class="btn btn--sm btn--primary" data-route-day="${day.n}"
          title="תחנה־תחנה, עם ניווט לכל תחנה בנפרד">🚶 יוצאים למסלול</button>
        <button class="btn btn--sm" data-focus="${day.n}">🗺️ הצג את היום על המפה</button>
        ${dirLink
          ? `<a class="btn btn--sm" target="_blank" rel="noopener" href="${dirLink}"
               title="כל נקודות היום כמסלול נהיגה אחד">🧭 מסלול היום ב-Google Maps</a>`
          : ""}
        ${(day.points || []).some((p) => p.lat && p.lng && inDestination(p))
          ? `<button class="btn btn--sm" data-kml-day="${day.n}"
               title="קובץ KML לייבוא ל-Google My Maps">⬇️ הורדת נקודות היום</button>`
          : ""}
        <button class="btn btn--sm" data-sync-day="${day.n}"
          title="בונה מחדש את נקודות המפה מתוך לוח הזמנים של היום">🗺️ התאם נקודות</button>
        ${full
          ? `<button class="btn btn--sm" data-edit="${day.n}">✏️ ערוך את היום</button>`
          : `<button class="btn btn--sm" data-open-route="${day.n}">✏️ ערוך במסלול היומי</button>`}
      </div>
      ${full ? `<div class="day-edit" data-editor="${day.n}" hidden></div>` : ""}`;
  }

  /** האזהרה על יום שנסחף, או תוצאת ההתאמה האחרונה */
  function syncPanel(day) {
    if (syncNote && syncNote.n === day.n) {
      return `<div class="day-drift${syncNote.bad ? " is-bad" : " is-done"}">
        <b>${syncNote.bad ? "⚠️ ההתאמה נכשלה" : "✅ הנקודות הותאמו"}</b>
        <p>${esc(syncNote.text)}</p>
      </div>`;
    }

    const sync = daySync(day);
    if (sync.ok) return "";

    const drifted = sync.lost.length > sync.total / 3;
    return `<div class="day-drift">
      <b>⚠️ היום הזה לא מסתדר עם עצמו</b>
      ${drifted
        ? `<p>${sync.lost.length} מתוך ${sync.total} הנקודות אינן מוזכרות בתוכנית:
             ${esc(sync.lost.map((p) => p.name).join(", "))}.
             מבט העל, מסלול היום, הקו על המפה והנקודות שיורדות ל-Google Maps
             נבנים כולם מהרשימה הזו.</p>`
        : ""}
      ${sync.drive
        ? `<p>היום מסומן ${nfNum.format(sync.drive.km)} ק"מ נסיעה, אבל כל נקודותיו
             בטווח ${sync.drive.far} ק"מ זו מזו. את זה מתקנים בבקשה לעוזר —
             "יום 3 הוא יום עירוני בלי נסיעה".</p>`
        : ""}
      ${drifted
        ? `<button class="btn btn--sm btn--primary" data-sync-day="${day.n}">
             🗺️ התאם את הנקודות ללוח הזמנים
           </button>`
        : ""}
    </div>`;
  }

  /**
   * בניית נקודות המפה של יום מתוך לוח הזמנים שלו.
   *
   * זו הדרך לתקן יום שנסחף, ולא "לנסח נכון את הבקשה לעוזר". השמות
   * נקבעים על ידי המודל, הקואורדינטות נפתרות בשרת מתוך הטיול עצמו,
   * והקו על המפה נגזר מהנקודות — בדיוק כמו בכל שינוי אחר. כך כל חמשת
   * המסכים שקוראים את `points` מתעדכנים בבת אחת.
   */
  async function syncDayPoints(n) {
    const day = TRIP.days.find((d) => String(d.n) === String(n));
    if (!day || syncing) return;
    syncing = n;
    syncNote = null;

    const btns = $$(`[data-sync-day="${n}"]`);
    btns.forEach((b) => { b.disabled = true; b.textContent = "בונה את הרשימה…"; });

    try {
      const res = await fetch(TripAPI.tripUrl("/api/places"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: localStorage.getItem("ai:code") || "",
          trip: TRIP,
          day: {
            n: day.n,
            title: day.title,
            summary: day.summary,
            plan: day.plan || [],
            points: day.points || [],
            hotel: day.hotel || null,
          },
        }),
      });
      const out = await TripAPI.readJson(res);
      if (!res.ok || !out || out.error) {
        throw new Error(out?.error || `השרת החזיר ${res.status}`);
      }

      const pts = (out.points || []).filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
      );
      if (!pts.length) {
        syncNote = {
          n,
          bad: true,
          text: "לא נמצא אף מקום שאפשר למקם על המפה. " + (out.note || ""),
        };
      } else {
        day.points = pts.map((p) => ({
          name: String(p.name || "").trim(),
          lat: p.lat,
          lng: p.lng,
          type: String(p.type || "sight"),
        }));
        day.path = day.points.length > 1 ? day.points.map((p) => [p.lat, p.lng]) : [];
        TRIP = TripStore.save(TRIP);

        const missed = (out.unresolved || []).length
          ? ` לא נמצאו על המפה ולכן הושמטו: ${out.unresolved.join(", ")}.`
          : "";
        syncNote = {
          n,
          bad: false,
          text: `${day.points.length} נקודות, לפי סדר הביקור. ${out.note || ""}${missed}`,
        };
      }
    } catch (err) {
      syncNote = { n, bad: true, text: err?.message || "שגיאה לא ידועה" };
    } finally {
      syncing = 0;
      renderTrip();
      // renderTrip בונה את הרשימה מחדש וסוגר כרטיסים; מחזירים את זה שנפתח
      const card = $(`.day[data-day="${n}"]`);
      if (card) {
        card.classList.add("is-open");
        $(".day__head", card)?.setAttribute("aria-expanded", "true");
        card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }

  function renderDays() {
    $("#dayList").innerHTML = TRIP.days
      .map((day) => {
        const mode = TRIP.modes[day.mode] || TRIP.modes.drive;
        return `
        <article class="day" data-day="${day.n}">
          <button class="day__head" aria-expanded="false">
            <span class="day__num"><b>${day.n}</b><small>${esc(day.dow)}</small></span>
            <span>
              <h3 class="day__title">${esc(day.title)}</h3>
              <span class="day__meta">
                <span>📆 ${fullDate(day.date)}</span>
                <span>${mode.icon} ${esc(mode.label)}</span>
                ${day.drive?.km ? `<span>🚗 ${nfNum.format(day.drive.km)} ק"מ · ${day.drive.hours} ש'</span>` : ""}
                ${day.hotel ? `<span>🛏️ ${esc(day.hotel.area)}</span>` : ""}
              </span>
            </span>
            <span class="day__chev">⌄</span>
          </button>

          <div class="day__body">${dayBody(day, { full: true })}</div>
        </article>`;
      })
      .join("");

    bindDayList();
  }

  /* =====================================================================
     מסמכי הטיול

     הם יושבים ב-IndexedDB ולא במסמך הטיול, ולכן הרינדור שלהם אסינכרוני
     ונפרד: כרטיס היום נבנה סינכרונית, והמסמכים נכנסים אליו כשהם חוזרים.
     ===================================================================== */

  // objectURL חי עד שמשחררים אותו; המפה הזו מאפשרת לשחרר בכל רינדור
  const docUrls = new Map();

  function docItem(doc, { showDay }) {
    const url = docUrls.get(doc.id);
    const day = showDay && doc.dayN ? `<span class="muted sm">יום ${doc.dayN}</span>` : "";
    return `<li class="doc-item">
      <span class="doc-item__kind">${esc(TripDocs.label(doc.kind))}</span>
      <a class="doc-item__name" href="${url}" target="_blank" rel="noopener"
         download="${esc(doc.name)}">${esc(doc.title)}</a>
      ${day}
      ${doc.note ? `<span class="doc-item__note">${esc(doc.note)}</span>` : ""}
      <button class="trip-row__del" data-doc-del="${esc(doc.id)}"
              aria-label="מחיקת המסמך">🗑️</button>
    </li>`;
  }

  async function renderTripDocs() {
    const list = $("#docList");
    if (!TripDocs.available()) {
      list.innerHTML = '<p class="muted sm">הדפדפן הזה אינו תומך באחסון מסמכים מקומי.</p>';
      return;
    }

    const docs = await TripDocs.list(TRIP.id);

    docUrls.forEach((u) => URL.revokeObjectURL(u));
    docUrls.clear();
    docs.forEach((d) => docUrls.set(d.id, URL.createObjectURL(d.blob)));

    list.innerHTML = docs.length
      ? `<ul class="doc-items">${docs.map((d) => docItem(d, { showDay: true })).join("")}</ul>`
      : `<p class="muted sm">עדיין לא הועלו מסמכים. אפשר לצרף כרטיס או אישור
           לעוזר (✨), והוא יקרא אותו ויכניס את הפרטים למסלול.</p>`;

    // אותם מסמכים, בכרטיס היום שהם שייכים לו — זה מה שהופך אותם לשימושיים
    // בטיול עצמו ולא רק ברשימה
    $$("[data-docs]").forEach((box) => {
      const mine = docs.filter((d) => Number(d.dayN) === Number(box.dataset.docs));
      box.innerHTML = mine.length
        ? `<h4 class="day__docs-head">📎 מסמכים ליום הזה</h4>
           <ul class="doc-items">${mine.map((d) => docItem(d, { showDay: false })).join("")}</ul>`
        : "";
      box.hidden = !mine.length;
    });

    // ואותם מסמכים כצ'יפ על היום במבט העל
    $$("[data-jdocs]").forEach((chip) => {
      const n = Number(chip.dataset.jdocs);
      const mine = docs.filter((d) => Number(d.dayN) === n);
      chip.textContent = mine.length === 1 ? `📎 ${mine[0].title}` : `📎 ${mine.length} מסמכים`;
      chip.hidden = !mine.length;
    });
  }

  /** פותחת כרטיס יום מסוים בלשונית המסלול וגוללת אליו. */
  openDayCard = (n) => {
    const card = $(`.day[data-day="${n}"]`);
    if (!card) return;
    card.classList.add("is-open");
    $(".day__head", card).setAttribute("aria-expanded", "true");
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /**
   * מאזיני המסלול נרשמים פעם אחת בלבד, לא בכל רינדור.
   * renderDays רץ מחדש בכל מעבר טיול, ורישום חוזר היה מכפיל כל הקשה —
   * כרטיס יום היה נפתח ונסגר מיד באותה לחיצה.
   */
  let dayListBound = false;
  function bindDayList() {
    if (dayListBound) return;
    dayListBound = true;

    // המסמכים מופיעים גם בכרטיס היום וגם ברשימה שבלשונית המידע, ולכן
    // המחיקה נתפסת על המסמך כולו ולא על אחד משני המקומות
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-doc-del]");
      if (!btn || e.target.closest("#flightsView")) return;   // ללשונית הטיסות מאזין משלה
      if (!confirm("למחוק את המסמך מהמכשיר הזה?")) return;
      await TripDocs.remove(btn.dataset.docDel);
      await renderTripDocs();
      FlightsView.render();          // אותו מסמך עשוי להופיע גם בלשונית הטיסות
    });

    $("#dayList").addEventListener("click", (e) => {
      if (e.target.closest(".day-edit")) return;        // לעורך יש מאזין משלו
      if (e.target.closest("[data-edit]")) return;

      const head = e.target.closest(".day__head");
      if (head) {
        const card = head.closest(".day");
        const open = card.classList.toggle("is-open");
        head.setAttribute("aria-expanded", String(open));
        return;
      }

      const syncBtn = e.target.closest("[data-sync-day]");
      if (syncBtn) return syncDayPoints(Number(syncBtn.dataset.syncDay));

      const focusBtn = e.target.closest("[data-focus]");
      if (focusBtn) {
        selectTab($("#tab-map"));
        focusDay(focusBtn.dataset.focus);
      }
    });

    $("#expandAll").addEventListener("click", () =>
      $$(".day").forEach((d) => {
        d.classList.add("is-open");
        $(".day__head", d).setAttribute("aria-expanded", "true");
      })
    );
    $("#collapseAll").addEventListener("click", () =>
      $$(".day").forEach((d) => {
        d.classList.remove("is-open");
        $(".day__head", d).setAttribute("aria-expanded", "false");
      })
    );
  }

  /* ==================================================================== */
  /*  תמצית להדפסה — שני עמודי A4                                        */
  /* ==================================================================== */

  const DOW_SHORT = {
    ראשון: "א'", שני: "ב'", שלישי: "ג'", רביעי: "ד'",
    חמישי: "ה'", שישי: "ו'", שבת: "ש'",
  };

  /** 20/9 א' — קצר יותר מ-shortDate של טבלת ההוצאות, וכולל יום בשבוע */
  const psDate = (iso, dow) => {
    const [, m, d] = iso.split("-");
    return `${+d}/${+m} ${DOW_SHORT[dow] || ""}`.trim();
  };

  /** מקטעי לינה: ימים רצופים באותו מלון מתאחדים לשורה אחת. */
  function staySegments() {
    const segs = [];
    TRIP.days.forEach((d) => {
      if (!d.hotel) return;
      const last = segs[segs.length - 1];
      if (last && last.name === d.hotel.name) { last.nights++; last.to = d.date; }
      else segs.push({ name: d.hotel.name, area: d.hotel.area, price: d.hotel.price,
                       from: d.date, to: d.date, nights: 1 });
    });
    return segs;
  }

  /** שלוש עצירות מובילות ליום, לשורת המשנה בטבלה. */
  function keyStops(day) {
    return (day.points || [])
      .filter((p) => ["sight", "hike", "town", "station"].includes(p.type))
      .slice(0, 3)
      .map((p) => p.name)
      .join(" · ");
  }

  function dayRows(days) {
    return days
      .map((d) => {
        const mode = TRIP.modes[d.mode] || TRIP.modes.drive;
        const dist = d.walk
          ? `🥾 ${d.walk.km} ק"מ`
          : d.drive?.km
          ? `🚗 ${nfNum.format(d.drive.km)} ק"מ`
          : mode.icon + " " + esc(mode.label);
        const stops = keyStops(d);
        return `
        <tr${d.walk ? ' class="walk"' : ""}>
          <td class="n">${d.n}</td>
          <td class="dt">${psDate(d.date, d.dow)}</td>
          <td><b>${esc(d.title)}</b>${stops ? `<span class="stops">${esc(stops)}</span>` : ""}</td>
          <td class="km">${dist}</td>
          <td class="ho">${d.hotel ? esc(d.hotel.area) : "—"}</td>
        </tr>`;
      })
      .join("");
  }

  const DAY_TABLE_HEAD =
    `<thead><tr><th>יום</th><th>תאריך</th><th>מה</th><th>מרחק</th><th>לינה</th></tr></thead>`;

  function buildSummarySheet() {
    const m = TRIP.meta;
    const f = TRIP.flights;
    const days = TRIP.days;
    const nights = days.filter((d) => d.hotel).length;
    const walkKm = days.reduce((s, d) => s + (d.walk?.km || 0), 0);

    // טיסה ישירה מסומנת ב-via ריק או "ישיר" — אין טעם להדפיס "קונקשן —"
    const legVia = (l) =>
      !l.via || l.via === "ישיר" ? "טיסה ישירה" : `דרך ${esc(l.via)}, קונקשן ${l.layover}`;

    const leg = (l, dir) => `
      <div class="kv"><b>${dir}</b><span>${psDate(l.date, l.dow)} · ${esc(l.from)} ${l.dep}
        → ${esc(l.to)} ${l.arr} · ${legVia(l)}</span></div>`;

    const stays = staySegments()
      .map(
        (s) => `
        <tr>
          <td>${esc(s.name)}</td>
          <td class="ho">${esc(s.area)}</td>
          <td class="dt"><bdi class="rng">${psDate(s.from, "")}–${psDate(s.to, "")}</bdi></td>
          <td class="km">${s.nights}</td>
          <td class="ho">${s.price ? `<bdi class="rng">${esc(s.price)}</bdi>` : "—"}</td>
        </tr>`
      )
      .join("");

    // שתי התיבות בעמוד 2 נלקחות מלשונית המידע, כדי שלא יהיו שני מקורות אמת.
    // איזו סקציה מודגשת נקבע ב-meta.printHighlight; בלעדיו נבחרת הראשונה
    // שאינה "להזמין מראש", כך שהתיבה לעולם לא נשארת ריקה.
    const booking = TRIP.practical.find((p) => p.title.includes("להזמין"));
    const highlight =
      (m.printHighlight && TRIP.practical.find((p) => p.title.includes(m.printHighlight))) ||
      TRIP.practical.find((p) => p !== booking);

    // עמוד 2 נשא שתי תיבות וחצי עמוד ריק. ארבע תיבות ממלאות אותו בלי
    // לדחוף לעמוד שלישי — ומה שמודפס הוא מה שבאמת מחפשים על נייר.
    const chosen = [highlight, booking].filter(Boolean);
    TRIP.practical.forEach((sec) => {
      if (chosen.length < 4 && !chosen.includes(sec)) chosen.push(sec);
    });
    const boxes = chosen
      .map(
        (sec) => `
          <div class="psheet__box">
            <h2>${esc(sec.icon || "ℹ️")} ${esc(sec.title || "")}</h2>
            <ul>${(sec.items || [])
              .slice(0, 5)
              .map((t) => `<li>${esc(t)}</li>`)
              .join("")}</ul>
          </div>`
      )
      .join("");

    // חלוקת הימים לשני עמודים. קודם היא הייתה חצי-חצי, ולכן טיול של שישה
    // ימים הדפיס שלושה ימים בכל עמוד ושני חצאי עמודים ריקים. עמוד 1 לוקח
    // כמה ימים שנכנסים בו (שמונה שורות ועוד תיבת הטיסות), ורק מה שנשאר
    // עובר לעמוד 2 — שנושא ממילא את הלינה ואת שתי התיבות.
    const split = Math.min(days.length, 8);
    const range = `${psDate(days[0].date, "")}–${psDate(days[days.length - 1].date, "")}`;

    const sheet = document.createElement("div");
    sheet.className = "psheet";
    sheet.id = "printSheet";
    sheet.innerHTML = `
      <section class="psheet__page">
        <div class="psheet__head">
          <h1>${esc(m.title)} · <bdi class="rng">${range}</bdi></h1>
          <span class="sub">${days.length} ימים · ${nights} לילות ·
            ${nfNum.format(m.totalDrivingKm)} ק"מ ברכב · ${walkKm} ק"מ ברגל</span>
        </div>

        <div class="psheet__box">
          <h2>✈️ טיסות — ${esc(f.carrier)} · ${esc(f.fare)}</h2>
          ${leg(f.out, "הלוך")}
          ${leg(f.back, "חזור")}
          ${f.note ? `<div class="kv"><b>שימו לב</b><span>${esc(f.note)}</span></div>` : ""}
        </div>

        <h2><bdi class="rng">המסלול${split < days.length ? ` — ימים 1–${split}` : ""}</bdi></h2>
        <table>${DAY_TABLE_HEAD}<tbody>${dayRows(days.slice(0, split))}</tbody></table>

        <div class="psheet__foot"><span>עמוד 1 מתוך 2</span><span>${esc(m.subtitle)}</span></div>
      </section>

      <section class="psheet__page">
        ${split < days.length
          ? `<h2><bdi class="rng">המסלול — ימים ${split + 1}–${days.length}</bdi></h2>
             <table>${DAY_TABLE_HEAD}<tbody>${dayRows(days.slice(split))}</tbody></table>`
          : ""}

        <h2>🛏️ לינה — ${nights} לילות</h2>
        <table><thead><tr><th>איפה</th><th>אזור</th><th>תאריכים</th><th>לילות</th><th>מחיר</th></tr></thead>
          <tbody>${stays}</tbody></table>

        <div class="psheet__cols">${boxes}</div>

        <div class="psheet__foot">
          <span>עמוד 2 מתוך 2</span>
          <span>${esc(m.emergency || "חירום 112")}</span>
        </div>
      </section>`;
    return sheet;
  }

  /** בונה את הגיליון, מדפיס, ומנקה אחריו — כך שהוא לא יושב ב-DOM לחינם. */
  function printSummary() {
    document.getElementById("printSheet")?.remove();
    document.body.appendChild(buildSummarySheet());
    document.body.classList.add("print-summary");

    const cleanup = () => {
      document.body.classList.remove("print-summary");
      document.getElementById("printSheet")?.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);

    // ספארי בנייד לא תמיד יורה afterprint — רשת ביטחון
    setTimeout(() => {
      if (document.body.classList.contains("print-summary")) cleanup();
    }, 60_000);

    window.print();
  }

  /* ==================================================================== */
  /*  המלצות לשיפור                                                       */
  /* ==================================================================== */

  const LEVEL_LABEL = { critical: "קריטי", high: "חשוב", medium: "כדאי", low: "לתשומת לב" };
  const STATUS_LABEL = {
    applied: { text: "✓ יושם במסלול", cls: "imp__status--applied" },
    action:  { text: "↗ דורש פעולה",  cls: "imp__status--action" },
  };

  function renderImprovements() {
    const applied = TRIP.improvements.filter((i) => i.status === "applied").length;
    const action = TRIP.improvements.length - applied;
    $("#impCounts").innerHTML =
      `<span class="badge" style="color:var(--moss)">✓ ${applied} יושמו במסלול</span>` +
      `<span class="badge" style="color:var(--gold)">↗ ${action} דורשות פעולה מכם</span>`;

    $("#impList").innerHTML = TRIP.improvements
      .map((imp) => {
        const st = STATUS_LABEL[imp.status] || STATUS_LABEL.action;
        return `
        <article class="imp imp--${imp.level}">
          <h3>
            <span class="imp__level">${LEVEL_LABEL[imp.level]}</span>
            <span class="imp__status ${st.cls}">${st.text}</span>
            ${esc(imp.title)}
          </h3>
          <p>${esc(imp.body)}</p>
        </article>`;
      })
      .join("");
  }

  /* ==================================================================== */
  /*  מידע וציוד                                                          */
  /* ==================================================================== */

  function renderInfo() {
    $("#infoGrid").innerHTML = TRIP.practical
      .map(
        (sec) => `
        <article class="card info-card">
          <h3>${sec.icon} ${esc(sec.title)}</h3>
          <ul>${sec.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
        </article>`
      )
      .join("");
  }

  function renderPacking() {
    $("#packGrid").innerHTML = TRIP.packing
      .map(
        (grp) => `
        <article class="card pack-card">
          <h3>${esc(grp.group)}</h3>
          ${grp.items
            .map((item) => {
              const key = grp.group + "|" + item;
              const done = !!state.packing[key];
              return `<label class="pack-item ${done ? "is-done" : ""}">
                        <input type="checkbox" data-pack="${esc(key)}" ${done ? "checked" : ""} />
                        <span>${esc(item)}</span>
                      </label>`;
            })
            .join("")}
        </article>`
      )
      .join("");

    $("#packGrid").addEventListener("change", (e) => {
      const box = e.target.closest("[data-pack]");
      if (!box) return;
      state.packing[box.dataset.pack] = box.checked;
      box.closest(".pack-item").classList.toggle("is-done", box.checked);
      save();
      updatePackProgress();
    });

    updatePackProgress();
  }

  function updatePackProgress() {
    const total = TRIP.packing.reduce((n, g) => n + g.items.length, 0);
    const done = TRIP.packing.reduce(
      (n, g) => n + g.items.filter((i) => state.packing[g.group + "|" + i]).length,
      0
    );
    const pct = total ? (done / total) * 100 : 0;
    $("#packBar").style.width = pct + "%";
    $("#packText").textContent = `${done} מתוך ${total} פריטים ארוזים`;
  }

  /* ==================================================================== */
  /*  תכנון עלויות מראש                                                   */
  /* ==================================================================== */

  /** תווית הסיכום: האם הקבוצות האופציונליות (אוכל) נספרות בסכום המוצג */
  function extrasLabel() {
    const extras = TRIP.costPlan.groups.filter((g) => !g.core).map((g) => g.title);
    if (!extras.length) return "ללא אוכל";
    return (state.costIncludeExtras ? "כולל " : "ללא ") + extras.join(" ו");
  }

  /** הערך בפועל של שורה — override של המשתמש אם קיים, אחרת האומדן מהנתונים */
  function costValue(groupKey, idx, item) {
    const o = state.costOverrides[groupKey + ":" + idx];
    return {
      low: o && Number.isFinite(o.low) ? o.low : item.low,
      high: o && Number.isFinite(o.high) ? o.high : item.high,
    };
  }

  const rate = (cur) => Number(state.rates[cur]) || 1;

  function computeCost() {
    const groups = TRIP.costPlan.groups.map((g) => {
      let low = 0, high = 0;
      g.items.forEach((item, i) => {
        const v = costValue(g.key, i, item);
        low += v.low * rate(item.currency);
        high += v.high * rate(item.currency);
      });
      return { ...g, lowILS: low, highILS: high };
    });

    const included = groups.filter((g) => g.core || state.costIncludeExtras);
    const low = included.reduce((s, g) => s + g.lowILS, 0);
    const high = included.reduce((s, g) => s + g.highILS, 0);

    return { groups, low, high, mid: (low + high) / 2 };
  }

  function renderCostPlan() {
    $("#costNote").textContent = TRIP.costPlan.note;
    $("#costIncludeExtras").checked = state.costIncludeExtras;

    const c = computeCost();
    const nights = TRIP.days.filter((d) => d.hotel).length;

    $("#costSummary").innerHTML = `
      <div class="exp-tile exp-tile--settle">
        <div class="exp-tile__lbl">סה"כ לזוג</div>
        <div class="exp-tile__val">${ils(c.mid)}</div>
        <div class="exp-tile__sub">טווח ${ilsRange(c.low, c.high)} · ${extrasLabel()}</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">לאדם</div>
        <div class="exp-tile__val">${ils(c.mid / 2)}</div>
        <div class="exp-tile__sub">טווח ${ilsRange(c.low / 2, c.high / 2)}</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">ללילה לזוג</div>
        <div class="exp-tile__val">${ils(c.mid / nights)}</div>
        <div class="exp-tile__sub">על פני ${nights} לילות</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">ליום לזוג</div>
        <div class="exp-tile__val">${ils(c.mid / TRIP.days.length)}</div>
        <div class="exp-tile__sub">על פני ${TRIP.days.length} ימים</div>
      </div>`;

    const maxGroup = Math.max(...c.groups.map((g) => g.highILS), 1);

    $("#costGroups").innerHTML = c.groups
      .map((g) => {
        const dimmed = !g.core && !state.costIncludeExtras;
        const rows = g.items
          .map((item, i) => {
            const v = costValue(g.key, i, item);
            const id = g.key + ":" + i;
            return `
            <tr>
              <td class="note row-title">
                <strong>${esc(item.label)}</strong>
                <div class="muted" style="white-space:normal">${esc(item.detail)}</div>
              </td>
              <td data-label="מ־">
                <input type="number" class="cost-input" data-cost="${id}" data-bound="low"
                       value="${v.low}" min="0" step="10" aria-label="מינימום — ${esc(item.label)}" />
              </td>
              <td data-label="עד">
                <input type="number" class="cost-input" data-cost="${id}" data-bound="high"
                       value="${v.high}" min="0" step="10" aria-label="מקסימום — ${esc(item.label)}" />
              </td>
              <td data-label="מטבע">${esc(item.currency)}</td>
              <td class="num" data-label="בש&quot;ח">${ilsRange(v.low * rate(item.currency), v.high * rate(item.currency))}</td>
            </tr>`;
          })
          .join("");

        return `
        <div class="card mb-2 cost-group${dimmed ? " is-dimmed" : ""}">
          <div class="pad row-between" style="padding-bottom:.5rem">
            <h3 style="margin:0">${g.icon} ${esc(g.title)}${
              g.core ? "" : ' <span class="badge" style="color:var(--txt-mute)">אופציונלי</span>'
            }</h3>
            <strong style="font-variant-numeric:tabular-nums">${ilsRange(g.lowILS, g.highILS)}</strong>
          </div>
          <div class="pad" style="padding-top:0;padding-bottom:.6rem">
            <span class="bar-track"><i class="bar-fill" style="width:${(g.highILS / maxGroup) * 100}%;background:var(--moss)"></i></span>
          </div>
          <div class="table-scroll">
            <table class="data cost-table">
              <thead>
                <tr><th>סעיף</th><th>מ־</th><th>עד</th><th>מטבע</th><th>בש"ח</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
      })
      .join("");

    $$("[data-cost]").forEach((inp) =>
      inp.addEventListener("input", () => {
        const key = inp.dataset.cost;
        const bound = inp.dataset.bound;
        const raw = inp.value.trim();
        const val = parseFloat(raw);

        if (raw === "") {
          // שדה שרוקן חוזר לאומדן המקורי — גם אצל בן/בת הזוג
          if (state.costOverrides[key]) {
            delete state.costOverrides[key][bound];
            if (!Object.keys(state.costOverrides[key]).length) delete state.costOverrides[key];
          }
        } else if (Number.isFinite(val) && val >= 0) {
          state.costOverrides[key] = state.costOverrides[key] || {};
          state.costOverrides[key][bound] = val;
        } else {
          return;   // הקלדה חלקית כמו "-" או "." — לא נוגעים במצב
        }

        save();
        renderCostSummaryOnly();
        queueCostSync(key);
      })
    );
  }

  /**
   * עריכת עלות יורה על כל הקלדה — מחכים לרגע שקט לפני ששולחים.
   * נשלחות רק השורות שנגעו בהן, ולא כל המפה: שני בני הזוג עורכים שורות
   * שונות באותו זמן, והחלפה מלאה מתמונת מצב ישנה הייתה מוחקת את השני.
   */
  let costSyncTimer = null;
  const costSyncPending = new Set();

  function queueCostSync(key) {
    costSyncPending.add(key);
    clearTimeout(costSyncTimer);
    costSyncTimer = setTimeout(flushCostSync, 700);
  }

  function flushCostSync() {
    if (!costSyncPending.size) return;
    const payload = {};
    // null = "מחק בשרת", כלומר השורה חזרה לאומדן
    costSyncPending.forEach((k) => { payload[k] = state.costOverrides[k] ?? null; });
    costSyncPending.clear();
    TripAPI.saveCost(payload);
  }

  /** מרענן רק את הסיכומים, כדי לא לאבד פוקוס בשדה שעורכים כרגע */
  function renderCostSummaryOnly() {
    const c = computeCost();
    const nights = TRIP.days.filter((d) => d.hotel).length;
    const tiles = $$("#costSummary .exp-tile__val");
    const subs = $$("#costSummary .exp-tile__sub");
    if (tiles.length === 4) {
      tiles[0].textContent = ils(c.mid);
      tiles[1].textContent = ils(c.mid / 2);
      tiles[2].textContent = ils(c.mid / nights);
      tiles[3].textContent = ils(c.mid / TRIP.days.length);
      subs[0].innerHTML = `טווח ${ilsRange(c.low, c.high)} · ${extrasLabel()}`;
      subs[1].innerHTML = `טווח ${ilsRange(c.low / 2, c.high / 2)}`;
    }
    const maxGroup = Math.max(...c.groups.map((g) => g.highILS), 1);
    $$("#costGroups .cost-group").forEach((el, i) => {
      const g = c.groups[i];
      if (!g) return;
      $(".row-between strong", el).innerHTML = ilsRange(g.lowILS, g.highILS);
      $(".bar-fill", el).style.width = (g.highILS / maxGroup) * 100 + "%";
      el.classList.toggle("is-dimmed", !g.core && !state.costIncludeExtras);
      $$("tbody tr", el).forEach((tr, j) => {
        const item = g.items[j];
        const v = costValue(g.key, j, item);
        $("td.num", tr).innerHTML =
          ilsRange(v.low * rate(item.currency), v.high * rate(item.currency));
      });
    });
  }

  $("#costIncludeExtras").addEventListener("change", (e) => {
    state.costIncludeExtras = e.target.checked;
    save();
    renderCostSummaryOnly();
  });

  /* ==================================================================== */
  /*  הוצאות                                                              */
  /* ==================================================================== */

  const CATEGORIES = [
    { name: "אוכל",      color: "#4cc9a4" },
    { name: "דלק",       color: "#c0d860" },
    { name: "לינה",      color: "#f4845f" },
    { name: "טיסות",     color: "#5ec8e5" },
    { name: "נסיעות",    color: "#8ab4f8" },
    { name: "אטרקציות",  color: "#b088f9" },
    { name: "חניה",      color: "#e0a458" },
    { name: "קניות",     color: "#f0a202" },
    { name: "בילויים",   color: "#e06c9f" },
    { name: "רפואה",     color: "#ff6b6b" },
    { name: "אחר",       color: "#8898aa" },
  ];

  const CURRENCIES = ["₾", "$", "€", "₪"];
  const CURRENCY_LABEL = { "₾": "לארי", "$": "דולר", "€": "אירו", "₪": "שקל", "£": "ליש\"ט" };

  const catColor = (name) =>
    (CATEGORIES.find((c) => c.name === name) || { color: "#8898aa" }).color;

  /** המרה לשקל לפי השערים הנוכחיים */
  const toILS = (item) => (Number(item.amount) || 0) * (Number(state.rates[item.currency]) || 1);

  /* ------------------------------------------------------ טופס הזנה -- */

  function fillSelects() {
    $("#exCurrency").innerHTML = CURRENCIES.map(
      (c) => `<option value="${c}">${c} ${CURRENCY_LABEL[c]}</option>`
    ).join("");

    $("#exCategory").innerHTML = CATEGORIES.map(
      (c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`
    ).join("");

    const prev = $("#exPayer").value;
    $("#exPayer").innerHTML = state.people
      .map((p) => `<option value="${esc(p.name)}">${esc(p.name)} (זוג ${p.group})</option>`)
      .join("");
    if (prev && state.people.some((p) => p.name === prev)) $("#exPayer").value = prev;
  }

  $("#expForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = parseFloat($("#exAmount").value);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const expense = {
      date: $("#exDate").value,
      amount,
      currency: $("#exCurrency").value,
      category: $("#exCategory").value,
      payer: $("#exPayer").value,
      note: $("#exNote").value.trim(),
    };

    // מנקים את הטופס מיד — מבחינת המשתמש ההוצאה כבר נרשמה
    $("#exAmount").value = "";
    $("#exNote").value = "";
    $("#exAmount").focus();

    // השרת מקצה את המזהה; במצב מקומי מייצרים אותו כאן
    const saved = await TripAPI.addExpense(expense);
    state.expenses.push(saved && saved.id ? saved : { ...expense, id: localId() });

    save();
    renderExpenses();
  });

  const localId = () =>
    crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

  /* ------------------------------------------------------- מטיילים --- */

  function renderPeople() {
    $("#peopleList").innerHTML = state.people.length
      ? `<div class="pill-row">${state.people
          .map(
            (p, i) =>
              `<span class="chip is-on" style="background:var(--ink-700);border-color:var(--line-strong);color:var(--txt)">
                 ${esc(p.name)} · זוג ${p.group}
                 <button class="btn btn--sm btn--ghost" data-del-person="${i}" title="הסרה"
                         style="padding:0 .25rem;border:0;color:var(--txt-mute)">✕</button>
               </span>`
          )
          .join("")}</div>`
      : `<p class="muted">לא הוגדרו מטיילים.</p>`;

    $$("[data-del-person]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.people.splice(Number(btn.dataset.delPerson), 1);
        save();
        TripAPI.saveSettings({ people: state.people });
        fillSelects();
        renderPeople();
        renderExpenses();
      })
    );
  }

  $("#personForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#pName").value.trim();
    if (!name) return;
    if (state.people.some((p) => p.name === name)) {
      alert("מטייל בשם הזה כבר קיים.");
      return;
    }
    state.people.push({ name, group: Number($("#pGroup").value) });
    $("#pName").value = "";
    save();
    TripAPI.saveSettings({ people: state.people });
    fillSelects();
    renderPeople();
    renderExpenses();
  });

  /* --------------------------------------------------------- שערים --- */

  function renderRates() {
    // אותם שערים משמשים את שתי הלשוניות — התכנון מראש וההוצאות בפועל
    ["#rateGrid", "#costRateGrid"].forEach((sel, gridIdx) => {
      $(sel).innerHTML = CURRENCIES.filter((c) => c !== "₪")
        .map(
          (c) => `
          <div class="field">
            <label for="rate-${gridIdx}-${c}">1 ${c} = ₪</label>
            <input type="number" id="rate-${gridIdx}-${c}" data-rate="${c}" step="0.001" min="0"
                   value="${state.rates[c]}" />
          </div>`
        )
        .join("");
    });

    $$("[data-rate]").forEach((inp) =>
      inp.addEventListener("input", () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v) || v <= 0) return;
        const cur = inp.dataset.rate;
        state.rates[cur] = v;
        save();
        // משקפים את השינוי בשדה המקביל בלשונית השנייה
        $$(`[data-rate="${cur}"]`).forEach((other) => {
          if (other !== inp) other.value = v;
        });
        renderExpenses();
        renderCostSummaryOnly();
        queueRateSync();
      })
    );
  }

  /** שינוי שער יורה על כל הקלדה — מחכים לרגע שקט לפני ששולחים לשרת */
  let rateSyncTimer = null;
  function queueRateSync() {
    clearTimeout(rateSyncTimer);
    rateSyncTimer = setTimeout(() => TripAPI.saveSettings({ rates: state.rates }), 700);
  }

  /* ------------------------------------------------------- חישובים --- */

  /**
   * מחשב סיכומים: לפי אדם, לפי זוג, ואת ההעברות הנדרשות לאיזון.
   * החלוקה שוויונית לנפש — בדיוק כמו בגיליון המקורי.
   */
  function computeTotals() {
    const total = state.expenses.reduce((s, e) => s + toILS(e), 0);

    const byPerson = {};
    state.people.forEach((p) => (byPerson[p.name] = 0));
    state.expenses.forEach((e) => {
      byPerson[e.payer] = (byPerson[e.payer] || 0) + toILS(e);
    });

    const headcount = state.people.length || 1;
    const perHead = total / headcount;

    // צבירה לפי זוג
    const groups = {};
    state.people.forEach((p) => {
      groups[p.group] = groups[p.group] || { id: p.group, members: [], paid: 0, size: 0 };
      groups[p.group].members.push(p.name);
      groups[p.group].size += 1;
      groups[p.group].paid += byPerson[p.name] || 0;
    });

    // תשלומים של מי שכבר לא ברשימת המטיילים — לא משויכים לזוג
    Object.values(groups).forEach((g) => {
      g.fairShare = perHead * g.size;
      g.balance = g.paid - g.fairShare; // חיובי = שילם יותר מהחלק שלו
    });

    const groupList = Object.values(groups).sort((a, b) => a.id - b.id);

    // אלגוריתם קיזוז חמדני בין הזוגות
    const debtors = groupList.filter((g) => g.balance < -0.5).map((g) => ({ ...g }));
    const creditors = groupList.filter((g) => g.balance > 0.5).map((g) => ({ ...g }));
    const transfers = [];

    let di = 0, ci = 0;
    while (di < debtors.length && ci < creditors.length) {
      const amount = Math.min(-debtors[di].balance, creditors[ci].balance);
      if (amount > 0.5) {
        transfers.push({ from: debtors[di], to: creditors[ci], amount });
      }
      debtors[di].balance += amount;
      creditors[ci].balance -= amount;
      if (Math.abs(debtors[di].balance) < 0.5) di++;
      if (Math.abs(creditors[ci].balance) < 0.5) ci++;
    }

    return { total, perHead, byPerson, groupList, transfers, headcount };
  }

  /* -------------------------------------------------------- תצוגה --- */

  function renderExpenses() {
    const t = computeTotals();
    const days = TRIP.days.length;

    /* --- אריחי סיכום --- */
    $("#expSummary").innerHTML = `
      <div class="exp-tile">
        <div class="exp-tile__lbl">סה"כ הוצאות</div>
        <div class="exp-tile__val">${ils(t.total)}</div>
        <div class="exp-tile__sub">${state.expenses.length} רשומות</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">לאדם</div>
        <div class="exp-tile__val">${ils(t.perHead)}</div>
        <div class="exp-tile__sub">${t.headcount} מטיילים</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">ממוצע ליום</div>
        <div class="exp-tile__val">${ils(t.total / days)}</div>
        <div class="exp-tile__sub">על פני ${days} ימים</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">לאדם ליום</div>
        <div class="exp-tile__val">${ils(t.total / days / t.headcount)}</div>
        <div class="exp-tile__sub">כולל הכול</div>
      </div>
      ${t.groupList
        .map(
          (g) => `
        <div class="exp-tile">
          <div class="exp-tile__lbl">זוג ${g.id} — ${esc(g.members.join(", "))}</div>
          <div class="exp-tile__val">${ils(g.paid)}</div>
          <div class="exp-tile__sub">חלק הוגן ${ils(g.fairShare)} · ${
            g.balance >= 0 ? "זכאי ל" : "חייב "
          }${ils(Math.abs(g.balance))}</div>
        </div>`
        )
        .join("")}
    `;

    /* --- שורת הקיזוז --- */
    $("#settleNote").innerHTML = !state.expenses.length
      ? `עדיין לא הוזנו הוצאות. הוסיפו את ההוצאה הראשונה כדי לראות את הקיזוז.`
      : t.transfers.length
      ? `<strong>סגירת חשבון:</strong> ` +
        t.transfers
          .map(
            (tr) =>
              `זוג ${tr.from.id} (${esc(tr.from.members.join(" ו"))}) מעביר
               <strong>${ils2(tr.amount)}</strong>
               לזוג ${tr.to.id} (${esc(tr.to.members.join(" ו"))})`
          )
          .join(" · ")
      : `<strong>מאוזן.</strong> אין צורך בהעברה בין הזוגות.`;

    /* --- טבלה --- */
    const sorted = [...state.expenses].sort((a, b) =>
      (a.date || "").localeCompare(b.date || "")
    );

    $("#expCount").textContent = state.expenses.length;
    $("#expBody").innerHTML = sorted.length
      ? sorted
          .map(
            (e) => `
        <tr>
          <td class="num" data-label="תאריך">${e.date ? shortDate(e.date) : "—"}</td>
          <td data-label="סעיף">
            <i class="cat-dot" style="background:${catColor(e.category)}"></i>${esc(e.category)}
            <!-- בטלפון העמודות "מי שילם" ו"הערות" אינן נכנסות לרוחב,
                 והתוכן שלהן יורד לשורה שנייה בתוך אותו תא -->
            <span class="exp-sub">${esc(e.payer)}${e.note ? " · " + esc(e.note) : ""}</span>
          </td>
          <td data-label="מי שילם">${esc(e.payer)}</td>
          <td class="num" data-label="סכום">${nfNum.format(e.amount)}<span class="exp-cur"> ${esc(e.currency)}</span></td>
          <td data-label="מטבע">${esc(e.currency)}</td>
          <td class="num" data-label="בש&quot;ח">${ils2(toILS(e))}</td>
          <td class="note" data-label="הערות">${esc(e.note) || "—"}</td>
          <td class="row-action"><button class="btn btn--sm btn--ghost btn--danger"
                data-del="${e.id}" aria-label="מחיקה"><span>✕</span> <b>מחיקה</b></button></td>
        </tr>`
          )
          .join("")
      : `<tr class="empty-row"><td colspan="8">אין הוצאות עדיין.</td></tr>`;

    $$("[data-del]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.del;
        await TripAPI.deleteExpense(id);
        state.expenses = state.expenses.filter((x) => x.id !== id);
        save();
        renderExpenses();
      })
    );

    // הקוביה מציגה כמה יצא היום; כל שינוי בהוצאות משנה אותה. זו הנקודה
    // היחידה שכל המסלולים עוברים בה — הוספה, מחיקה, סנכרון וייבוא
    renderNow();

    /* --- חלוקה לסעיפים --- */
    const byCat = {};
    state.expenses.forEach((e) => {
      byCat[e.category] = (byCat[e.category] || 0) + toILS(e);
    });
    const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const maxCat = Math.max(...catEntries.map((c) => c[1]), 1);

    $("#catBars").innerHTML = catEntries.length
      ? catEntries
          .map(
            ([name, sum]) => `
        <div class="bar-row">
          <span>${esc(name)}</span>
          <span class="bar-track"><i class="bar-fill" style="width:${(sum / maxCat) * 100}%;background:${catColor(name)}"></i></span>
          <span class="bar-val">${ils(sum)} · ${Math.round((sum / (t.total || 1)) * 100)}%</span>
        </div>`
          )
          .join("")
      : `<p class="muted">אין נתונים עדיין.</p>`;

    /* --- לפי אדם --- */
    const personEntries = Object.entries(t.byPerson).sort((a, b) => b[1] - a[1]);
    const maxPerson = Math.max(...personEntries.map((p) => p[1]), 1);

    $("#personBars").innerHTML = personEntries.length
      ? personEntries
          .map(
            ([name, sum]) => `
        <div class="bar-row">
          <span>${esc(name)}</span>
          <span class="bar-track"><i class="bar-fill" style="width:${(sum / maxPerson) * 100}%;background:var(--sky)"></i></span>
          <span class="bar-val">${ils(sum)}</span>
        </div>`
          )
          .join("")
      : `<p class="muted">אין נתונים עדיין.</p>`;

    /* --- הוצאה יומית --- */
    renderDaily();

    /* --- תקציב --- */
    renderBudget(t.total);

    // ההוצאות מופיעות גם כצ'יפ על היום במבט העל
    paintJourneyChips();
  }

  /**
   * תקרה "עגולה" לציר.
   *
   * הקו העליון של גרף צריך להיות מספר שאפשר לקרוא — 800 ולא 783. בלי
   * זה הקו העליון הוא תמיד בדיוק גובה העמודה הגבוהה, והעין לא לומדת
   * ממנו כלום.
   */
  const NICE = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const pow = 10 ** Math.floor(Math.log10(v));
    const n = v / pow;
    // סולם צפוף: 1,240 הופך ל-1,250 ולא ל-2,000, אחרת חצי הגרף ריק
    return (NICE.find((x) => n <= x + 1e-9) ?? 10) * pow;
  }

  /** איזה יום נבחר בגרף (להצגת הפירוט מתחתיו), ומה הנתונים שמוצגים */
  let dailyPick = null;
  let dailyRows = [];
  let dailyAvg = 0;

  /**
   * כמה יצא בכל יום — עמודות.
   *
   * סדרה אחת, ולכן אין מקרא: הכותרת אומרת מה זה. הצבע אחיד, כי הוא
   * מזהה את הסדרה ולא את הדירוג — יום יקר אינו "קטגוריה אחרת". מה
   * שמבדיל את היום הנוכחי הוא טבעת ותווית, לא גוון.
   *
   * המספרים כתובים על כל עמודה (שישה ימים, לא שישים), בצבע הטקסט ולא
   * בצבע העמודה. יום בלי הוצאות מקבל "—" ובסיס דק — היעדר שצריך
   * לראות אותו, ולא עמודה שנעלמת.
   *
   * קו הממוצע הוא מה שהופך את הגרף לשימושי: בלעדיו רואים שישה מספרים,
   * ואיתו רואים אילו ימים חרגו.
   */
  function renderDaily() {
    const host = $("#dailyChart");
    if (!host) return;

    const byDate = {};
    const cntDate = {};
    state.expenses.forEach((e) => {
      if (!e.date) return;
      byDate[e.date] = (byDate[e.date] || 0) + toILS(e);
      cntDate[e.date] = (cntDate[e.date] || 0) + 1;
    });

    const rows = TRIP.days.map((d) => ({
      n: d.n,
      date: d.date,
      dow: dowShort(d),
      sum: byDate[d.date] || 0,
      count: cntDate[d.date] || 0,
      title: d.title || "",
    }));

    const spent = rows.reduce((a, r) => a + r.sum, 0);
    if (!spent) {
      host.innerHTML = `<p class="muted">אין עדיין הוצאות. הגרף ייבנה מהרשומה הראשונה.</p>`;
      return;
    }

    const top = niceMax(Math.max(...rows.map((r) => r.sum)));
    const avg = spent / rows.length;
    const today = todayISO();

    const bars = rows
      .map((r) => {
        const pct = r.sum > 0 ? Math.max((r.sum / top) * 100, 3) : 0;
        const isToday = r.date === today;
        return `
        <button type="button" class="chart__col${isToday ? " is-today" : ""}${
          r.sum ? "" : " is-zero"
        }" data-daily="${r.n}"
                aria-label="יום ${r.n}, ${esc(fullDate(r.date))}: ${
                  r.sum ? esc(ils(r.sum)) : "ללא הוצאות"
                }">
          <span class="chart__val">${r.sum ? nfNum.format(Math.round(r.sum)) : "—"}</span>
          <span class="chart__slot">
            ${r.sum
              ? `<span class="chart__bar" style="block-size:${pct}%"></span>`
              : `<span class="chart__zero" aria-hidden="true"></span>`}
          </span>
          <span class="chart__x"><b>${r.n}</b><i>${esc(r.dow)}</i></span>
        </button>`;
      })
      .join("");

    dailyRows = rows;
    dailyAvg = avg;
    if (!rows.some((r) => r.n === dailyPick)) {
      const first = rows.find((r) => r.date === today && r.sum)
        || rows.reduce((a, b) => (b.sum > a.sum ? b : a));
      dailyPick = first.n;
    }

    host.innerHTML = `
      <figure class="chart">
        <figcaption class="chart__head">
          <span class="chart__unit">שקלים ליום</span>
          <span class="chart__avg-key">ממוצע ${esc(ils(avg))}</span>
        </figcaption>

        <div class="chart__plot" style="--chart-top:${top}">
          <span class="chart__grid"><i>${esc(nfNum.format(top))}</i></span>
          <span class="chart__avg" style="inset-block-end:${(avg / top) * 100}%"
                aria-hidden="true"></span>
          <div class="chart__cols">${bars}</div>
        </div>

        <p class="chart__read" data-daily-read aria-live="polite">${readDaily()}</p>
      </figure>`;

    markDaily();
  }

  /** הפירוט של היום שנבחר. טקסט בלבד — הוא מתחלף בלי לבנות את הגרף מחדש. */
  function readDaily() {
    const r = dailyRows.find((x) => x.n === dailyPick);
    if (!r) return "";
    const rel = r.sum >= dailyAvg ? "מעל הממוצע" : "מתחת לממוצע";
    return `
      <b>יום ${r.n} · ${esc(fullDate(r.date))}</b>
      <span>${r.sum
        ? `${esc(ils(r.sum))} ב-${r.count} ${r.count === 1 ? "רשומה" : "רשומות"} · ${rel}`
        : "לא נרשמו הוצאות ביום הזה"}</span>
      ${r.title ? `<small>${esc(r.title)}</small>` : ""}`;
  }

  /**
   * החלפת היום הנבחר בלי רינדור מחדש.
   *
   * ריחוף מעל הגרף במחשב קורה עשרות פעמים בשנייה. בנייה מחדש של ה-HTML
   * בכל אחת מהן מנתקת את הכפתור שמתחת לסמן — ואז לחיצה עליו אפילו לא
   * מגיעה. כאן מתחלפים רק מחלקה אחת ושורת טקסט.
   */
  function markDaily() {
    const host = $("#dailyChart");
    if (!host) return;
    $$(".chart__col", host).forEach((b) =>
      b.classList.toggle("is-on", Number(b.dataset.daily) === dailyPick)
    );
    const read = $("[data-daily-read]", host);
    if (read) read.innerHTML = readDaily();
  }

  function wireDaily() {
    const host = $("#dailyChart");
    if (!host) return;
    const pickFrom = (e) => {
      const b = e.target.closest("[data-daily]");
      if (!b) return;
      const n = Number(b.dataset.daily);
      if (n === dailyPick) return;        // אותו יום — אין מה לעדכן
      dailyPick = n;
      markDaily();
    };
    host.addEventListener("click", pickFrom);
    // במחשב מספיק לרחף; בטלפון אין ריחוף, ולכן יש גם לחיצה
    host.addEventListener("pointerover", (e) => {
      if (e.pointerType === "mouse") pickFrom(e);
    });
  }

  function renderBudget(total) {
    const input = $("#budgetInput");
    if (document.activeElement !== input) input.value = state.budget ?? "";

    const budget = Number(state.budget) || 0;
    if (!budget) {
      $("#budgetBar").style.width = "0%";
      $("#budgetText").textContent = "לא הוגדר תקציב.";
      return;
    }

    const pct = Math.min((total / budget) * 100, 100);
    $("#budgetBar").style.width = pct + "%";
    $("#budgetBar").style.background =
      total > budget ? "var(--danger)" : total > budget * 0.8 ? "var(--gold)" : "var(--moss)";
    $("#budgetText").textContent =
      total > budget
        ? `חריגה של ${ils(total - budget)} מהתקציב (${ils(budget)}).`
        : `נוצלו ${ils(total)} מתוך ${ils(budget)} — נותרו ${ils(budget - total)}.`;
  }

  $("#budgetInput").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    state.budget = Number.isFinite(v) && v > 0 ? v : null;
    save();
    renderBudget(computeTotals().total);
  });

  /* ------------------------------------------------------ CSV I/O --- */

  const csvCell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  $("#exportCsv").addEventListener("click", () => {
    const header = ["תאריך", "סכום", "מטבע", "סעיף הוצאה", "מי שילם", 'בש"ח', "הערות"];
    const rows = [...state.expenses]
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .map((e) => [e.date, e.amount, e.currency, e.category, e.payer, toILS(e).toFixed(2), e.note]);

    // BOM כדי ש-Excel יזהה UTF-8 ויציג עברית תקינה
    const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "הוצאות-טביליסי-2026.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#importCsv").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCsv(String(reader.result).replace(/^﻿/, ""));
        const [header, ...body] = rows;
        const idx = (name) => header.findIndex((h) => h.trim() === name);

        const iDate = idx("תאריך"), iAmt = idx("סכום"), iCur = idx("מטבע");
        const iCat = idx("סעיף הוצאה"), iPay = idx("מי שילם"), iNote = idx("הערות");

        if (iDate < 0 || iAmt < 0) {
          alert('הקובץ לא בפורמט הצפוי. נדרשות לפחות עמודות "תאריך" ו"סכום".');
          return;
        }

        let added = 0;
        body.forEach((r) => {
          const amount = parseFloat(r[iAmt]);
          if (!Number.isFinite(amount) || amount <= 0) return;
          state.expenses.push({
            id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
            date: normalizeDate(r[iDate]),
            amount,
            currency: CURRENCIES.includes(r[iCur]?.trim()) ? r[iCur].trim() : "₾",
            category: r[iCat]?.trim() || "אחר",
            payer: r[iPay]?.trim() || state.people[0]?.name || "",
            note: r[iNote]?.trim() || "",
          });
          added++;
        });

        save();
        renderExpenses();
        alert(`יובאו ${added} רשומות.`);
      } catch (err) {
        console.error(err);
        alert("קריאת הקובץ נכשלה.");
      }
      e.target.value = "";
    };
    reader.readAsText(file, "utf-8");
  });

  /** מנתח CSV פשוט התומך בשדות מצוטטים ובפסיקים בתוכם */
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQuotes = false;
        } else cell += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  /** מקבל yyyy-mm-dd או dd/mm/yyyy ומחזיר yyyy-mm-dd */
  function normalizeDate(raw) {
    const s = String(raw || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
    if (m) {
      return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    }
    return TRIP.days[0].date;
  }

  $("#clearExp").addEventListener("click", () => {
    if (!state.expenses.length) return;
    const msg = TripAPI.isOnline
      ? `למחוק את כל ${state.expenses.length} ההוצאות? הפעולה תמחק אותן גם אצל שאר המטיילים.`
      : `למחוק את כל ${state.expenses.length} ההוצאות?`;
    if (confirm(msg)) {
      TripAPI.clearExpenses();
      state.expenses = [];
      save();
      renderExpenses();
    }
  });

  /* ==================================================================== */
  /*  שכבת הטיולים — מסך פתיחה, אשף, ועריכת יום                          */
  /* ==================================================================== */

  /** כל מה שתלוי בטיול ונמצא מחוץ ללשוניות: כותרת, hero, מוני ה-hero */
  function applyTripChrome() {
    const m = TRIP.meta;
    const from = TRIP.days[0]?.date || "";
    const to = TRIP.days[TRIP.days.length - 1]?.date || "";
    const short = (iso) => (iso ? `${+iso.slice(8, 10)}.${+iso.slice(5, 7)}` : "");
    const range = from ? `${short(from)}–${short(to)}.${to.slice(0, 4)}` : "";

    document.title = range ? `${m.title} · ${range}` : m.title;
    $("#heroTitle").textContent = m.title;
    $("#heroEyebrow").textContent = range ? `🧳 ${fullDate(from)} – ${fullDate(to)}` : m.title;
    $("#heroSub").textContent = m.subtitle || "";

    // לילות הטיול, לא מספר הלינות שהוזנו — טיול חדש עדיין בלי מלונות
    const nights = Math.max(TRIP.days.length - 1, 0);
    const driveKm = TRIP.days.reduce((a, d) => a + (d.drive?.km || 0), 0);
    const stats = [
      [TRIP.days.length, "ימים"],
      [nights, "לילות"],
      [TRIP.days.filter((d) => d.mode === "drive").length, "ימי נסיעה"],
      [nfNum.format(m.totalDrivingKm || driveKm), 'ק"מ (מוערך)'],
    ];

    // המספרים הם מידע **על** הטיול ולא הטיול עצמו: משפט אחד בראש הדף,
    // והאריחים המלאים בלשונית המידע
    $("#heroNumbers").textContent =
      " · " + stats.map(([v, l]) => `${v} ${l}`).join(" · ");

    $("#tripStats").innerHTML =
      `<div class="stat"><div class="stat__val countdown" id="countdown">—</div>
         <div class="stat__lbl">עד היציאה</div></div>` +
      stats
        .map(
          ([v, l]) =>
            `<div class="stat"><div class="stat__val">${esc(String(v))}</div>
               <div class="stat__lbl">${esc(l)}</div></div>`
        )
        .join("");

    renderJourney();
    tickCountdown();                 // האריח נבנה זה עתה וצריך את הערך שלו
  }

  /** רינדור מחדש של כל מה שתלוי בטיול. נקרא גם באתחול וגם במעבר טיול. */
  function renderTrip() {
    applyTripChrome();
    tickCountdown();
    renderNow();
    renderClocks();

    activeDay = "all";
    if (map) { map.remove(); map = null; }
    dayLayers.clear();
    renderMapControls();
    syncNavButton();
    initMap();
    renderRouteStats();
    renderDays();
    renderImprovements();
    renderInfo();
    renderPacking();
    FlightsView.render();        // אסינכרוני — קורא מסמכים מ-IndexedDB
    if (typeof FoodFinder !== "undefined") FoodFinder.render();
    renderTripDocs();            // אסינכרוני מאותה סיבה

    fillSelects();
    renderPeople();
    renderRates();
    renderCostPlan();

    const today = new Date().toISOString().slice(0, 10);
    const inTrip = TRIP.days.some((d) => d.date === today);
    $("#exDate").value = inTrip ? today : TRIP.days[0]?.date || today;
    renderExpenses();

    // הנתונים החיצוניים תלויים במסלול עצמו (תאריכים ונקודות), ולכן הם
    // נטענים אחרי שהוא רונדר ולא לפניו
    LiveView.load(false);
  }

  function switchTrip(id) {
    const doc = TripStore.setActive(id);
    if (!doc) return;
    TRIP = doc;
    state = load();         // ההעדפות המקומיות של הטיול הזה (ציוד, overrides)
    applyTheme();
    LiveView.reset();       // תחזית של היעד הקודם אינה אומרת דבר על החדש
    renderTrip();
    closeTrips();
  }

  /* ---------------------------- מסך הפתיחה ---------------------------- */

  const overlay = () => $("#tripsOverlay");

  function openTrips() {
    renderTripList();
    $("#tripsPicker").hidden = false;
    $("#tripsWizard").hidden = true;
    overlay().hidden = false;
  }
  function closeTrips() { overlay().hidden = true; }

  function renderTripList() {
    const list = TripStore.list();
    const activeId = TripStore.activeId();

    $("#tripsList").innerHTML = list
      .map((t) => {
        const d = t.days || [];
        const from = d[0]?.date || "";
        const to = d[d.length - 1]?.date || "";
        const people = (t.travellers || []).length;
        const meta = [
          d.length ? `${d.length} ימים` : "",
          from ? `${fullDate(from)} – ${fullDate(to)}` : "",
          people ? `${people} נוסעים` : "",
        ].filter(Boolean).join(" · ");
        return `
          <div class="trip-row ${t.id === activeId ? "is-active" : ""}">
            <button class="trip-row__body" data-trip="${esc(t.id)}" type="button">
              <span class="trip-row__title">${esc(t.meta?.title || "ללא שם")}</span>
              <span class="trip-row__meta">${esc(meta)}</span>
            </button>
            ${t.id === activeId ? '<span class="trip-row__badge">פעיל</span>' : ""}
            <button class="trip-row__del" data-edit-trip="${esc(t.id)}" type="button"
                    title="תאריכים ומספר ימים" aria-label="עריכת תאריכים">📆</button>
            <button class="trip-row__del" data-del="${esc(t.id)}" type="button"
                    title="מחיקת הטיול" aria-label="מחיקת הטיול">🗑️</button>
          </div>
          <div class="trip-edit" data-editor-trip="${esc(t.id)}" hidden></div>`;
      })
      .join("") || '<p class="muted" style="padding:8px 4px">אין עדיין טיולים. צרו את הראשון.</p>';
  }

  /**
   * עורך התאריכים של טיול.
   *
   * שני שדות בלבד — מתי מתחילים וכמה ימים — כי הם מה שבאמת משתנה, ושאר
   * הדברים נגזרים מהם. ההשלכות מוצגות לפני האישור, כמו בכל שינוי אחר
   * באפליקציה: כמה ימים נוספים, אילו ימים יורדים, ומה מתוכם כבר מתוכנן.
   */
  function openTripEditor(id) {
    const doc = TripStore.list().find((t) => t.id === id);
    const box = $(`[data-editor-trip="${CSS.escape(id)}"]`);
    if (!doc || !box) return;

    const open = box.hidden;
    $$("#tripsList .trip-edit").forEach((el) => { el.hidden = true; });
    if (!open) return;

    const from = doc.days?.[0]?.date || "";
    const count = (doc.days || []).length;

    box.innerHTML = `
      <div class="trip-edit__row">
        <label>מתחילים ב־
          <input type="date" data-te-from value="${esc(from)}" />
        </label>
        <label>מספר ימים
          <input type="number" data-te-days value="${count}" min="1" max="60" />
        </label>
      </div>
      <p class="trip-edit__note" data-te-note></p>
      <div class="trip-edit__actions">
        <button type="button" class="btn btn--sm" data-te-cancel>ביטול</button>
        <button type="button" class="btn btn--sm btn--primary" data-te-save>עדכן את הטיול</button>
      </div>`;
    box.hidden = false;
    previewTripEdit(id);
  }

  /** התיאור שמתחת לשדות, שמתעדכן עם כל הקלדה */
  function previewTripEdit(id) {
    const box = $(`[data-editor-trip="${CSS.escape(id)}"]`);
    if (!box) return;
    const from = $("[data-te-from]", box).value;
    const count = Number($("[data-te-days]", box).value);
    const note = $("[data-te-note]", box);
    const save = $("[data-te-save]", box);

    const plan = TripStore.planReschedule(id, from, count);
    if (!plan) {
      note.textContent = "צריך תאריך התחלה ומספר ימים.";
      note.className = "trip-edit__note is-warn";
      save.disabled = true;
      return;
    }

    save.disabled = false;
    const nDays = (k) => (k === 1 ? "יום אחד" : `${k} ימים`);
    const head = `${fullDate(plan.from)} – ${fullDate(plan.to)} · ${nDays(plan.count)}`;
    const rest = [];
    if (plan.shifted) rest.push("כל הימים יזוזו יחד, עם התוכן שלהם.");
    if (plan.grow > 0) {
      rest.push(
        `${nDays(plan.grow)} ייווצרו ריקים` +
          (plan.keepLast ? " לפני יום החזרה." : " בסוף הטיול.")
      );
    }
    if (plan.grow < 0) {
      const lost = plan.losing.length;
      rest.push(
        `${nDays(-plan.grow)} יימחקו` +
          (lost ? ` — ${lost === 1 ? "אחד מהם כבר מתוכנן" : `${lost} מהם כבר מתוכננים`}, והתוכן שלהם יאבד.` : ".")
      );
    }
    note.innerHTML = `<b>${esc(head)}</b>` + (rest.length ? `<br>${esc(rest.join(" "))}` : "");
    note.className = "trip-edit__note" + (plan.losing.length ? " is-warn" : "");
  }

  function saveTripEdit(id) {
    const box = $(`[data-editor-trip="${CSS.escape(id)}"]`);
    const from = $("[data-te-from]", box).value;
    const count = Number($("[data-te-days]", box).value);
    const plan = TripStore.planReschedule(id, from, count);
    if (!plan) return;

    if (plan.losing.length) {
      const names = plan.losing
        .map((d) => `יום ${d.n}${d.title ? ` — ${d.title}` : ""}`)
        .join(", ");
      if (!confirm(`${names}\n\nהתוכן של הימים האלה יימחק. להמשיך?`)) return;
    }

    const doc = TripStore.reschedule(id, from, count);
    if (!doc) return;

    if (doc.id === TRIP.id) {
      TRIP = TripStore.active();
      renderTrip();
    }
    renderTripList();
  }

  $("#tripsBtn").addEventListener("click", openTrips);
  $("#tripsClose").addEventListener("click", closeTrips);
  overlay().addEventListener("click", (e) => { if (e.target === overlay()) closeTrips(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay().hidden) closeTrips();
  });

  $("#tripsList").addEventListener("input", (e) => {
    const box = e.target.closest("[data-editor-trip]");
    if (box) previewTripEdit(box.dataset.editorTrip);
  });

  $("#tripsList").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit-trip]");
    if (edit) { openTripEditor(edit.dataset.editTrip); return; }

    const box = e.target.closest("[data-editor-trip]");
    if (box) {
      if (e.target.closest("[data-te-cancel]")) { box.hidden = true; return; }
      if (e.target.closest("[data-te-save]")) { saveTripEdit(box.dataset.editorTrip); return; }
      return;                                   // קליק בתוך העורך אינו מחליף טיול
    }

    const go = e.target.closest("[data-trip]");
    if (go) { switchTrip(go.dataset.trip); return; }

    const del = e.target.closest("[data-del]");
    if (!del) return;
    const id = del.dataset.del;
    const doc = TripStore.list().find((t) => t.id === id);
    if (TripStore.list().length < 2) {
      alert("זה הטיול היחיד — אי אפשר למחוק אותו. צרו טיול נוסף קודם.");
      return;
    }
    if (!confirm(`למחוק את "${doc?.meta?.title || id}"? ההוצאות שנרשמו בו יימחקו גם הן.`)) return;
    try { localStorage.removeItem(`trip:${id}:v1`); } catch { /* לא קריטי */ }
    TripStore.remove(id);
    if (TripStore.activeId() && TripStore.activeId() !== TRIP.id) switchTrip(TripStore.activeId());
    renderTripList();
  });

  /* ------------------------------ האשף -------------------------------- */

  /** שדות השמות נגזרים מהבחירה "רק אנחנו" / "שני זוגות" */
  function renderWizNames() {
    const couples = Number($('input[name="wizWho"]:checked').value) || 1;
    const prev = $$("#wizNames input").map((i) => i.value);
    const slots = couples * 2;
    const def = ["גל", "נועה", "", ""];
    $("#wizNames").innerHTML = Array.from({ length: slots }, (_, i) => {
      const couple = Math.floor(i / 2) + 1;
      return `<label>נוסע/ת ${i + 1} ${couples > 1 ? `<span class="muted">(זוג ${couple})</span>` : ""}
        <input type="text" data-couple="${couple}" value="${esc(prev[i] ?? def[i] ?? "")}"
               placeholder="שם" autocomplete="off" />
      </label>`;
    }).join("");
  }

  function updateWizLen() {
    const from = $("#wizFrom").value, to = $("#wizTo").value;
    const n = from && to ? TripStore.dateRange(from, to).length : 0;
    $("#wizLen").textContent = n
      ? `${n} ימים · ${Math.max(n - 1, 0)} לילות`
      : "בחרו תאריכי יציאה וחזרה";
  }

  function openWizard() {
    $("#wizForm").reset();
    $("#wizErr").hidden = true;
    $("#wizFound").hidden = true;
    wizPlace = null;
    wizPlaceFor = "";
    wizLookup = null;
    const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    $("#wizFrom").value = soon;
    $("#wizTo").value = new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10);
    renderWizNames();
    updateWizLen();
    $("#tripsPicker").hidden = true;
    $("#tripsWizard").hidden = false;
    $("#wizWhere").focus();
  }

  /* היעד שאותר באשף. בלי קואורדינטות הטיול נוצר בלי מפה, בלי תחזית
     ובלי חגים — ולכן זה קורה כאן, לפני היצירה, ולא אחריה. */
  let wizPlace = null;
  let wizPlaceFor = "";
  let wizLookup = null;   // החיפוש שרץ כרגע, כדי לא לשלוח אותו פעמיים

  function lookupWhere() {
    wizLookup = (wizLookup || Promise.resolve()).then(runLookup, runLookup);
    return wizLookup;
  }

  async function runLookup() {
    const where = $("#wizWhere").value.trim();
    const out = $("#wizFound");
    if (where.length < 2) {
      wizPlace = null; wizPlaceFor = "";
      out.hidden = true;
      return;
    }
    if (wizPlaceFor === where) return;      // כבר אותר עבור הטקסט הזה

    out.hidden = false;
    out.textContent = "מאתר…";
    try {
      const res = await fetch(`/api/geo?q=${encodeURIComponent(where)}`);
      const data = await TripAPI.readJson(res);
      wizPlaceFor = where;
      if (data && data.found) {
        wizPlace = data.place;
        const parts = [data.place.name, data.place.admin, data.place.country].filter(Boolean);
        out.textContent = `📍 ${parts.join(", ")}`;
      } else {
        wizPlace = null;
        out.textContent = "לא מצאתי את היעד הזה. אפשר להמשיך — אבל בלי מפה ובלי תחזית.";
      }
    } catch {
      // בלי שרת אין איתור. זו אינה סיבה למנוע יצירת טיול.
      wizPlace = null; wizPlaceFor = "";
      out.textContent = "אין חיבור לשרת, ולכן היעד לא אותר. הטיול ייווצר בלי מפה.";
    }
  }

  $("#wizWhere").addEventListener("blur", lookupWhere);

  $("#newTripBtn").addEventListener("click", openWizard);
  $("#wizCancel").addEventListener("click", closeTrips);
  $("#wizBack").addEventListener("click", openTrips);
  $$('input[name="wizWho"]').forEach((r) => r.addEventListener("change", renderWizNames));
  $("#wizFrom").addEventListener("change", updateWizLen);
  $("#wizTo").addEventListener("change", updateWizLen);

  $("#wizForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#wizErr");
    const where = $("#wizWhere").value.trim();
    const from = $("#wizFrom").value;
    const to = $("#wizTo").value;

    const fail = (msg) => { err.textContent = msg; err.hidden = false; };

    if (!where) return fail("צריך יעד.");
    if (!from || !to) return fail("צריך תאריך יציאה ותאריך חזרה.");
    if (to < from) return fail("תאריך החזרה מוקדם מתאריך היציאה.");
    const dates = TripStore.dateRange(from, to);
    if (!dates.length) return fail("טווח התאריכים אינו תקין.");
    if (dates.length > 60) return fail("הטווח ארוך מ-60 ימים — בדקו את התאריכים.");

    const travellers = $$("#wizNames input")
      .map((i) => ({ name: i.value.trim(), couple: Number(i.dataset.couple) }))
      .filter((t) => t.name);
    if (!travellers.length) return fail("צריך לפחות נוסע אחד — ההוצאות נרשמות על שמות.");

    err.hidden = true;

    // מי שהקליד ולחץ מיד לא עבר דרך blur — מאתרים כאן לפני היצירה
    await lookupWhere();

    const doc = TripStore.create({
      title: $("#wizTitle").value.trim() || where,
      where,
      hotel: $("#wizHotel").value.trim(),
      from, to,
      currency: $("#wizCurrency").value,
      notes: $("#wizNotes").value.trim(),
      travellers,
      place: wizPlace,
    });

    TRIP = doc;
    state = load();
    // המטיילים שהוקלדו באשף הם אנשי ההוצאות של הטיול הזה
    state.people = doc.travellers.map((t) => ({ name: t.name, group: t.couple }));
    save();
    renderTrip();
    closeTrips();
    // נוחתים ישר על המסלול: שם ממלאים את הימים
    $("#tab-route").click();
  });

  /* --------------------------- עריכת יום ------------------------------ */

  function dayEditorHTML(day) {
    const planRows = (day.plan || [])
      .map((p, i) => `
        <div class="day-edit__row" data-plan="${i}">
          <input type="text" data-f="time" value="${esc(p.time || "")}" placeholder="שעה" />
          <input type="text" data-f="text" value="${esc(p.text || "")}" placeholder="מה עושים" />
          <button type="button" class="trip-row__del" data-rm="${i}" aria-label="מחיקת שורה">🗑️</button>
        </div>`)
      .join("");

    return `
      <label>כותרת היום <input type="text" data-d="title" value="${esc(day.title || "")}" /></label>
      <label>תיאור קצר <textarea data-d="summary" rows="2">${esc(day.summary || "")}</textarea></label>
      <label>לינה <input type="text" data-d="hotelName" value="${esc(day.hotel?.name || "")}"
             placeholder="שם המלון — ריק = אין לינה ביום הזה" /></label>
      <label>אזור הלינה <input type="text" data-d="hotelArea" value="${esc(day.hotel?.area || "")}" /></label>

      <div>
        <label style="margin-bottom:6px">לוח הזמנים</label>
        <div data-plans>${planRows}</div>
        <button type="button" class="btn btn--sm" data-addplan>➕ שורה</button>
      </div>

      <label>טיפים <span class="muted">(שורה לכל טיפ)</span>
        <textarea data-d="tips" rows="3">${esc((day.tips || []).join("\n"))}</textarea></label>

      <p class="hint">השינויים נשמרים לטיול הזה בלבד, ומסתנכרנים אם יש חיבור.</p>
      <div class="day-edit__actions">
        <button type="button" class="btn btn--sm" data-cancel>ביטול</button>
        <button type="button" class="btn btn--sm btn--primary" data-save="${day.n}">שמירה</button>
      </div>`;
  }

  function openDayEditor(n) {
    const day = TRIP.days.find((d) => d.n === Number(n));
    const box = $(`[data-editor="${n}"]`);
    if (!day || !box) return;
    if (!box.hidden) { box.hidden = true; return; }
    box.innerHTML = dayEditorHTML(day);
    box.hidden = false;
    $("input", box)?.focus();
  }

  function saveDayEditor(n) {
    const day = TRIP.days.find((d) => d.n === Number(n));
    const box = $(`[data-editor="${n}"]`);
    if (!day || !box) return;

    const val = (f) => $(`[data-d="${f}"]`, box)?.value.trim() ?? "";
    day.title = val("title");
    day.summary = val("summary");

    const hotelName = val("hotelName");
    if (hotelName) {
      day.hotel = { ...(day.hotel || { lat: 0, lng: 0 }), name: hotelName, area: val("hotelArea") };
    } else {
      delete day.hotel;
    }

    day.plan = $$("[data-plan]", box)
      .map((row) => ({
        time: $('[data-f="time"]', row).value.trim(),
        text: $('[data-f="text"]', row).value.trim(),
      }))
      .filter((p) => p.time || p.text);

    day.tips = val("tips").split("\n").map((t) => t.trim()).filter(Boolean);

    TripStore.save(TRIP);
    renderTrip();
  }

  $("#dayList").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) { e.stopPropagation(); openDayEditor(edit.dataset.edit); return; }

    const box = e.target.closest(".day-edit");
    if (!box) return;

    if (e.target.closest("[data-addplan]")) {
      const i = $$("[data-plan]", box).length;
      $("[data-plans]", box).insertAdjacentHTML("beforeend", `
        <div class="day-edit__row" data-plan="${i}">
          <input type="text" data-f="time" placeholder="שעה" />
          <input type="text" data-f="text" placeholder="מה עושים" />
          <button type="button" class="trip-row__del" data-rm="${i}" aria-label="מחיקת שורה">🗑️</button>
        </div>`);
      return;
    }
    const rm = e.target.closest("[data-rm]");
    if (rm) { rm.closest("[data-plan]").remove(); return; }
    if (e.target.closest("[data-cancel]")) { box.hidden = true; return; }
    const save = e.target.closest("[data-save]");
    if (save) saveDayEditor(save.dataset.save);
  });

  /* ==================================================================== */
  /*  אתחול                                                               */
  /* ==================================================================== */

  /* ==================================================================== */
  /*  סנכרון                                                              */
  /* ==================================================================== */

  const SYNC_UI = {
    synced:  { icon: "☁️", text: "מסונכרן",     cls: "is-synced" },
    syncing: { icon: "⏳", text: "שומר…",        cls: "is-syncing" },
    local:   { icon: "📱", text: "מקומי בלבד",  cls: "is-local" },
    error:   { icon: "⚠️", text: "שגיאת סנכרון", cls: "is-error" },
  };

  function renderSyncStatus(status, detail) {
    const ui = SYNC_UI[status] || SYNC_UI.local;
    const el = $("#syncStatus");
    el.className = "sync-status " + ui.cls;
    el.innerHTML =
      `<span>${ui.icon}</span><span>${ui.text}</span>` +
      (status === "local"
        ? `<small>ההוצאות נשמרות רק במכשיר הזה</small>`
        : status === "error"
        ? `<small>${esc(detail || "")}</small>`
        : "");
  }

  /**
   * מחבר לשרת ומאחד עם מה שכבר יש מקומית.
   * מקרה הקצה המעניין: יש הוצאות מקומיות מלפני המעבר לענן, והשרת ריק —
   * אז מציעים להעלות אותן במקום למחוק אותן בשקט.
   */
  async function initSync() {
    TripAPI.onStatusChange(renderSyncStatus);
    renderSyncStatus(TripAPI.status);

    const remote = await TripAPI.connect();
    if (!remote) return;   // מצב מקומי — הכול ממשיך כרגיל

    const localOnly = state.expenses.filter((e) => e.id && String(e.id).startsWith("local-"));
    const hadLocal = state.expenses.length > 0 && remote.expenses.length === 0;

    state.expenses = remote.expenses;
    state.people = remote.people.length ? remote.people : state.people;
    state.rates = { ...state.rates, ...remote.rates };

    // תכנון העלויות: השרת הוא מקור האמת. אם הוא ריק ויש עריכות מקומיות
    // מלפני המעבר, מעלים אותן פעם אחת כדי שלא ייעלמו — בלי לשאול, כי
    // אלה מספרים בלבד ואין כאן מה לאבד.
    const remoteCosts = remote.costOverrides || {};
    const localCosts = state.costOverrides || {};
    if (Object.keys(remoteCosts).length) {
      state.costOverrides = remoteCosts;
    } else if (Object.keys(localCosts).length) {
      TripAPI.saveCost(localCosts);
    }

    save();

    if (hadLocal) offerUpload();
    else if (localOnly.length) offerUpload();
  }

  let pendingUpload = null;

  function offerUpload() {
    // צילום של מה שהיה מקומי לפני שהחלפנו במצב מהשרת
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey()) || "{}");
      pendingUpload = Array.isArray(raw.expenses) ? raw.expenses : [];
    } catch { pendingUpload = []; }

    if (!pendingUpload.length) return;
    $("#uploadPrompt").hidden = false;
    $("#uploadCount").textContent = pendingUpload.length;
  }

  $("#uploadLocal").addEventListener("click", async () => {
    if (!pendingUpload?.length) return;
    const btn = $("#uploadLocal");
    btn.disabled = true;

    const items = pendingUpload.map((e) => ({
      date: e.date, amount: e.amount, currency: e.currency,
      category: e.category, payer: e.payer, note: e.note || "",
    }));

    const ok = await TripAPI.addExpenses(items);
    if (ok) {
      const fresh = await TripAPI.refresh();
      if (fresh) { state.expenses = fresh.expenses; save(); renderExpenses(); renderNow(); }
      $("#uploadPrompt").hidden = true;
      pendingUpload = null;
    } else {
      btn.disabled = false;
    }
  });

  $("#dismissUpload").addEventListener("click", () => {
    $("#uploadPrompt").hidden = true;
    pendingUpload = null;
  });

  /* ==================================================================== */
  /*  אתחול                                                               */
  /* ==================================================================== */

  function init() {
    // המאגר קודם: TRIP חייב להיות קיים לפני שאיזשהו רנדרר נוגע בו,
    // וגם לפני load() — מפתח האחסון המקומי נגזר ממזהה הטיול.
    TRIP = TripStore.init();
    if (!TRIP) {                       // אין אף טיול — פותחים ישר באשף
      applyTheme();
      openTrips();
      $("#newTripBtn").click();
      return;
    }
    state = load();

    applyTheme();
    bindJourney();
    setInterval(tickCountdown, 60_000);
    // חצי דקה: שעת עלייה למטוס היא רגע שרוצים לראות בלי לרענן
    setInterval(() => { renderNow(); renderClocks(); }, 30_000);
    $("#nowBox").addEventListener("input", (e) => {
      if (e.target.closest("[data-start-at]")) startPreview();
    });

    $("#nowBox").addEventListener("submit", (e) => {
      const form = e.target.closest("[data-now-more]");
      if (!form) return;
      e.preventDefault();
      const q = form.querySelector("input").value.trim();
      if (q) runAsk(q);
    });
    $("#nowBox").addEventListener("click", (e) => {
      if (e.target.closest("[data-now-bell]")) return askNotify();

      if (e.target.closest("[data-now-settings]")) {
        // ההגדרות יושבות בלשונית המידע; מכאן קופצים ישר אליהן
        selectTab($("#tab-info"));
        const card = document.querySelector(".card.watch");
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
        card?.classList.add("is-flash");
        setTimeout(() => card?.classList.remove("is-flash"), 1600);
        return;
      }

      const listBtn = e.target.closest("[data-found-list]");
      if (listBtn) {
        showFound = listBtn.dataset.foundList === "1";
        return renderNow();
      }

      const shut = e.target.closest("[data-found-close]");
      if (shut) {
        TripWatch.dismiss(shut.dataset.foundClose);
        renderWatch();
        return renderNow();
      }

      if (e.target.closest("[data-now-peek]")) {
        peeking = !peeking;
        return renderNow();
      }
      if (e.target.closest("[data-now-close]")) {
        answer = null;
        return renderNow();
      }

      const ask = e.target.closest("[data-now-ask]");
      if (ask) {
        const card = nowCard();
        if (card) runAsk(askPrompt(card));
        return;
      }

      const way = e.target.closest("[data-now-way]");
      if (way) {
        arriveWay = arriveWay === way.dataset.nowWay ? null : way.dataset.nowWay;
        return renderNow();
      }

      const pass = e.target.closest("[data-pass-leg]");
      if (pass) return BoardingPass.open({ leg: pass.dataset.passLeg });

      const startBtn = e.target.closest("[data-start-day]");
      if (startBtn) {
        const n = Number(startBtn.dataset.startDay);
        startEdit = startEdit === n ? null : n;
        return renderNow();
      }
      if (e.target.closest("[data-start-cancel]")) {
        startEdit = null;
        return renderNow();
      }
      if (e.target.closest("[data-start-save]")) {
        const day = TRIP.days.find((d) => d.n === startEdit);
        const to = MIN($("[data-start-at]", $("#nowBox")).value);
        if (day && to !== null) {
          const delta = shiftPlan(day, to);
          if (delta) {
            TRIP = TripStore.save(TRIP);
            renderTrip();
          }
        }
        startEdit = null;
        return renderNow();
      }

      if (e.target.closest("[data-add-exp]")) {
        // רישום הוצאה הוא פעולה של שתי שניות, ולכן הטופס נפתח מוכן:
        // התאריך של היום, והמיקוד בסכום
        selectTab($("#tab-expenses"));
        const date = $("#exDate");
        if (date) date.value = todayISO();
        setTimeout(() => $("#exAmount")?.focus(), 250);
        return;
      }

      // תחנה על חץ היום פותחת את אותו חלון שנפתח עליה במבט העל
      const stop = e.target.closest(".now__stop[data-ov-name]");
      if (stop) return openPop(stop);

      const day = e.target.closest("[data-ov-open]");
      if (day) return openDayModal(day.dataset.ovOpen);
    });

    // לפני renderTrip: הרינדור הראשון כבר קורא ל-FlightsView.render
    FlightsView.init({
      getTrip: () => TRIP,
      saveTrip: () => { TRIP = TripStore.save(TRIP); },
    });

    // כרטיס העלייה. הוא קורא את אותם מסמכים, ולכן די לו בגישה לטיול.
    BoardingPass.init({ getTrip: () => TRIP });

    // הייבוא מהמייל מוסר את מה שמצא לעוזר, ולכן אינו נוגע בטיול בעצמו
    MailImport.init({ getTrip: () => TRIP });

    /* חיפוש האוכל. הוא צריך לדעת איפה אנחנו — אותה תשובה שחץ היום
       מצייר — ולא שום דבר אחר מהמצב הפנימי. הכפתורים שפותחים אותו
       יושבים בקוביית "עכשיו" ובחלון התחנה, ששניהם מחוץ ללשונית עצמה,
       ולכן ההאזנה על המסמך כולו. */
    FoodFinder.init({
      getTrip: () => TRIP,
      tripId: () => TripStore.activeId(),
      openTab: (name) => selectTab($("#tab-" + name)),
      here: () => {
        const day = (TRIP?.days || []).find((d) => d.date === todayISO()) || null;
        let stop = null;
        let next = null;
        if (day) {
          const rail = railState(day);
          const now = rail.state.indexOf("now");
          const i = now >= 0 ? now : rail.at !== null && rail.at >= 0 ? Math.round(rail.at) : -1;
          if (i >= 0) stop = (day.points || []).indexOf(rail.pts[i]);

          /* התחנה הבאה, למסלול שמשלב אותה עם המסעדה. לפי המיקום עצמו ולא
             לפי הסימון: בין שתי תחנות הבאה היא זו שלפנינו, ובתחנה — זו
             שאחריה. שדה תעופה אינו יעד שהולכים אליו ברגל אחרי ארוחה. */
          if (rail.at !== null) {
            const from = rail.at < 0 ? 0 : Math.floor(rail.at) + 1;
            const q = rail.pts.slice(from).find(
              (x) => x.type !== "airport" && Number.isFinite(x.lat) && Number.isFinite(x.lng));
            if (q) next = { name: q.name, lat: q.lat, lng: q.lng };
          }
        }
        const fix = typeof DayRoute !== "undefined" && DayRoute.where ? DayRoute.where() : null;
        return { fix, day, stop, next };
      },
    });
    document.addEventListener("click", (e) => {
      const food = e.target.closest("[data-food-near]");
      if (!food) return;
      closePop();
      FoodFinder.open(food.dataset.foodNear);
    });

    // המרת מטבע. אותם שערים של הלשוניות, ולכן אין כאן מקור אמת שני.
    Converter.init({ getRates: () => state.rates, getTrip: () => TRIP });

    /*
     * מסך המסלול היומי.
     *
     * הוא מקבל **פונקציות** ולא נתונים: הטיול מתחלף (יצירה, ייבוא,
     * עריכה), והמסך צריך לראות את מה שיש עכשיו ולא תצלום משעת האתחול.
     */
    DayRoute.init({
      day: (n) => TRIP.days.find((d) => String(d.n) === String(n)) || null,
      stopMatch,
      inDest: inDestination,
      min: MIN,
      icon: (t) => TYPE_ICON[t] || "📍",
      label: (t) => TYPE_LABEL[t] || "",
      placeLink: placeMapsLink,
      tips: tipsForPoint,
      /** שורת מזג אוויר קצרה — מי שבחוץ כל היום צריך אותה על המסך */
      wx: (n) => {
        if (typeof LiveView === "undefined" || !LiveView.weatherFor) return null;
        const d = (LiveView.weatherFor() || []).find((x) => x.n === n);
        if (!d) return null;
        return {
          icon: d.icon || "🌤️",
          now: d.tNow === null || d.tNow === undefined ? "" : `${Math.round(d.tNow)}°`,
          span: d.tMax === null && d.tMin === null
            ? "" : `${Math.round(d.tMax ?? 0)}°/${Math.round(d.tMin ?? 0)}°`,
          text: d.text || "",
          rain: d.rainChance > 0 ? `💧${d.rainChance}%` : "",
        };
      },
      /**
       * הזזת השעות לשעה שבה באמת יצאנו.
       *
       * `from` היא השורה שממנה מזיזים — השורה של התחנה הראשונה במסלול,
       * ולא השורה הראשונה של היום. ביום טיסה זה ההבדל בין "הסיור זז
       * בחמש שעות" לבין "ההמראה זזה בחמש שעות".
       */
      shiftDay: (n, from, to) => {
        const day = TRIP.days.find((d) => String(d.n) === String(n));
        const a = MIN(from);
        const b = MIN(to);
        if (!day || a === null || b === null) return;
        if (shiftFrom(day, a, b)) {
          TRIP = TripStore.save(TRIP);
          renderTrip();
        }
      },
      /* סימון תחנה במסלול משנה גם את התרשים במבט העל — אותו מצב בדיוק
         מצויר בשני המסכים, ושניהם צריכים לדעת שהוא השתנה */
      changed: () => { renderNow(); paintScene(); },
    });

    /* הציור הראשון רץ לפני השורה הזו, וקרא ל-DayRoute.progress בזמן
       שהמודול עוד לא קיבל הקשר. עכשיו הוא קיבל — ציור שני מביא את
       הסימונים של "היינו שם". */
    paintScene();

    /*
     * כפתור "יוצאים למסלול" מופיע בשלושה מקומות — הקוביה, כרטיס היום
     * וחלון היום — ולכן מאזין אחד על המסמך, ולא שלושה שיתפצלו.
     */
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-route-day]");
      if (!b) return;
      if (!$("#dayOverlay").hidden) closeDayModal();
      DayRoute.open(Number(b.dataset.routeDay));
    });

    // בחירת יום בגרף ההוצאה היומית
    wireDaily();

    // ההצעה להתקין במסך הבית, לפי מה שהדפדפן הזה מאפשר
    InstallApp.init();

    // הליווי הפעיל: בודק ברקע לפי הרמה שנבחרה, ושותק כשאין מה לומר
    TripWatch.init({
      context: nowContext,
      onFound: () => { renderNow(); renderWatch(); },
    });
    renderWatch();

    $("#watchTopics").addEventListener("click", (e) => {
      const t = e.target.closest("[data-topic]");
      if (!t) return;
      TripWatch.toggleTopic(t.dataset.topic);
      renderWatch();
    });

    $("#watchLevels").addEventListener("click", (e) => {
      const b = e.target.closest("[data-watch]");
      if (!b) return;
      TripWatch.setLevel(b.dataset.watch);
      renderWatch();
      // רמה שמתחילה לצלצל דורשת רשות; מבקשים אותה כשבוחרים, לא אחר כך
      if (b.dataset.watch !== "off" && window.Notification && Notification.permission === "default") {
        Notification.requestPermission();
      }
    });

    $("#watchNow").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "בודק…";
      await TripWatch.check(true);
      btn.disabled = false;
      btn.textContent = "🔎 בדיקה עכשיו";
      renderWatch();
      renderNow();
    });

    // שכבת המידע החיצוני. היא מקבלת גישה לטיול, ללשוניות ולשערים —
    // ולא לשום משתנה פנימי אחר.
    LiveView.init({
      getTrip: () => TRIP,
      getRates: () => state.rates,
      openTab: (name) => selectTab($("#tab-" + name)),

      /**
       * מחיל יעד שאותר על טיול שנוצר בלי מיקום.
       *
       * רק ימים שאין בהם נקודה מקבלים אותה, ורק מלון בלי קואורדינטות
       * מקבל אותן — מסלול שכבר נבנה ביד לא נדרס.
       */
      applyPlace: (place) => {
        if (!place || !Number.isFinite(place.lat)) return;
        const r3 = (n) => Math.round(n * 1000) / 1000;

        TRIP.meta.countryCode = place.countryCode || TRIP.meta.countryCode || "";
        if (place.country && !(TRIP.meta.countries || []).length) {
          TRIP.meta.countries = [place.country];
        }
        if (!TRIP.meta.bbox) {
          TRIP.meta.bbox = {
            latMin: r3(place.lat - 1.2), latMax: r3(place.lat + 1.2),
            lngMin: r3(place.lng - 1.6), lngMax: r3(place.lng + 1.6),
          };
        }
        TRIP.days.forEach((d) => {
          if (!(d.points || []).length) {
            d.points = [{ name: place.name, lat: place.lat, lng: place.lng, type: "city" }];
          }
          if (d.hotel && !d.hotel.lat) { d.hotel.lat = place.lat; d.hotel.lng = place.lng; }
        });

        TRIP = TripStore.save(TRIP);
        renderTrip();
      },

      /** הנתונים החיצוניים חזרו — הצ'יפים של מזג האוויר יכולים להתמלא */
      onLive: () => paintJourneyWeather(),

      /** עדכון שערים מהשער החי, בלחיצה מפורשת ולא מאחורי הגב */
      applyRates: (rates) => {
        Object.entries(rates || {}).forEach(([sign, value]) => {
          if (Number.isFinite(value) && value > 0 && sign in state.rates) {
            state.rates[sign] = value;
          }
        });
        save();
        renderRates();
        renderExpenses();
        renderCostPlan();
        queueRateSync();
      },
    });

    renderTrip();

    /*
     * המלווה בשטח. הוא מקבל את היום הנוכחי ואת הדרך להודיע שנשמר דירוג,
     * ולא את המשתנים הפנימיים — בדיוק כמו שאר המודולים.
     */
    if (typeof TripGuide !== "undefined") {
      TripGuide.init({
        today: () => (TRIP.days || []).find((d) => d.date === todayISO()) || null,
        rated: () => { paintScene(); },
      });
    }

    // עוזר ה-AI מקבל גישה לטיול הפעיל ולשמירה, ולא למשתנים הפנימיים
    TripAI.init({
      getTrip: () => TRIP,

      /** הרשימות שמהן העוזר חייב לבחור כשהוא רושם הוצאה */
      getContext: () => ({
        today: todayISO(),
        people: state.people.map((p) => p.name),
        categories: CATEGORIES.map((c) => c.name),
        currencies: CURRENCIES,
        here: whereAmI(),
      }),

      onApply: (doc, { undo }) => {
        TRIP = TripStore.save(Object.assign(TRIP, doc));
        renderTrip();
        if (!undo) selectTab($("#tab-route"));
      },

      /**
       * שמירת המסמכים שצורפו לבקשה, עם הכותרת, הסוג והיום שהעוזר שייך להם.
       *
       * השמירה היא במכשיר בלבד ולכן היא נפרדת מהחלת השינוי: גם אם המסמך
       * לא הוליד שום שינוי במסלול, הוא נשמר — המשתמש העלה אותו כדי שיהיה
       * לו בטיול. המזהים חוזרים כדי שביטול יוכל להסיר אותם.
       */
      onDocs: async (plan) => {
        if (!(plan || []).length || !TripDocs.available()) return [];
        const ids = [];
        for (const d of plan) {
          try {
            const saved = await TripDocs.add(TRIP.id, {
              file: d.file,
              title: d.title,
              kind: d.kind,
              dayN: d.dayN,
              note: d.note,
              leg: d.leg,
              who: d.who,
            });
            ids.push(saved.id);
          } catch (err) {
            alert(err.message || "שמירת המסמך נכשלה.");
          }
        }
        await renderTripDocs();
        FlightsView.render();        // כרטיס טיסה מופיע גם בלשונית הטיסות
        return ids;
      },

      onDocsRemove: async (ids) => {
        await TripDocs.removeMany(ids);
        await renderTripDocs();
        FlightsView.render();
      },

      /**
       * רישום הוצאות דרך אותו צינור שהטופס הידני משתמש בו.
       * מחזיר את המזהים שנוצרו, כדי שביטול יוכל להסיר אותם.
       */
      onExpenses: async (rows, { focus = true } = {}) => {
        const ids = [];
        for (const r of rows) {
          const amount = Number(r.amount);
          if (!Number.isFinite(amount) || amount <= 0) continue;
          const expense = {
            date: TRIP.days.some((d) => d.date === r.date) ? r.date : TRIP.days[0].date,
            amount,
            currency: CURRENCIES.includes(r.currency) ? r.currency : CURRENCIES[0],
            category: CATEGORIES.some((c) => c.name === r.category) ? r.category : "אחר",
            payer: state.people.some((p) => p.name === r.payer) ? r.payer : state.people[0]?.name || "",
            note: String(r.note || "").trim(),
          };
          const saved = await TripAPI.addExpense(expense);
          const row = saved && saved.id ? saved : { ...expense, id: localId() };
          state.expenses.push(row);
          ids.push(row.id);
        }
        save();
        renderExpenses();
        if (focus) selectTab($("#tab-expenses"));
        return ids;
      },

      /** ביטול של הצעה שרשמה הוצאות — אותה מחיקה של כפתור המחיקה בטבלה */
      onExpensesRemove: async (ids) => {
        for (const id of ids || []) {
          try {
            await TripAPI.deleteExpense(id);
          } catch {
            /* נמחקה כבר, או שאין רשת — השורה המקומית יורדת בכל מקרה */
          }
          state.expenses = state.expenses.filter((x) => x.id !== id);
        }
        save();
        renderExpenses();
      },
    });

    // רץ אחרי הרינדור הראשון: הדף שמיש מיד, והסנכרון מתעדכן כשהוא חוזר
    Promise.allSettled([initSync(), TripStore.sync()]).then(([, trips]) => {
      // מסמך טיול שהגיע מהשרת מנצח רק אם הוא חדש יותר — TripStore כבר הכריע
      if (trips.status === "fulfilled" && trips.value) {
        TRIP = TripStore.active();
        renderTrip();
        return;
      }
      fillSelects();
      renderPeople();
      renderRates();
      renderExpenses();
      renderCostPlan();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
