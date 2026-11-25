/* =====================================================================
   DayScene — התרשים הציורי של יום אחד

   מבט העל היה עמודה של קוביות לכל יום. קוביות הן רשימה, וכל הימים
   נראו בהן אותו דבר: יום הליכה בעיר העתיקה, יום נסיעה בכביש הררי ויום
   טיסה היו שלוש עמודות של מלבנים אפורים שנבדלו זה מזה רק בטקסט.

   כאן היום **מצויר**: מסלול מתפתל שעובר בין התחנות, על רקע שמתאים
   לאופי היום — ריצוף אבן ובתים ישנים ליום בעיר העתיקה, כביש אספלט
   והרים ליום נסיעה, שביל עפר ושדות ליום טיול, שמיים ליום טיסה — וכל
   תחנה נושאת סמל לפי מה שהיא: מנזר, גשר, מוזיאון, שוק, מרחץ.

   ── שתי החלטות ──
   **ה-SVG נושא מבנה, ה-CSS נושא צבע.** אף אלמנט כאן אינו נושא fill או
   stroke משלו; כולם נושאים מחלקה, והצבעים חיים ב-styles.css. כך אותו
   תרשים בדיוק עובד במצב כהה ובמצב בהיר, והחלפת הנושא אינה דורשת
   ציור מחדש.

   **הסמל נגזר מהשם, לא רק מהסוג.** ב-data.js רוב התחנות הן "sight",
   ו-sight אחד הוא קתדרלה ואחר הוא שוק פשפשים. טבלת מילות המפתח
   למטה היא מה שמבדיל ביניהן; הסוג הוא רק נפילה אחורה.
   ===================================================================== */

