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
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  const RANGES = [
    { key: "all", label: "כל הטיול" },
    { key: "week", label: "השבוע", days: 7 },
    { key: "next3", label: "3 ימים", days: 3 },
    { key: "today", label: "היום", days: 1 },
  ];
  const RANGE_KEY = "journey:range";
  let journeyRange = "all";

  const todayISO = () => new Date().toISOString().slice(0, 10);

  /** היום שממנו סופרים טווח: היום הנוכחי אם הטיול רץ, אחרת קצה הטיול */
  function anchorIndex() {
    const t = todayISO();
    const i = TRIP.days.findIndex((d) => d.date === t);
    if (i >= 0) return i;
    return TRIP.days[0] && t < TRIP.days[0].date ? 0 : Math.max(TRIP.days.length - 1, 0);
  }

  /** בתוך הטיול רוצים לראות את הימים הקרובים; לפניו ואחריו — את כולו */
  function defaultRange() {
    return TRIP.days.some((d) => d.date === todayISO()) ? "next3" : "all";
  }

  function visibleDays() {
    const r = RANGES.find((x) => x.key === journeyRange) || RANGES[0];
    if (!r.days) return TRIP.days;
    const from = anchorIndex();
    return TRIP.days.slice(from, from + r.days);
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
    const done = rows.filter((p) => p.time <= hhmm).length;
    return { done, total: rows.length, next: rows.find((p) => p.time > hhmm) || null };
  }

  /** סך ההוצאות שנרשמו בתאריך הזה, בשקלים */
  function dayMoney(day) {
    const rows = (state.expenses || []).filter((e) => e.date === day.date);
    if (!rows.length) return "";
    return `💸 ${ils2(rows.reduce((sum, e) => sum + toILS(e), 0))}`;
  }

  function journeyCard(day) {
    const status = dayStatus(day);
    const mode = TRIP.modes[day.mode] || {};
    const prog = status === "now" ? dayProgress(day) : null;

    const times = (day.plan || [])
      .map((p) => String(p.time || "").trim())
      .filter((t) => /^\d/.test(t));
    const span = times.length > 1 ? `${times[0]}–${times[times.length - 1]}` : times[0] || "";

    const facts = [
      `${mode.icon || ""} ${esc(mode.label || "")}`.trim(),
      day.drive?.km ? `${nfNum.format(day.drive.km)} ק"מ` : "",
      span ? `<span class="jd__time">${esc(span)}</span>` : "",
    ].filter(Boolean).join(" · ");

    const badge =
      status === "now"
        ? `<span class="jd__badge">היום${
            prog ? ` · ${prog.done} מתוך ${prog.total}` : ""
          }</span>`
        : status === "past"
        ? '<span class="jd__badge jd__badge--past">הסתיים</span>'
        : "";

    const nowLine =
      prog && prog.next
        ? `<p class="jd__now">הבא בתור — <b>${esc(prog.next.time)}</b> ${esc(prog.next.text)}</p>`
        : prog
        ? '<p class="jd__now">התוכנית של היום הושלמה.</p>'
        : "";

    const money = dayMoney(day);

    return `<article class="jd is-${status}" data-jd="${day.n}">
      <button class="jd__head" aria-expanded="false">
        <span class="jd__rail">
          <b>${day.n}</b>
          <i>${esc(day.dow || "")}</i>
          <small>${esc(day.date.slice(8))}.${esc(day.date.slice(5, 7))}</small>
        </span>
        <span class="jd__main">
          ${badge}
          <h3 class="jd__title">${esc(day.profile || day.title || "")}</h3>
          <span class="jd__facts">${facts}</span>
          <span class="jd__chips">
            <span class="jd__chip" data-jwx="${day.n}" hidden></span>
            ${day.hotel?.name ? `<span class="jd__chip">🛏️ ${esc(day.hotel.name)}</span>` : ""}
            <span class="jd__chip" data-jdocs="${day.n}" hidden></span>
            <span class="jd__chip" data-jmoney="${day.n}" ${money ? "" : "hidden"}>${money}</span>
          </span>
        </span>
        <span class="jd__chev" aria-hidden="true">⌄</span>
      </button>
      ${nowLine}
      <div class="jd__body">${dayBody(day, { full: false })}</div>
    </article>`;
  }

  /* ---------------------------------------------------------------------
     הרצועה — בר לכל יום, והנקודות שבו

     זו התמונה שנותנת את מבנה הטיול במבט אחד: עמודה לכל יום, ובתוכה
     הנקודות לפי סדר הביקור. לכל העמודות אותו גובה, לפי היום העמוס
     ביותר, ולכן גובה המילוי עצמו מעיד על עומס היום — יום עמוס ממלא
     את הבר, ויום פנוי משאיר אותו חצי ריק.

     מתחת לרצועה יושבים כרטיסי הימים עם הפירוט. לחיצה על עמודה פותחת
     את היום שלה שם.
     --------------------------------------------------------------------- */

  /** צבע לכל סוג נקודה. אותם טוקנים ששאר האפליקציה משתמשת בהם. */
  const OV_TONE = {
    airport: "rose", station: "rose",
    hotel: "heather",
    sight: "moss", town: "moss",
    food: "gold",
    hike: "sky", pass: "sky", car: "sky",
  };

  /** מעל זה העמודה נהיית בלתי קריאה, והשאר נספר ב-"ועוד" */
  const OV_MAX = 8;

  const ovShortDate = (iso) =>
    iso ? `${+iso.slice(8, 10)}.${+iso.slice(5, 7)}` : "";

  function renderOverview(days) {
    const track = $("#ovTrack");
    if (!track) return;

    const counts = days.map((d) => (d.points || []).filter((p) => p && p.name).length);
    const most = Math.min(Math.max(...counts, 1), OV_MAX);

    if (!counts.some(Boolean)) {
      track.innerHTML =
        '<p class="overview__empty">לטיול הזה עדיין אין נקודות על המפה. ' +
        'הוסיפו אותן בעריכת היום או דרך העוזר, והן יופיעו כאן.</p>';
      return;
    }

    track.innerHTML = days
      .map((day) => {
        const pts = (day.points || []).filter((p) => p && p.name);
        const shown = pts.slice(0, OV_MAX);
        const extra = pts.length - shown.length;
        const mode = TRIP.modes[day.mode] || {};

        const times = (day.plan || [])
          .map((p) => String(p.time || "").trim())
          .filter((t) => /^\d/.test(t));
        const span = times.length > 1 ? `${times[0]}–${times[times.length - 1]}` : times[0] || "";

        const segs = shown
          .map(
            (p, i) => `<button type="button" class="ov-seg ov-seg--${OV_TONE[p.type] || "mute"}"
                 data-ov-name="${esc(p.name)}" data-ov-type="${esc(p.type || "")}"
                 data-ov-day="${day.n}" data-ov-i="${i + 1}" data-ov-total="${pts.length}"
                 ${p.img ? `data-ov-img="${esc(p.img)}"` : ""}
                 title="${esc(p.name)}">
                 <span class="ov-seg__icon" aria-hidden="true">${TYPE_ICON[p.type] || "📍"}</span>
                 <span class="ov-seg__name">${esc(p.name)}</span>
               </button>`
          )
          .join("");

        const km = day.drive?.km
          ? `${mode.icon || "🚗"} ${nfNum.format(day.drive.km)} ק"מ`
          : `${mode.icon || ""} ${esc(mode.label || "")}`.trim();

        return `<article class="ov-day is-${dayStatus(day)}">
          <button type="button" class="ov-day__head" data-ov-open="${day.n}"
                  title="${esc(day.title || "")}">
            <b>יום ${day.n}</b>
            <span class="ov-day__when">
              <i class="ov-day__dow">${esc(day.dow || "")}</i>
              <i class="ov-day__date">${ovShortDate(day.date)}</i>
            </span>
            <span class="ov-day__profile">${esc(day.profile || day.title || "")}</span>
          </button>
          <div class="ov-bar" style="--ov-slots:${most}">
            ${segs}${extra > 0 ? `<span class="ov-seg ov-seg--more">+${extra}</span>` : ""}
          </div>
          <div class="ov-day__foot">
            <span>${km}</span>
            ${span ? `<span class="ov-day__time">${esc(span)}</span>` : ""}
          </div>
        </article>`;
      })
      .join("");
  }

  /** שם הסוג בעברית, למי שלא מזהה את האייקון */
  const TYPE_LABEL = {
    airport: "שדה תעופה", station: "תחנה", hotel: "לינה", sight: "אתר",
    hike: "מסלול הליכה", food: "אוכל", town: "עיירה", car: "רכב",
    pass: "מעבר הרים", city: "עיר",
  };

  /**
   * הנקודה שנבחרה ברצועה, ככרטיס ולא כשורת טקסט.
   *
   * ברצועה עצמה נשאר מקום לאייקון בלבד, ולכן מי שמקיש על נקודה צריך
   * לקבל כאן את כל מה שהיא: השם המלא, לאיזה יום היא שייכת ובאיזה שלב
   * בו, ואיך להגיע אליה על המפה.
   *
   * ה-thumbnail הוא תמונת המקום כשיש כזו (point.img), והאייקון של הסוג
   * כשאין. אין כאן קריאה לשום שירות חיצוני מהדפדפן.
   */
  function showPick(seg) {
    const box = $("#ovPick");
    if (!box) return;
    const d = seg.dataset;
    const icon = TYPE_ICON[d.ovType] || "📍";
    const label = TYPE_LABEL[d.ovType] || "נקודה";
    const tone = OV_TONE[d.ovType] || "mute";

    box.className = `ov-pick ov-pick--${tone}`;
    box.innerHTML = `
      <span class="ov-pick__thumb">${
        d.ovImg
          ? `<img src="${esc(d.ovImg)}" alt="" loading="lazy" />`
          : `<span aria-hidden="true">${icon}</span>`
      }</span>
      <span class="ov-pick__body">
        <b>${esc(d.ovName)}</b>
        <small>${esc(label)} · יום ${esc(d.ovDay)} · עצירה ${esc(d.ovI)} מתוך ${esc(d.ovTotal)}</small>
      </span>
      <button type="button" class="btn btn--sm" data-focus="${esc(d.ovDay)}">🗺️ על המפה</button>`;
    box.hidden = false;
    $("#ovHint").hidden = true;
  }

  function renderJourney() {
    const list = $("#journeyList");
    if (!list) return;

    const days = visibleDays();
    renderOverview(days);
    // הבחירה שייכת לרצועה שהייתה; רצועה חדשה מתחילה בלי נקודה נבחרת
    if ($("#ovPick")) { $("#ovPick").hidden = true; $("#ovHint").hidden = false; }
    list.innerHTML = days.map(journeyCard).join("");

    $("#journeyRange").innerHTML = RANGES.map(
      (r) =>
        `<button type="button" data-range="${r.key}" class="${
          r.key === journeyRange ? "is-on" : ""
        }" aria-pressed="${r.key === journeyRange}">${esc(r.label)}</button>`
    ).join("");

    const note = $("#journeyNote");
    const hidden = TRIP.days.length - days.length;
    note.hidden = !hidden;
    if (hidden) {
      note.innerHTML = `מוצגים ${days.length} מתוך ${TRIP.days.length} ימים.
        <button type="button" data-range="all">הצג את כל הטיול</button>`;
    }

    paintJourneyChips();
  }

  /** הצ'יפים שמגיעים ממקורות אסינכרוניים או משתנים תוך כדי */
  function paintJourneyChips() {
    (TRIP.days || []).forEach((day) => {
      const money = $(`[data-jmoney="${day.n}"]`);
      if (money) {
        const text = dayMoney(day);
        money.textContent = text;
        money.hidden = !text;
      }
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
      el.textContent = `${d.icon} ${temps}`.trim();
      el.title = `${d.text} ב${d.place}`;
      el.hidden = !temps;
    });
  }

  function bindJourney() {
    $("#journey").addEventListener("click", (e) => {
      const range = e.target.closest("[data-range]");
      if (range) {
        journeyRange = range.dataset.range;
        try { localStorage.setItem(RANGE_KEY, journeyRange); } catch { /* לא קריטי */ }
        renderJourney();
        return;
      }

      // עמודה ברצועה פותחת את כרטיס היום שמתחתיה
      const col = e.target.closest("[data-ov-open]");
      if (col) {
        const card = $(`.jd[data-jd="${col.dataset.ovOpen}"]`);
        if (!card) return;
        card.classList.add("is-open");
        $(".jd__head", card).setAttribute("aria-expanded", "true");
        card.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      // השם המלא אינו נכנס לסגמנט, ובטלפון גם אין ריחוף שיציג אותו
      const seg = e.target.closest("[data-ov-name]");
      if (seg) {
        $$("#ovTrack .ov-seg.is-on").forEach((el) => el.classList.remove("is-on"));
        seg.classList.add("is-on");
        showPick(seg);
        return;
      }

      // המפה והעריכה חיים בלשוניות שלהן — כאן רק קופצים אליהן
      const focus = e.target.closest("[data-focus]");
      if (focus) {
        selectTab($("#tab-map"));
        focusDay(focus.dataset.focus);
        return;
      }
      const route = e.target.closest("[data-open-route]");
      if (route) {
        selectTab($("#tab-route"));
        openDayCard(Number(route.dataset.openRoute));
        return;
      }

      const head = e.target.closest(".jd__head");
      if (!head) return;
      const card = head.closest(".jd");
      const open = card.classList.toggle("is-open");
      head.setAttribute("aria-expanded", String(open));
    });

    let stored = null;
    try { stored = localStorage.getItem(RANGE_KEY); } catch { /* לא קריטי */ }
    journeyRange = RANGES.some((r) => r.key === stored) ? stored : defaultRange();
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

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

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

  function gmapsLink(day) {
    const pts = (day.points || []).filter((p) => p.lat && p.lng);
    if (!pts.length) return null;
    const origin = pts[0];
    const dest = pts[pts.length - 1];
    const mid = pts.slice(1, -1).slice(0, 9);

    let url =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${origin.lat},${origin.lng}` +
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

  function downloadKML() {
    const blob = new Blob([buildKML()], {
      type: "application/vnd.google-earth.kml+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tbilisi-2026-route.kml";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // שחרור מיידי מדליף פחות מלהשאיר את ה-URL תלוי
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $("#kmlBtn").addEventListener("click", downloadKML);

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
      <div class="day__actions">
        <button class="btn btn--sm" data-focus="${day.n}">🗺️ הצג את היום על המפה</button>
        ${dirLink ? `<a class="btn btn--sm" target="_blank" rel="noopener" href="${dirLink}">🧭 ניווט ב-Google Maps</a>` : ""}
        ${full
          ? `<button class="btn btn--sm" data-edit="${day.n}">✏️ ערוך את היום</button>`
          : `<button class="btn btn--sm" data-open-route="${day.n}">✏️ ערוך במסלול היומי</button>`}
      </div>
      ${full ? `<div class="day-edit" data-editor="${day.n}" hidden></div>` : ""}`;
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

    // חלוקת הימים לשני עמודים נגזרת מהאורך, כדי שהוספת יום לא תדחוף לעמוד שלישי.
    // עמוד 2 נושא גם את טבלת הלינה ואת שתי התיבות, ולכן הוא מקבל פחות ימים.
    const split = Math.max(Math.ceil(days.length / 2), days.length - 5);
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

        <h2><bdi class="rng">המסלול — ימים 1–${split}</bdi></h2>
        <table>${DAY_TABLE_HEAD}<tbody>${dayRows(days.slice(0, split))}</tbody></table>

        <div class="psheet__foot"><span>עמוד 1 מתוך 2</span><span>${esc(m.subtitle)}</span></div>
      </section>

      <section class="psheet__page">
        <h2><bdi class="rng">המסלול — ימים ${split + 1}–${days.length}</bdi></h2>
        <table>${DAY_TABLE_HEAD}<tbody>${dayRows(days.slice(split))}</tbody></table>

        <h2>🛏️ לינה — ${nights} לילות</h2>
        <table><thead><tr><th>איפה</th><th>אזור</th><th>תאריכים</th><th>לילות</th><th>מחיר</th></tr></thead>
          <tbody>${stays}</tbody></table>

        <div class="psheet__cols">
          <div class="psheet__box">
            <h2>${esc(highlight?.icon || "ℹ️")} ${esc(highlight?.title || "")}</h2>
            <ul>${(highlight?.items || []).slice(0, 5).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
          </div>
          <div class="psheet__box">
            <h2>✅ להזמין מראש</h2>
            <ul>${(booking?.items || []).slice(0, 6).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
          </div>
        </div>

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
          <td data-label="סעיף"><i class="cat-dot" style="background:${catColor(e.category)}"></i>${esc(e.category)}</td>
          <td data-label="מי שילם">${esc(e.payer)}</td>
          <td class="num" data-label="סכום">${nfNum.format(e.amount)}</td>
          <td data-label="מטבע">${esc(e.currency)}</td>
          <td class="num" data-label="בש&quot;ח">${ils2(toILS(e))}</td>
          <td class="note" data-label="הערות">${esc(e.note) || "—"}</td>
          <td class="row-action"><button class="btn btn--sm btn--ghost btn--danger" data-del="${e.id}">✕ מחיקה</button></td>
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
    const byDate = {};
    state.expenses.forEach((e) => {
      if (e.date) byDate[e.date] = (byDate[e.date] || 0) + toILS(e);
    });
    const maxDay = Math.max(...Object.values(byDate), 1);

    $("#dailySpark").innerHTML = TRIP.days
      .map((d) => {
        const sum = byDate[d.date] || 0;
        return `
        <div class="spark__col" title="${fullDate(d.date)}: ${ils(sum)}">
          <div class="spark__bar" style="height:${Math.max((sum / maxDay) * 100, 2)}%"></div>
          <div class="spark__lbl">${d.n}</div>
        </div>`;
      })
      .join("");

    /* --- תקציב --- */
    renderBudget(t.total);

    // ההוצאות מופיעות גם כצ'יפ על היום במבט העל
    paintJourneyChips();
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
            <button class="trip-row__del" data-del="${esc(t.id)}" type="button"
                    title="מחיקת הטיול" aria-label="מחיקת הטיול">🗑️</button>
          </div>`;
      })
      .join("") || '<p class="muted" style="padding:8px 4px">אין עדיין טיולים. צרו את הראשון.</p>';
  }

  $("#tripsBtn").addEventListener("click", openTrips);
  $("#tripsClose").addEventListener("click", closeTrips);
  overlay().addEventListener("click", (e) => { if (e.target === overlay()) closeTrips(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay().hidden) closeTrips();
  });

  $("#tripsList").addEventListener("click", (e) => {
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
      if (fresh) { state.expenses = fresh.expenses; save(); renderExpenses(); }
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

    // לפני renderTrip: הרינדור הראשון כבר קורא ל-FlightsView.render
    FlightsView.init({
      getTrip: () => TRIP,
      saveTrip: () => { TRIP = TripStore.save(TRIP); },
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

    // עוזר ה-AI מקבל גישה לטיול הפעיל ולשמירה, ולא למשתנים הפנימיים
    TripAI.init({
      getTrip: () => TRIP,

      /** הרשימות שמהן העוזר חייב לבחור כשהוא רושם הוצאה */
      getContext: () => ({
        today: new Date().toISOString().slice(0, 10),
        people: state.people.map((p) => p.name),
        categories: CATEGORIES.map((c) => c.name),
        currencies: CURRENCIES,
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
