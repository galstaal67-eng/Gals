/* =========================================================================
   מאגר הטיולים — השכבה שהופכת את האתר מטיול אחד לאפליקציה.

   מודל: כל טיול הוא מסמך יחיד באותו מבנה שהרנדררים כבר יודעים לקרוא
   (meta / flights / modes / days / improvements / costPlan / practical / packing).
   כך אין שני מסלולי רינדור — טיול שנוצר באפליקציה וטיול שנכתב בקוד נראים
   לאפליקציה בדיוק אותו דבר.

   אחסון: localStorage הוא תמיד מקור האמת המקומי, וזה מה שמאפשר לאתר לעבוד
   מהדיסק ובלי רשת. כשפונקציות Netlify זמינות המסמכים מסונכרנים גם ל-Postgres,
   והמיזוג הוא "העדכני מנצח" לפי updatedAt.
   ========================================================================= */

const TripStore = (() => {
  const KEY = "trips:v1";
  const DOW = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

  /** מצב בזיכרון. docs הוא map של id → מסמך טיול. */
  let state = { docs: {}, activeId: null };
  let remoteOk = false;

  /* ------------------------------------------------------------------ */
  /*  עזרים                                                              */
  /* ------------------------------------------------------------------ */

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const todayISO = () => new Date().toISOString().slice(0, 10);

  /** מזהה יציב וקריא מתוך שם הטיול, עם סיומת אקראית נגד התנגשות */
  function makeId(title) {
    const base = String(title || "טיול")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}-]/gu, "")
      .slice(0, 40) || "trip";
    return `${base}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /** רשימת התאריכים בין שני ימים, כולל שניהם */
  function dateRange(from, to) {
    const out = [];
    const d = new Date(from + "T12:00:00Z");
    const end = new Date(to + "T12:00:00Z");
    if (isNaN(d) || isNaN(end) || end < d) return out;
    // תקרה של שנה — מגן מפני טווח שהוקלד הפוך או שגוי
    for (let i = 0; i < 366 && d <= end; i++) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }

  const dowOf = (iso) => DOW[new Date(iso + "T12:00:00Z").getUTCDay()];

  /* ------------------------------------------------------------------ */
  /*  בניית טיול חדש                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * בונה מסמך טיול מלא מתוך מה שהמשתמש מילא במסך הפתיחה.
   * כל יום מקבל כרטיס ריק עם תאריך ויום בשבוע — משם הוא נערך באפליקציה.
   *
   * spec: { title, where, from, to, currency, travellers:[{name,couple}], notes }
   */
  const round3 = (n) => Math.round(n * 1000) / 1000;

  function buildTrip(spec) {
    const dates = dateRange(spec.from, spec.to);
    const nights = Math.max(dates.length - 1, 0);

    // היעד שאותר (אם אותר) הוא מה שמפעיל את כל השכבה החיצונית: בלי
    // קואורדינטות אין תחזית, אין חגים, אין מפה ואין התרעות. לכן כל יום
    // מקבל נקודה אחת כברירת מחדל — מרכז היעד — שאפשר להחליף בעריכה.
    const place = spec.place && Number.isFinite(spec.place.lat) ? spec.place : null;
    const basePoint = place
      ? [{ name: place.name, lat: place.lat, lng: place.lng, type: "city" }]
      : [];

    const days = dates.map((date, i) => ({
      n: i + 1,
      date,
      dow: dowOf(date),
      title: i === 0 ? "הגעה" : i === dates.length - 1 ? "חזרה" : "",
      region: place ? place.name : spec.where || spec.title,
      mode: i === 0 || i === dates.length - 1 ? "flight" : "city",
      summary: "",
      drive: { km: 0, hours: 0, note: "" },
      plan: [],
      tips: [],
      points: basePoint.map((p) => ({ ...p })),
      path: [],
      pathMode: i === 0 || i === dates.length - 1 ? "flight" : "city",
      // ימי אמצע מקבלים את הלינה כברירת מחדל; יום החזרה לא
      ...(i < dates.length - 1 && spec.hotel
        ? {
            hotel: {
              name: spec.hotel,
              area: spec.where || "",
              lat: place ? place.lat : 0,
              lng: place ? place.lng : 0,
            },
          }
        : {}),
    }));

    return {
      id: makeId(spec.title || spec.where),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currency: spec.currency || "€",
      travellers: (spec.travellers || []).map((t, i) => ({
        name: t.name,
        couple: Number(t.couple) || 1,
        order: i + 1,
      })),
      meta: {
        title: spec.title || spec.where || "טיול חדש",
        subtitle: `${dates.length} ימים · ${spec.where || ""}`.trim(),
        startDate: `${spec.from}T00:00:00+02:00`,
        endDate: `${spec.to}T23:59:59+02:00`,
        travellers: (spec.travellers || []).length > 2 ? "שני זוגות" : "זוג",
        totalDrivingKm: 0,
        countries: place?.country ? [place.country] : spec.where ? [spec.where] : [],
        countryCode: place?.countryCode || "",
        // תיחום נדיב סביב היעד: מכסה טיולי יום לכל כיוון, ומשמש גם
        // למפה וגם לחיפוש רעידות אדמה באזור
        bbox: place
          ? {
              latMin: round3(place.lat - 1.2),
              latMax: round3(place.lat + 1.2),
              lngMin: round3(place.lng - 1.6),
              lngMax: round3(place.lng + 1.6),
            }
          : null,
        emergency: "חירום 112",
      },
      flights: {
        carrier: "",
        fare: "",
        status: "טרם הוזן",
        out:  { date: spec.from, dow: dowOf(spec.from), from: "", dep: "", via: "ישיר", layover: "—", to: spec.where || "", arr: "" },
        back: { date: spec.to,   dow: dowOf(spec.to),   from: spec.where || "", dep: "", via: "ישיר", layover: "—", to: "", arr: "" },
      },
      modes: {
        flight: { label: "טיסה",  color: "#e06c9f", dash: "10 8", weight: 3, icon: "✈️" },
        drive:  { label: "נסיעה", color: "#4cc9a4", dash: null,   weight: 5, icon: "🚗" },
        train:  { label: "רכבת",  color: "#b088f9", dash: "6 6",  weight: 4, icon: "🚂" },
        hike:   { label: "הליכה", color: "#f2784b", dash: "2 8",  weight: 5, icon: "🥾" },
        city:   { label: "עירוני", color: "#8ab4f8", dash: "2 6", weight: 4, icon: "🚶" },
      },
      days,
      improvements: [],
      costPlan: {
        note: `אומדנים לתכנון, ל${(spec.travellers || []).length > 2 ? "שני זוגות" : "זוג"}. ` +
              "כל שורה ניתנת לעריכה — החליפו אומדן במחיר האמיתי ברגע שהזמנתם.",
        groups: [
          { key: "flights", title: "טיסות", icon: "✈️", core: true, items: [
            { label: "טיסות הלוך ושוב", detail: "", currency: spec.currency || "€", low: 0, high: 0 } ] },
          { key: "hotel", title: "לינה", icon: "🛏️", core: true, items: [
            { label: `לינה — ${nights} לילות`, detail: "", currency: spec.currency || "€", low: 0, high: 0 } ] },
          { key: "transport", title: "תחבורה", icon: "🚕", core: true, items: [
            { label: "העברות ותחבורה מקומית", detail: "", currency: spec.currency || "€", low: 0, high: 0 } ] },
          { key: "activities", title: "אתרים וחוויות", icon: "🎟️", core: true, items: [
            { label: "כניסות, סיורים ומזכרות", detail: "", currency: spec.currency || "€", low: 0, high: 0 } ] },
          { key: "food", title: "אוכל ושתייה", icon: "🍽️", core: false, items: [
            { label: `אוכל — ${dates.length} ימים`, detail: "", currency: spec.currency || "€", low: 0, high: 0 } ] },
        ],
      },
      practical: [
        { icon: "📋", title: "להזמין ולסדר לפני הנסיעה",
          items: spec.notes ? [spec.notes] : ["הוסיפו כאן מה שצריך לסגור מראש."] },
      ],
      packing: [
        { group: "מסמכים", items: ["דרכון בתוקף 6 חודשים+", "ביטוח נסיעות + מספר חירום", "אישורי טיסה ולינה"] },
        { group: "ביגוד", items: [] },
      ],
    };
  }

  /* ------------------------------------------------------------------ */
  /*  אחסון מקומי                                                        */
  /* ------------------------------------------------------------------ */

  function loadLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && raw.docs) return raw;
    } catch { /* אחסון פגום — נופלים לזרעים */ }
    return null;
  }

  function saveLocal() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch { /* מכסת אחסון או מצב פרטי — האפליקציה ממשיכה בזיכרון */ }
  }

  /** זורע מהקוד כל טיול מובנה שעדיין אינו באחסון */
  function seed() {
    const seeds = typeof SEED_TRIPS !== "undefined" ? SEED_TRIPS : [];
    seeds.forEach((t) => {
      if (!state.docs[t.id]) {
        const doc = clone(t);
        doc.createdAt = doc.createdAt || new Date().toISOString();
        doc.updatedAt = doc.updatedAt || new Date().toISOString();
        doc.seeded = true;
        state.docs[t.id] = doc;
      }
    });
    if (!state.activeId || !state.docs[state.activeId]) {
      state.activeId = seeds[0]?.id || Object.keys(state.docs)[0] || null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  סנכרון מול השרת                                                    */
  /* ------------------------------------------------------------------ */

  async function pullRemote() {
    try {
      const res = await fetch("/api/trips", { headers: { Accept: "application/json" } });
      if (!res.ok) return false;
      const rows = await res.json();
      if (!Array.isArray(rows)) return false;
      rows.forEach((row) => {
        const local = state.docs[row.id];
        // "העדכני מנצח": מסמך מהשרת גובר רק אם הוא חדש מהמקומי
        if (!local || (row.updatedAt || "") > (local.updatedAt || "")) {
          state.docs[row.id] = row.doc ? { ...row.doc, id: row.id, updatedAt: row.updatedAt } : local;
        }
      });
      remoteOk = true;
      saveLocal();
      return true;
    } catch {
      return false;
    }
  }

  async function pushRemote(doc) {
    if (!remoteOk) return;
    try {
      await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.id, updatedAt: doc.updatedAt, doc }),
      });
    } catch { /* נשאר מקומי; הדחיפה הבאה תתפוס */ }
  }

  async function deleteRemote(id) {
    if (!remoteOk) return;
    try {
      await fetch("/api/trips?id=" + encodeURIComponent(id), { method: "DELETE" });
    } catch { /* נשאר מקומי */ }
  }

  /* ------------------------------------------------------------------ */
  /*  שינוי תאריכים ומספר ימים של טיול קיים                               */
  /* ------------------------------------------------------------------ */

  /** תאריך + n ימים, ב-UTC כדי שמעבר שעון לא יזיז יום */
  function addDays(iso, n) {
    const d = new Date(iso + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /** האם היום האחרון הוא יום חזרה — מה שקובע איפה מוסיפים או מורידים */
  function looksLikeReturn(day) {
    if (!day) return false;
    return day.mode === "flight" || day.pathMode === "flight" || /חזר/.test(day.title || "");
  }

  /** האם ביום הזה יש תוכן שאובד אם הוא נמחק */
  function hasContent(day) {
    return Boolean(
      (day.plan || []).length ||
      (day.tips || []).length ||
      (day.summary || "").trim() ||
      (day.title || "").trim() ||
      (day.points || []).length > 1
    );
  }

  /** יום ריק, מעוצב לפי יום קיים כדי שהאזור והלינה יישמרו */
  function blankDay(doc, date, n) {
    const days = doc.days || [];
    // יום האמצע האחרון הוא המודל, ולא האחרון בפועל — האחרון הוא בדרך
    // כלל יום חזרה, וכל יום חדש שהיה מועתק ממנו היה נולד כיום טיסה
    const model = days[Math.max(days.length - 2, 0)] || {};
    return {
      n,
      date,
      dow: dowOf(date),
      title: "",
      region: model.region || "",
      mode: "city",
      summary: "",
      drive: { km: 0, hours: 0, note: "" },
      plan: [],
      tips: [],
      points: (model.points || []).slice(0, 1).map((pt) => ({ ...pt })),
      path: [],
      pathMode: "city",
      ...(model.hotel ? { hotel: { ...model.hotel } } : {}),
    };
  }

  /**
   * מה ייקרה אם נשנה את הטיול לתאריך התחלה ולמספר ימים נתונים.
   * מחזיר תיאור בלבד — לא נוגע בשום דבר. זה מה שמאפשר להציג את
   * ההשלכות **לפני** שמאשרים, כמו בכל שאר השינויים באפליקציה.
   */
  function planReschedule(doc, from, count) {
    const days = doc.days || [];
    const keepLast = looksLikeReturn(days[days.length - 1]);
    const grow = count - days.length;

    let dropped = [];
    if (grow < 0) {
      // מורידים מהסוף, אבל יום החזרה נשאר אחרון
      dropped = keepLast
        ? days.slice(count - 1, days.length - 1)
        : days.slice(count);
    }

    return {
      from,
      to: addDays(from, count - 1),
      count,
      grow,
      keepLast,
      dropped,
      losing: dropped.filter(hasContent),
      shifted: (days[0]?.date || from) !== from,
    };
  }

  /**
   * מחיל את השינוי. הימים הקיימים שומרים על התוכן שלהם ומקבלים תאריכים
   * חדשים; ימים חדשים נולדים ריקים לפני יום החזרה, וימים שיורדים נמחקים
   * מהאמצע ולא מהקצה — כך שיום החזרה נשאר יום חזרה.
   */
  function applyReschedule(doc, from, count) {
    const plan = planReschedule(doc, from, count);
    const days = doc.days || [];
    const oldFrom = days[0]?.date || from;

    let kept;
    if (plan.grow > 0) {
      const head = plan.keepLast ? days.slice(0, -1) : days;
      const tail = plan.keepLast ? days.slice(-1) : [];
      kept = [...head, ...Array.from({ length: plan.grow }, () => null), ...tail];
    } else if (plan.grow < 0) {
      kept = plan.keepLast
        ? [...days.slice(0, count - 1), days[days.length - 1]]
        : days.slice(0, count);
    } else {
      kept = days.slice();
    }

    doc.days = kept.map((day, i) => {
      const date = addDays(from, i);
      return day
        ? { ...day, n: i + 1, date, dow: dowOf(date) }
        : blankDay(doc, date, i + 1);
    });

    // הטיסות נעות עם הקצוות שלהן, אם הן ישבו עליהם
    const f = doc.flights;
    if (f?.out?.date === oldFrom) {
      f.out.date = plan.from;
      f.out.dow = dowOf(plan.from);
    }
    const oldTo = days[days.length - 1]?.date;
    if (f?.back?.date === oldTo) {
      f.back.date = plan.to;
      f.back.dow = dowOf(plan.to);
    }

    doc.meta = doc.meta || {};
    doc.meta.startDate = `${plan.from}T00:00:00+02:00`;
    doc.meta.endDate = `${plan.to}T23:59:59+02:00`;
    // כותרת המשנה פותחת לא פעם ב-"6 ימים"; אחרי שינוי אורך היא משקרת
    if (typeof doc.meta.subtitle === "string") {
      doc.meta.subtitle = doc.meta.subtitle.replace(/^\d+\s+ימים/, `${count} ימים`);
    }
    return doc;
  }

  /* ------------------------------------------------------------------ */
  /*  ה-API הציבורי                                                      */
  /* ------------------------------------------------------------------ */

  return {
    /** טוען מהאחסון, זורע מה שחסר, ומחזיר את הטיול הפעיל */
    init() {
      state = loadLocal() || { docs: {}, activeId: null };
      seed();
      saveLocal();
      return this.active();
    },

    /** משיכה מהשרת אחרי הרינדור הראשון. מחזיר true אם משהו השתנה. */
    async sync() {
      const before = JSON.stringify(state.docs[state.activeId] || null);
      const ok = await pullRemote();
      if (!ok) return false;
      // דוחפים החוצה כל מסמך שהשרת לא מכיר או מכיר ישן יותר
      Object.values(state.docs).forEach((d) => pushRemote(d));
      return JSON.stringify(state.docs[state.activeId] || null) !== before;
    },

    isRemote: () => remoteOk,

    list() {
      return Object.values(state.docs).sort(
        (a, b) => (b.meta?.startDate || "").localeCompare(a.meta?.startDate || "")
      );
    },

    active: () => state.docs[state.activeId] || null,
    activeId: () => state.activeId,

    setActive(id) {
      if (!state.docs[id]) return null;
      state.activeId = id;
      saveLocal();
      return this.active();
    },

    /** יוצר טיול מהמפרט של מסך הפתיחה, הופך אותו לפעיל ומחזיר אותו */
    create(spec) {
      const doc = buildTrip(spec);
      state.docs[doc.id] = doc;
      state.activeId = doc.id;
      saveLocal();
      pushRemote(doc);
      return doc;
    },

    /** שומר שינוי במסמך הפעיל (או באחר לפי id) ומסמן אותו כמעודכן */
    save(doc) {
      const d = doc || this.active();
      if (!d) return null;
      d.updatedAt = new Date().toISOString();
      state.docs[d.id] = d;
      saveLocal();
      pushRemote(d);
      return d;
    },

    remove(id) {
      if (!state.docs[id]) return false;
      delete state.docs[id];
      if (state.activeId === id) state.activeId = Object.keys(state.docs)[0] || null;
      saveLocal();
      deleteRemote(id);
      return true;
    },

    /** משוכפל לטיול חדש — שימושי כדי לחזור על מסלול מוצלח בתאריכים אחרים */
    duplicate(id, newTitle) {
      const src = state.docs[id];
      if (!src) return null;
      const doc = clone(src);
      doc.id = makeId(newTitle || src.meta.title);
      doc.meta = { ...doc.meta, title: newTitle || src.meta.title + " (עותק)" };
      doc.seeded = false;
      doc.createdAt = doc.updatedAt = new Date().toISOString();
      state.docs[doc.id] = doc;
      state.activeId = doc.id;
      saveLocal();
      pushRemote(doc);
      return doc;
    },

    /** מה ישתנה אם נזיז את הטיול — בלי לשנות דבר */
    planReschedule(id, from, count) {
      const doc = state.docs[id];
      if (!doc || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
      const n = Math.max(1, Math.min(Number(count) || 0, 60));
      return planReschedule(doc, from, n);
    },

    /** מזיז את הטיול ושומר. מחזיר את המסמך המעודכן. */
    reschedule(id, from, count) {
      const doc = state.docs[id];
      if (!doc || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
      const n = Math.max(1, Math.min(Number(count) || 0, 60));
      applyReschedule(doc, from, n);
      return this.save(doc);
    },

    // נחשפים לבדיקות ולשימוש חוזר מתוך האפליקציה
    buildTrip,
    dateRange,
    dowOf,
  };
})();