const DayScene = (() => {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  הסמלים — כל אחד מצויר בתיבה 24×24                                 */
  /* ------------------------------------------------------------------ */
  /* קו ולא מילוי: בקוטר 24 פיקסלים מילוי נהיה כתם, וקו נשאר צורה.
     המחלקה sc-g נותנת את העובי, את העיגול בקצוות ואת הצבע. */

  const G = {
    monastery:
      '<path d="M4 21h16M6.5 21v-7M17.5 21v-7M6.5 14a5.5 5.5 0 0 1 11 0M12 8.5V4M10 5.8h4"/>' +
      '<path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
    castle:
      '<path d="M3 21h18M4.5 21V9M19.5 21V9M4.5 9V6h3v2.2h3V6h3v2.2h3V6h3v3H4.5"/>' +
      '<path d="M9.5 21v-5a2.5 2.5 0 0 1 5 0v5"/>',
    bridge:
      '<path d="M1.5 15.5h21M6 15.5V4.2M18 15.5V4.2M6 4.2q6 9.4 12 0"/>' +
      '<path d="M9.4 15.5V9.6M12 15.5V7.6M14.6 15.5V9.6M1.5 20.2h21"/>',
    museum:
      '<path d="M2 10.2 12 4l10 6.2M3.5 10.2h17M3 19.5h18M2 21.5h20"/>' +
      '<path d="M6.5 19.5v-8.5M10 19.5v-8.5M14 19.5v-8.5M17.5 19.5v-8.5"/>',
    theatre:
      '<path d="M3 4h18v3H3zM5 7v8a7 7 0 0 0 14 0V7"/>' +
      '<path d="M9 11.5v1.5M15 11.5V13M9.5 16.5a3.5 3.5 0 0 0 5 0"/>',
    market:
      '<path d="M2.5 10.5h19V6h-19zM7 10.5V6M12 10.5V6M17 10.5V6"/>' +
      '<path d="M4.5 10.5v10M19.5 10.5v10M2.5 20.5h19"/>' +
      '<path d="M7.5 20.5v-4h4v4M13 20.5v-2.5h4v2.5"/>',
    food:
      '<path d="M7 2.5v5a2 2 0 0 0 4 0v-5M9 7.5v14"/>' +
      '<path d="M16.5 2.5c1.8 1 1.8 6.5 0 6.5s-1.8-5.5 0-6.5zM16.5 9v12.5"/>',
    wine:
      '<path d="M7.5 3h9l-1.2 6.5a3.4 3.4 0 0 1-6.6 0zM12 15.5v5.5M8.5 21h7M8 7h8"/>',
    bath:
      '<path d="M3 21.2h18M5.5 21.2v-5.3a6.5 6.5 0 0 1 13 0v5.3M5.8 14.4h12.4"/>' +
      '<path d="M12 11.5a1.5 1.5 0 1 0 0.01 0M8.4 7.4c0-2 1.8-2 1.8-3.9M15.6 7.4c0-2 1.8-2 1.8-3.9"/>',
    cable:
      '<path d="M2 4.5 22 9M12 7v3.5"/>' +
      '<path d="M7.5 10.5h9v7h-9zM7.5 14h9M12 10.5v7"/>',
    view:
      '<path d="M4 9.5h5v9.5a2.5 2.5 0 0 1-5 0zM15 9.5h5V19a2.5 2.5 0 0 1-5 0z"/>' +
      '<path d="M9 13h6M5 9.5V5.5h3v4M16 9.5v-4h3v4"/>',
    park:
      '<path d="M12 2.6a4.1 4.1 0 0 1 3.7 2.3 3.8 3.8 0 0 1 2.6 5.8 4.1 4.1 0 0 1-4.3 4h-4a4.1 4.1 0 0 1-4.3-4 3.8 3.8 0 0 1 2.6-5.8A4.1 4.1 0 0 1 12 2.6z"/>' +
      '<path d="M12 14.7v6.8M8.5 21.5h7M12 17.9 9.2 15.4M12 18.8l2.9-2.7"/>',
    statue:
      '<path d="M7.5 21.5h9M9 21.5v-2.5h6v2.5M11 19V9M13 19V9"/>' +
      '<path d="M12 8.5a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6zM9 11l3-1.6L15 11"/>',
    cave:
      '<path d="M2 21h20M2.5 21v-6.5a9.5 9.5 0 0 1 19 0V21"/>' +
      '<path d="M8.5 21v-4.5a3.5 3.5 0 0 1 7 0V21M6 11.5h0.01M18 11.5h0.01"/>',
    mountain:
      '<path d="M1.5 20.5h21M2.5 20.5 9 9.5l3.5 5.5L16 10l6 10.5z"/>' +
      '<path d="M6.8 14.2 9 10.4l2.1 3.4zM14.2 13.3 16 10.3l1.9 3.2z"/>',
    water:
      '<path d="M2.5 7.5q3.2-2.4 6.4 0t6.4 0 6.2 0M2.5 13q3.2-2.4 6.4 0t6.4 0 6.2 0M2.5 18.5q3.2-2.4 6.4 0t6.4 0 6.2 0"/>',
    factory:
      '<path d="M2 21.5h20M3.5 21.5V11l5 3V11l5 3V7.5h7v14"/>' +
      '<path d="M17 7.5V3.5h2.5v4M16.5 17.5h3"/>',
    train:
      '<path d="M6 2.5h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM4 9h16"/>' +
      '<path d="M7.5 12.3h0.01M16.5 12.3h0.01M8 15.5l-2.5 6M16 15.5l2.5 6M7 19.5h10"/>',
    airport:
      '<path d="M21.5 2.5 3 9.5l7 3 3 7zM10 12.5 21.5 2.5"/>',
    hotel:
      '<path d="M2.5 20.5V8M2.5 13.5h18a3 3 0 0 0-3-3h-7v3M21.5 13.5v7M2.5 17h19"/>' +
      '<path d="M6.5 10.5a2 2 0 1 0 0-0.01"/>',
    hike:
      '<path d="M13.5 5.5a2 2 0 1 0 0-0.01M13.5 7.5v5.5M13.5 9.5 10 11.5M13.5 9.5l4 1"/>' +
      '<path d="m13.5 13-3.2 3.8L9 21.5M13.5 13l2.8 3 1.2 5.5M18 8.5v13"/>',
    city:
      '<path d="M2 21.5h20M4 21.5V9h5.5v12.5M9.5 21.5V4.5h6v17M15.5 21.5V12H20v9.5"/>' +
      '<path d="M6 12h1.5M6 15.5h1.5M11.5 8h2.5M11.5 12h2.5M11.5 16h2.5"/>',
    pin:
      '<path d="M12 22s7-7.6 7-12.2A7 7 0 1 0 5 9.8C5 14.4 12 22 12 22z"/>' +
      '<path d="M12 12.3a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z"/>',
    info:
      '<path d="M12 10.5v7M12 6.6h0.01"/>',
  };

  /* ------------------------------------------------------------------ */
  /*  מה כל תחנה                                                        */
  /* ------------------------------------------------------------------ */
  /**
   * הסדר כאן הוא הכרעה, לא נוחות: "שוק הגשר היבש" מכיל גם "שוק" וגם
   * "גשר", והוא שוק. מי שבא ראשון בטבלה מנצח.
   */
  const KEYS = [
    [/שוק|בזאר|פשפש/, "market"],
    [/רכבל|פוניקולר/, "cable"],
    [/מרחץ|מרחצאות|גופרית|אבנוטובני/, "bath"],
    [/מנזר|כנסיי|כנסיית|כנסייה|קתדרל|מקדש|סיוני|מטחי|ג'ברי|ג׳ברי|סבטיצחובלי|גרגטי|ג'וארי/, "monastery"],
    [/מצודה|מצודת|טירה|חומות|נריקלה/, "castle"],
    [/גשר/, "bridge"],
    [/מוזיאון|גלריה|אתנוגרפ/, "museum"],
    [/תיאטרון|אופרה|קונצרט/, "theatre"],
    [/פסל|אנדרט|כרוניקה|דדה|קרטליס|עמוד/, "statue"],
    [/מערה|אופליסציחה|עיר הסלע|סלע/, "cave"],
    [/מפל|אגם|נהר|מתקוורי|ים /, "water"],
    [/פבריקה|מפעל|בית חרושת/, "factory"],
    [/יקב|יין/, "wine"],
    [/מסעד|ארוחה|צהריים|ארוחת|קפה|מאפ|פאב/, "food"],
    [/פארק|גן |גנים|שדרות|טיילת|בוטני/, "park"],
    [/תחנת רכבת|רכבת|מטרו|תחנה מרכזית/, "train"],
    [/שדה תעופה|נמל התעופה|טרמינל|נתב/, "airport"],
    [/מלון|אכסניה|לינה/, "hotel"],
    [/הר |הרים|פסגה|מעבר|קזבק|מטצמינדה/, "mountain"],
    [/מסלול|טרק|שביל|הליכה רגלית/, "hike"],
    [/כיכר|רחוב|שכונה|עיר עתיקה|סמטא|סמטאות/, "city"],
  ];

  const BY_TYPE = {
    airport: "airport", station: "train", hotel: "hotel", food: "food",
    hike: "hike", pass: "mountain", car: "mountain", town: "city", sight: "pin",
  };

  function kindOf(p) {
    const name = String(p?.name || "");
    for (const [re, key] of KEYS) if (re.test(name)) return key;
    return BY_TYPE[p?.type] || "pin";
  }

  /* ------------------------------------------------------------------ */
  /*  איזה יום זה                                                        */
  /* ------------------------------------------------------------------ */
  /**
   * אופי היום נקבע ממה שיש בו, ולא ממה שכתוב עליו: יום עם שדה תעופה
   * הוא יום טיסה גם אם המסמך קורא לו אחרת, ויום של 200 ק"מ הוא יום
   * כביש גם אם ה-mode שלו "city".
   */
  function sceneOf(day) {
    const pts = (day?.points || []).filter((p) => p && p.name);
    const kinds = pts.map(kindOf);
    const n = (k) => kinds.filter((x) => x === k).length;

    if (n("airport")) return "air";
    /* הקילומטרים לבדם אינם מספיקים: יום עירוני יכול לצבור 40 ק"מ של
       מטרו והליכה, והוא עדיין לא יום כביש. ה-mode הוא מה שמכריע. */
    if (day?.mode === "drive" || ((day?.drive?.km || 0) >= 60 && day?.mode !== "city")) {
      return "road";
    }
    if (n("market") >= 2) return "market";
    if (n("park") + n("water") + n("mountain") + n("hike") >= 3) return "trail";
    if (n("castle") + n("monastery") + n("bath") + n("cave") >= 2) return "oldtown";
    return "city";
  }

  const SCENE_LABEL = {
    air: "יום טיסה", road: "יום נסיעה", market: "יום שווקים",
    trail: "יום בטבע", oldtown: "יום בעיר העתיקה", city: "יום בעיר",
  };

  /* ------------------------------------------------------------------ */
  /*  גיאומטריה                                                          */
  /* ------------------------------------------------------------------ */

  const W = 360;        // רוחב ה-viewBox; הפאנל נמתח אליו
  const MT = 56;        // הרקע שמעל התחנה הראשונה
  const ROW = 100;      // גובה שורה — שתי תחנות בשורה
  const MB = 42;

  /** שתי תחנות בשורה, והשורות מתחלפות כיוון — מסלול שמתפתל ויורד */
  function layout(n) {
    const pos = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      // עמוד ראשון מימין: בעברית קוראים משם
      const xs = row % 2 === 0 ? [250, 110] : [110, 250];
      pos.push({ x: xs[col], y: MT + row * ROW + 24, row });
    }
    return pos;
  }

  const height = (n) => MT + Math.ceil(n / 2) * ROW + MB;

  /**
   * הקו עצמו: עובר בכל התחנות, ובין שורה לשורה יוצא אל הקצה ומסתובב.
   * נקודת הסיבוב היא מה שהופך זיגזג לפנייה.
   */
  function waypoints(pos) {
    const out = [];
    const first = pos[0];
    out.push({ x: first.x + (first.x > 180 ? 28 : -28), y: first.y - 42 });
    for (let i = 0; i < pos.length; i++) {
      out.push(pos[i]);
      const next = pos[i + 1];
      if (next && next.row !== pos[i].row) {
        out.push({ x: pos[i].x > 180 ? 322 : 38, y: (pos[i].y + next.y) / 2 });
      }
    }
    const last = pos[pos.length - 1];
    out.push({ x: last.x + (last.x > 180 ? -26 : 26), y: last.y + 40 });
    return out;
  }

  /** Catmull-Rom → Bézier: עקומה חלקה שעוברת בדיוק בנקודות עצמן */
  function spline(pts) {
    if (pts.length < 2) return "";
    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(p2.x)} ${r(p2.y)}`;
    }
    return d;
  }

  const r = (v) => Math.round(v * 10) / 10;

  /* ------------------------------------------------------------------ */
  /*  הרקע                                                               */
  /* ------------------------------------------------------------------ */
  /**
   * הקישוט נבחר לפי זרע קבוע (מספר היום), ולא אקראית בכל ציור. יום 3
   * נראה אותו דבר בכל פעם שפותחים אותו — אחרת כל render היה מזיז את
   * הבתים, והתרשים היה מרצד.
   */
  function rng(seed) {
    let s = (seed * 9301 + 49297) % 233280 || 7;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  const house = (x, y, w, h, gable) =>
    gable
      ? `<path class="sc-far" d="M${x} ${y} v${-h} l${w / 2} ${-w / 3} l${w / 2} ${w / 3} V${y} Z"/>` +
        `<path class="sc-line" d="M${x + w * 0.3} ${y} v${-h * 0.5} h${w * 0.4} v${h * 0.5}"/>`
      : `<path class="sc-far" d="M${x} ${y} v${-h} h${w} v${h} Z"/>` +
        `<path class="sc-line" d="M${x + w * 0.22} ${y - h * 0.2} v${-h * 0.45} M${x + w * 0.55} ${y - h * 0.2} v${-h * 0.45}"/>`;

  function deco(kind, seed, H) {
    const rnd = rng(seed);
    const out = [];
    const base = H - 16;

    if (kind === "oldtown" || kind === "market" || kind === "city") {
      const gable = kind !== "city";
      // שורת בתים למעלה ושורה למטה — הקו עובר ביניהן
      for (const y of [MT - 12, base]) {
        let x = 6;
        while (x < W - 24) {
          const w = 26 + Math.round(rnd() * 22);
          const h = 22 + Math.round(rnd() * 26);
          out.push(house(x, y, w, h, gable && rnd() > 0.35));
          x += w + 4 + Math.round(rnd() * 8);
        }
      }
      if (kind === "market") {
        /* דוכנים בשוליים בלבד. במרכז עוברים הדרך והשמות, ודוכן שנוחת
           עליהם הופך רקע למפריע. */
        const rows = Math.max(2, Math.floor((H - MT - 60) / 120));
        for (let i = 0; i <= rows; i++) {
          const x = i % 2 ? 6 : W - 50;
          const y = MT + 30 + (i * (H - MT - 80)) / Math.max(rows, 1);
          out.push(
            `<path class="sc-awn" d="M${x} ${r(y)} h44 l-5 10 h-34 Z"/>` +
            `<path class="sc-line" d="M${x + 11} ${r(y)} l-1.5 10M${x + 22} ${r(y)} l-1 10M${x + 33} ${r(y)} l-0.5 10"/>` +
            `<path class="sc-near" d="M${x + 5} ${r(y + 10)} h34 v4 h-34 Z"/>` +
            `<path class="sc-line" d="M${x + 8} ${r(y + 14)} v7M${x + 36} ${r(y + 14)} v7"/>`
          );
        }
      }
    }

    if (kind === "road") {
      // רכס רחוק עם פסגות מושלגות, וגבעות קרובות
      let d = `M0 ${MT + 6}`;
      for (let x = 0; x <= W; x += 45) d += ` L${x + 22} ${MT - 34 - rnd() * 26} L${x + 45} ${MT + 2}`;
      out.push(`<path class="sc-far" d="${d} L${W} ${MT + 10} L0 ${MT + 10} Z"/>`);
      out.push(`<path class="sc-snow" d="M70 ${MT - 44} l12 16 h-24 Z M214 ${MT - 40} l11 15 h-22 Z"/>`);
      for (let i = 0; i < 5; i++) {
        const x = 14 + i * 72 + rnd() * 20;
        out.push(`<path class="sc-near" d="M${r(x)} ${base} q22 -30 44 0 Z"/>`);
      }
    }

    if (kind === "trail") {
      // תלמי שדה — קווים אופקיים שמתעקלים קלות, ועצים בשוליים
      for (let i = 0; i < 9; i++) {
        const y = MT + 4 + i * ((H - MT - 30) / 9);
        out.push(
          `<path class="sc-furrow" d="M4 ${r(y)} q90 ${r(-5 - rnd() * 7)} 176 0 t176 0"/>`
        );
      }
      for (let i = 0; i < 8; i++) {
        const x = (i % 2 ? W - 30 : 20) + (rnd() - 0.5) * 16;
        const y = MT + 16 + (i * (H - MT - 46)) / 8;
        const rad = 8 + rnd() * 4;
        out.push(
          `<path class="sc-trunk" d="M${r(x)} ${r(y + rad + 9)} V${r(y + rad - 2)}"/>` +
          `<circle class="sc-tree" cx="${r(x)}" cy="${r(y)}" r="${r(rad)}"/>` +
          `<circle class="sc-tree" cx="${r(x - rad * 0.7)}" cy="${r(y + rad * 0.5)}" r="${r(rad * 0.7)}"/>` +
          `<circle class="sc-tree" cx="${r(x + rad * 0.7)}" cy="${r(y + rad * 0.5)}" r="${r(rad * 0.7)}"/>`
        );
      }
    }

    if (kind === "air") {
      for (let i = 0; i < 6; i++) {
        const x = 10 + rnd() * (W - 120);
        const y = MT - 24 + rnd() * (H - MT);
        const s = 0.7 + rnd() * 0.7;
        out.push(
          `<path class="sc-cloud" transform="translate(${r(x)} ${r(y)}) scale(${r(s)})" ` +
          'd="M14 22a9 9 0 0 1 0-18 12 12 0 0 1 22 2 8 8 0 0 1 2 16Z"/>'
        );
      }
    }

    return out.join("");
  }

  /* ------------------------------------------------------------------ */
  /*  טקסט                                                               */
  /* ------------------------------------------------------------------ */

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  /** שם ארוך נשבר לשתי שורות; מה שלא נכנס בשתיהן מקבל שלוש נקודות */
  function wrap(name, max = 16, lines = 2) {
    const words = String(name || "").trim().split(/\s+/);
    const out = [];
    let cur = "";
    for (const w of words) {
      if (!cur) cur = w;
      else if ((cur + " " + w).length <= max) cur += " " + w;
      else { out.push(cur); cur = w; if (out.length === lines) break; }
    }
    if (cur && out.length < lines) out.push(cur);
    if (out.length === lines && words.join(" ").length > out.join(" ").length) {
      out[lines - 1] = out[lines - 1].slice(0, max - 1).trim() + "…";
    }
    return out.slice(0, lines);
  }

  /* ------------------------------------------------------------------ */
  /*  התרשים                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * @param day   יום מ-TRIP.days
   * @param opt.times  שעה לכל נקודה, לפי סדר day.points
   * @param opt.state  "done" | "now" | "" לכל נקודה
   * @param opt.data   פונקציה שמחזירה את תכונות ה-data של נקודה, כדי
   *                   שלחיצה עליה תיפתח באותו כרטיס של שאר האפליקציה
   */
  function svg(day, opt = {}) {
    const pts = (day?.points || []).filter((p) => p && p.name);
    if (!pts.length) return "";

    const kind = sceneOf(day);
    const times = opt.times || [];
    const states = opt.state || [];
    const tones = opt.tone || [];
    const data = opt.data || (() => "");

    // הצומת האחרון אינו תחנה אלא סוף המסלול: ה-i שפותח את הפירוט
    const pos = layout(pts.length + 1);
    const H = height(pts.length + 1);
    const line = spline(waypoints(pos));

    const stops = pts
      .map((p, i) =>
        marker(day, p, pos[i], times[i], states[i], tones[i], i, pts.length, data)
      )
      .join("");

    const end = pos[pos.length - 1];

    return (
      `<svg class="ovs__svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
      `role="img" aria-label="${esc(day.title || "")}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect class="sc-sky" x="0" y="0" width="${W}" height="${H}"/>` +
      deco(kind, day.n || 1, H) +
      // הדרך עצמה: גוף רחב, שוליים, והסימון שלאורכה — ריצוף, פס לבן או עפר
      `<path class="sc-band-edge" d="${line}"/>` +
      `<path class="sc-band" d="${line}"/>` +
      `<path class="sc-band-mark" d="${line}"/>` +
      stops +
      endNode(day, end) +
      "</svg>"
    );
  }

  function marker(day, p, at, time, state, tone, i, total, data) {
    const k = kindOf(p);
    const cls =
      `ovs__stop${state ? " is-" + state : ""}${tone ? " sc-tone--" + tone : ""}`;
    const lines = wrap(p.name);
    const label = lines
      .map((t, j) => `<tspan x="${at.x}" dy="${j ? 12 : 0}">${esc(t)}</tspan>`)
      .join("");

    return (
      `<g class="${cls}" ${data(p, i, total)} role="button" tabindex="0" ` +
      `aria-label="${esc((time ? time + " · " : "") + p.name)}">` +
      `<circle class="sc-halo" cx="${at.x}" cy="${at.y}" r="25"/>` +
      `<circle class="sc-disc" cx="${at.x}" cy="${at.y}" r="20"/>` +
      `<g class="sc-g" transform="translate(${at.x - 11} ${at.y - 11}) scale(0.92)">${G[k] || G.pin}</g>` +
      (time
        ? `<g class="sc-when"><rect x="${at.x - 18}" y="${at.y - 36}" width="36" height="15" rx="7.5"/>` +
          `<text class="sc-time" x="${at.x}" y="${at.y - 25.5}">${esc(time)}</text></g>`
        : "") +
      (state === "done"
        ? `<g class="sc-ok"><circle cx="${at.x + 15}" cy="${at.y + 15}" r="7.5"/>` +
          `<path d="M${at.x + 11.5} ${at.y + 15} l2.4 2.6 4.4-5"/></g>`
        : "") +
      `<text class="sc-label" x="${at.x}" y="${at.y + 34}">${label}</text>` +
      "</g>"
    );
  }

  /** סוף המסלול: הכפתור שפותח את הפירוט היומי המלא */
  function endNode(day, at) {
    return (
      `<g class="ovs__stop ovs__end" data-ov-info="${day.n}" role="button" tabindex="0" ` +
      'aria-label="הפירוט המלא של היום">' +
      `<circle class="sc-disc" cx="${at.x}" cy="${at.y}" r="20"/>` +
      `<g class="sc-g" transform="translate(${at.x - 11} ${at.y - 11}) scale(0.92)">${G.info}</g>` +
      `<text class="sc-label" x="${at.x}" y="${at.y + 34}">פירוט היום</text>` +
      "</g>"
    );
  }

  return { svg, kindOf, sceneOf, sceneLabel: (d) => SCENE_LABEL[sceneOf(d)] || "", glyph: (k) => G[k] || G.pin };
})();

if (typeof window !== "undefined") window.DayScene = DayScene;
