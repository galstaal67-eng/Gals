/* =========================================================================
   עוזר ה-AI — שינוי חופשי במסלול.

   הזרימה היא תמיד בקשה → הצעה → אישור, לעולם לא בקשה → שמירה. המודל מחזיר
   ערכת שינויים תחומה, האפליקציה מציירת ממנה "לפני ← אחרי", והמשתמש מאשר.
   אחרי ההחלה נשמר עותק של המסמך ופס הביטול מאפשר לחזור בלחיצה אחת.

   אפשר גם לצרף מסמך — כרטיס טיסה, כרטיס להופעה, אישור לינה או סתם מידע.
   הקובץ נשלח לקריאה חד-פעמית ונשמר במכשיר (TripDocs), והפרטים שנקראו ממנו
   נכנסים לטיול באותו מסלול של הצעה ואישור. כשחסר מידע כדי לקבוע משהו
   העוזר **שואל** לפני ההצעה, במקום לנחש.

   הקובץ חשוף כ-TripAI ומקבל מהאפליקציה את מה שהוא צריך (getTrip/onApply),
   כדי שלא יהיה תלוי במשתנים הפנימיים של app.js.
   ========================================================================= */

const TripAI = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const CODE_KEY = "ai:code";
  const MODES = {
    flight: "טיסה", drive: "נסיעה", train: "רכבת", hike: "הליכה", city: "עירוני",
  };

  const EXAMPLES = [
    "תשנה את יום 3 להישאר בעיר וללא נסיעה",
    "תוסיף ליום 2 ארוחת ערב ותצפית שקיעה",
    "תהפוך את יום 4 ליום רגוע יותר",
    "תעביר את הטיול ליום גשום — מה משתנה",
  ];

  const LEGS = { out: "הלוך", back: "חזור" };
  const FLIGHT_FIELDS = [
    ["flightNo", "מספר טיסה"], ["date", "תאריך"], ["dep", "המראה"], ["arr", "נחיתה"],
    ["from", "מוצא"], ["to", "יעד"], ["terminal", "טרמינל"], ["duration", "משך"],
  ];
  /** מעל זה ה-API חוסם את הבקשה, ועדיף לומר את זה לפני ההעלאה */
  const MAX_TOTAL_BYTES = 14 * 1024 * 1024;
  const MAX_FILES = 3;
  /** אחרי שלושה סבבים שאלה רודפת שאלה היא לופ, לא דיאלוג */
  const MAX_ROUNDS = 3;

  let host = null;          // { getTrip, onApply, onDocs, onDocsRemove, esc }
  let proposal = null;      // ערכת השינויים שחוזרת מהשרת
  let undoDoc = null;       // עותק המסמך שלפני ההחלה
  let undoTimer = null;
  let attached = [];        // הקבצים שצורפו לבקשה הנוכחית
  let asked = [];           // השאלות של הסבב האחרון
  let answers = [];         // התשובות שנאספו — נשלחות שוב בכל סבב
  let rounds = 0;           // כמה פעמים כבר נשאלנו על אותה בקשה
  let savedDocs = [];       // מזהי המסמכים שנשמרו בהחלה האחרונה, לביטול
  let savedExpenses = [];   // מזהי ההוצאות שנרשמו בה, לאותה מטרה

  /* ------------------------------------------------------------------ */
  /*  עזרים                                                              */
  /* ------------------------------------------------------------------ */

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function step(which) {
    ["aiAsk", "aiBusy", "aiQuestions", "aiReview"].forEach((id) => {
      $("#" + id).hidden = id !== which;
    });
  }

  function showErr(msg) {
    const el = $("#aiErr");
    el.textContent = msg;
    el.hidden = !msg;
  }

  /* ------------------------------------------------------------------ */
  /*  המסמכים המצורפים                                                   */
  /* ------------------------------------------------------------------ */

  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.round(n / 1024) + "KB");

  function renderFiles() {
    const box = $("#aiFileList");
    box.innerHTML = attached
      .map(
        (f, i) => `<li class="ai-file">
          <span class="ai-file__name">${esc(f.name)}</span>
          <span class="muted sm">${esc(kb(f.size))}</span>
          <button type="button" class="trip-row__del" data-unattach="${i}"
                  aria-label="הסרת הקובץ">🗑️</button>
        </li>`
      )
      .join("");
    box.hidden = !attached.length;
  }

  /**
   * קבצים שנבחרו מצטרפים לבקשה הנוכחית. הם אינם נשמרים כאן —
   * השמירה במכשיר קורית רק באישור ההצעה, יחד עם הכותרת והיום
   * שהעוזר שייך להם.
   */
  function addFiles(list) {
    const picked = Array.from(list || []);
    if (!picked.length) return;

    for (const file of picked) {
      if (attached.length >= MAX_FILES) {
        return showErr(`אפשר לצרף עד ${MAX_FILES} מסמכים בבקשה אחת.`);
      }
      const total = attached.reduce((n, f) => n + f.size, 0) + file.size;
      if (total > MAX_TOTAL_BYTES) {
        return showErr("המסמכים כבדים מדי יחד. צרפו אותם בבקשות נפרדות.");
      }
      attached.push(file);
    }
    showErr("");
    renderFiles();
  }

  /** המסמכים כ-base64, בסדר שבו הם צורפו */
  async function encodeFiles() {
    const out = [];
    for (const file of attached) {
      out.push({
        name: file.name,
        mediaType: file.type || "application/octet-stream",
        data: await TripDocs.toBase64(file),
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  תצוגת "לפני ← אחרי"                                                */
  /* ------------------------------------------------------------------ */

  /** שורה אחת של שדה שהשתנה. מחזיר "" כשאין שינוי בפועל. */
  function fieldRow(label, before, after) {
    if (after === null || after === undefined) return "";
    const b = String(before ?? "").trim();
    const a = String(after).trim();
    if (b === a) return "";
    return `<p class="ai-field"><b>${esc(label)}:</b>
      ${b ? `<span class="ai-old">${esc(b)}</span> ← ` : ""}
      <span class="ai-new">${a ? esc(a) : "— הוסר"}</span></p>`;
  }

  function listRow(label, before, after) {
    if (after === null || after === undefined) return "";
    const b = before || [];
    if (JSON.stringify(b) === JSON.stringify(after)) return "";
    const items = after.length
      ? `<ul class="ai-list">${after
          .map((x) => `<li>${esc(typeof x === "string" ? x : `${x.time} — ${x.text}`)}</li>`)
          .join("")}</ul>`
      : `<span class="ai-new">— רוקן</span>`;
    return `<p class="ai-field"><b>${esc(label)}</b>
      <span class="muted sm">(${b.length} ← ${after.length})</span></p>${items}`;
  }

  /**
   * שינוי המפה מוצג בנפרד משאר השדות: זה השדה היחיד שבו השרת עשוי
   * להשמיט משהו שהמודל ביקש (שם מקום שלא נפתר), ואי אפשר להסתיר את זה
   * מאחורי "לפני ← אחרי".
   */
  function mapRow(day, c) {
    if (!Array.isArray(c.points)) return "";
    const before = (day.points || []).map((p) => p.name);
    const after = c.points.map((p) => p.name);
    if (!before.length && !after.length) return "";

    const unresolved = c.unresolved || [];
    if (unresolved.length && !c.points.length) {
      // שום שם לא נפתר — המפה לא תשתנה בכלל, ועדיף לומר את זה מראש
      return `<p class="ai-field ai-field--warn">⚠️ ביקשתי לעדכן את המפה אבל אף
        מקום לא נמצא (${esc(unresolved.join(", "))}). המפה של היום תישאר כפי שהיא.</p>`;
    }
    const dropped = unresolved.length
      ? `<p class="ai-field ai-field--warn">⚠️ לא נמצאו על המפה ולכן הושמטו:
           ${esc(unresolved.join(", "))}</p>`
      : "";

    return `<p class="ai-field"><b>נקודות על המפה</b>
        <span class="muted sm">(${before.length} ← ${after.length})</span></p>
      <p class="ai-field ai-field--list">${
        after.length ? esc(after.join(" · ")) : "<span class=\"muted\">היום יישאר בלי נקודות</span>"
      }</p>${dropped}`;
  }

  function renderDiff(trip, changes) {
    if (!changes.length) {
      return '<p class="muted">לא הוצע שינוי בימים.</p>';
    }
    return changes
      .map((c) => {
        const day = trip.days.find((d) => d.n === c.n);
        if (!day) return "";
        const rows = [
          fieldRow("כותרת", day.title, c.title),
          fieldRow("תיאור", day.summary, c.summary),
          fieldRow("אופן", MODES[day.mode] || day.mode,
            c.mode === null ? null : MODES[c.mode] || c.mode),
          fieldRow('ק"מ נסיעה', day.drive?.km, c.driveKm),
          fieldRow("שעות נסיעה", day.drive?.hours, c.driveHours),
          fieldRow("הערת נסיעה", day.drive?.note, c.driveNote),
          fieldRow("לינה", day.hotel?.name, c.hotelName),
          fieldRow("אזור הלינה", day.hotel?.area, c.hotelArea),
          listRow("לוח זמנים", day.plan, c.plan),
          listRow("טיפים", day.tips, c.tips),
          mapRow(day, c),
        ].filter(Boolean).join("");

        if (!rows) return "";
        return `<article class="ai-day">
          <h4>יום ${c.n} · ${esc(day.date)} — ${esc(day.title || "")}</h4>
          ${rows}
        </article>`;
      })
      .filter(Boolean)
      .join("") || '<p class="muted">ההצעה זהה למצב הקיים.</p>';
  }

  /** כרטיס הוצאה להצעה — אותם שדות שהטופס הידני כותב */
  function renderExpenses(rows) {
    if (!rows.length) return "";
    return rows
      .map(
        (e) => `<article class="ai-exp">
          <div class="ai-exp__amt">${esc(e.currency)}${esc(
          Number(e.amount).toLocaleString("he-IL", { maximumFractionDigits: 2 })
        )}</div>
          <div>${esc(e.note || "ללא תיאור")}</div>
          <div class="ai-exp__meta">
            <span>📆 ${esc(e.date)}</span>
            <span>🏷️ ${esc(e.category)}</span>
            <span>👤 ${esc(e.payer)}</span>
          </div>
        </article>`
      )
      .join("");
  }

  /**
   * מה שייכנס לפרטי הטיסה מתוך כרטיס שצורף.
   *
   * שדה ריק בכרטיס אינו מחיקה אלא "לא מופיע כאן", ולכן הוא מתורגם ל-null
   * ולא מוצג כשינוי. טרמינל שנמחק בטעות גרוע מטרמינל שלא התעדכן.
   */
  function renderFlights(trip, legs) {
    if (!legs.length) return "";
    return legs
      .map((l) => {
        const cur = (trip.flights && trip.flights[l.leg]) || {};
        const rows = FLIGHT_FIELDS
          .map(([k, label]) => fieldRow(label, cur[k], l[k] ? l[k] : null))
          .concat(
            (l.seats || []).length
              ? fieldRow(
                  "מושבים",
                  (cur.seats || []).map((x) => `${x.who} ${x.seat}`).join(", "),
                  l.seats.map((x) => `${x.who} ${x.seat}`).join(", ")
                )
              : ""
          )
          .filter(Boolean)
          .join("");
        if (!rows) return "";
        return `<article class="ai-day">
          <h4>✈️ טיסת ${esc(LEGS[l.leg] || l.leg)}</h4>${rows}</article>`;
      })
      .filter(Boolean)
      .join("");
  }

  /**
   * המסמכים שיישמרו, עם הכותרת והיום שהעוזר שייך להם.
   *
   * כל קובץ שצורף מופיע כאן גם אם המודל לא סיווג אותו: המשתמש העלה אותו
   * כדי שיהיה לו, והשמטה שקטה הייתה הפתעה רעה באמצע הטיול.
   */
  function docPlan(set) {
    const metas = set.docs || [];
    return attached.map((file, i) => {
      const meta = metas.find((m) => Number(m.index) === i + 1) || {};
      return {
        file,
        title: String(meta.title || "").trim() || file.name,
        kind: meta.kind || "other",
        dayN: TripDocs.dayOf(meta.dayN, (host.getTrip().days || []).length),
        leg: meta.leg === "out" || meta.leg === "back" ? meta.leg : null,
        who: String(meta.who || "").trim(),
        note: String(meta.note || "").trim(),
        classified: !!meta.title,
      };
    });
  }

  function renderDocs(plan) {
    if (!plan.length) return "";
    const rows = plan
      .map(
        (d) => `<p class="ai-field">📎 <b>${esc(d.title)}</b>
          <span class="muted sm">${esc(TripDocs.label(d.kind))}${
            d.dayN ? ` · יום ${d.dayN}` : ""
          }${d.leg ? ` · ${esc(LEGS[d.leg])}` : ""}${d.who ? ` · ${esc(d.who)}` : ""}</span>
          ${d.note ? `<br><span class="ai-field--list">${esc(d.note)}</span>` : ""}
          ${d.classified ? "" : '<br><span class="ai-field--warn">⚠️ לא זוהה סוג — יישמר כמסמך כללי</span>'}
        </p>`
      )
      .join("");
    return `<article class="ai-day">
      <h4>📎 מסמכים שיישמרו</h4>${rows}
      <p class="ai-field ai-field--list">נשמרים במכשיר הזה בלבד, ונפתחים גם בלי רשת.</p>
    </article>`;
  }

  /* ------------------------------------------------------------------ */
  /*  שאלות הבהרה                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * השאלות מוצגות לפני ההצעה, לא במקומה: התשובות חוזרות לשרת והמודל
   * מציע שוב, עם המסמך שכבר נקרא.
   *
   * לכל שאלה יש תמיד מסלול יציאה — "לא יודע" — כי שאלה שאין לה תשובה
   * הייתה הופכת את הדיאלוג למסך שאי אפשר להתקדם ממנו.
   */
  function renderQuestions(list) {
    asked = list;
    $("#aiQIntro").textContent =
      list.length > 1 ? "כדי לא לנחש, צריך לדעת:" : "דבר אחד חסר לי:";
    $("#aiQList").innerHTML = list
      .map((q, i) => {
        const opts = Array.isArray(q.options) ? q.options.filter(Boolean) : [];
        const body = opts.length
          ? opts
              .concat("לא יודע")
              .map(
                (o, j) => `<label class="wiz__opt">
                  <input type="radio" name="aiq${i}" value="${esc(o)}" ${j === 0 ? "checked" : ""} />
                  <span>${esc(o)}</span></label>`
              )
              .join("") +
            `<input type="text" class="ai-q-free" placeholder="או תשובה אחרת" />`
          : `<input type="text" class="ai-q-free" placeholder="התשובה שלי — או 'לא יודע'" />`;
        return `<fieldset class="ai-q" data-q="${i}">
          <legend>${esc(q.text)}</legend>${body}</fieldset>`;
      })
      .join("");
  }

  /** תשובה חופשית גוברת על הבחירה: היא מה שהמשתמש הקליד בפועל */
  function collectAnswers() {
    return asked.map((q, i) => {
      const box = $(`.ai-q[data-q="${i}"]`);
      const typed = $(".ai-q-free", box)?.value.trim() || "";
      const picked = $('input[type="radio"]:checked', box);
      return { question: q.text, answer: typed || (picked ? picked.value : "") };
    });
  }

  /* ------------------------------------------------------------------ */
  /*  החלה                                                               */
  /* ------------------------------------------------------------------ */

  /** מחיל את ערכת השינויים על המסמך. שדה null נשאר כמות שהוא. */
  function applyChangeSet(trip, set) {
    (set.dayChanges || []).forEach((c) => {
      const day = trip.days.find((d) => d.n === c.n);
      if (!day) return;

      if (c.title !== null) day.title = c.title;
      if (c.summary !== null) day.summary = c.summary;
      if (c.mode !== null && trip.modes[c.mode]) {
        day.mode = c.mode;
        // קו המסלול על המפה עוקב אחרי אופן היום, אלא אם הוא יום טיסה
        if (day.pathMode !== "flight") day.pathMode = c.mode;
      }

      if (c.driveKm !== null || c.driveHours !== null || c.driveNote !== null) {
        day.drive = day.drive || { km: 0, hours: 0, note: "" };
        if (c.driveKm !== null) day.drive.km = Math.max(0, Number(c.driveKm) || 0);
        if (c.driveHours !== null) day.drive.hours = Math.max(0, Number(c.driveHours) || 0);
        if (c.driveNote !== null) day.drive.note = c.driveNote;
      }

      if (c.hotelName !== null) {
        if (c.hotelName.trim()) {
          day.hotel = {
            ...(day.hotel || { lat: 0, lng: 0 }),
            name: c.hotelName.trim(),
            area: c.hotelArea !== null ? c.hotelArea : day.hotel?.area || "",
          };
        } else {
          delete day.hotel;      // "" הוא הסימון ל"אין לינה ביום הזה"
        }
      } else if (c.hotelArea !== null && day.hotel) {
        day.hotel.area = c.hotelArea;
      }

      if (Array.isArray(c.plan)) {
        day.plan = c.plan
          .map((p) => ({ time: String(p.time || "").trim(), text: String(p.text || "").trim() }))
          .filter((p) => p.time || p.text);
      }
      if (Array.isArray(c.tips)) {
        day.tips = c.tips.map((t) => String(t).trim()).filter(Boolean);
      }

      // המפה עוקבת אחרי היום. בלי זה כרטיס היום אומר "נשארים בעיר"
      // בזמן שהמפה עדיין מציירת את הקו לקזבגי.
      // נקודה אחת שלא נפתרה היא השמטה; כולן שלא נפתרו זו תקלה — ואז
      // עדיף להשאיר את המפה הקודמת מאשר למחוק את היום ממנה
      const allFailed = Array.isArray(c.points) && !c.points.length && (c.unresolved || []).length;
      if (Array.isArray(c.points) && !allFailed) {
        day.points = c.points
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
          .map((p) => ({
            name: String(p.name || "").trim(),
            lat: p.lat,
            lng: p.lng,
            type: String(p.type || "sight"),
          }));
        // הקו נגזר מהנקודות, בדיוק כמו במסמך המקורי
        day.path = day.points.length > 1 ? day.points.map((p) => [p.lat, p.lng]) : [];
      }
    });

    // פרטי טיסה מכרטיס שצורף. שדה ריק הוא "לא מופיע בכרטיס" ולא מחיקה,
    // ולכן רק ערך שיש בו תוכן נכתב. זה גם מאפשר להעלות כרטיס עלייה
    // למטוס שיש בו רק מושב וטרמינל בלי לאבד את מספר הטיסה.
    (set.flights || []).forEach((l) => {
      if (l.leg !== "out" && l.leg !== "back") return;
      trip.flights = trip.flights || {};
      const leg = trip.flights[l.leg] || (trip.flights[l.leg] = {});
      FLIGHT_FIELDS.forEach(([k]) => {
        const v = String(l[k] ?? "").trim();
        if (v) leg[k] = v;
      });
      const seats = (l.seats || [])
        .map((x) => ({ who: String(x.who || "").trim(), seat: String(x.seat || "").trim() }))
        .filter((x) => x.seat);
      if (seats.length) {
        // מיזוג לפי נוסע, לא החלפה. כרטיס עלייה למטוס הוא של אדם אחד,
        // והחלפת הרשימה הייתה מוחקת את המושב של מי שלא העלה כרטיס.
        const key = (v) => String(v || "").trim().toLowerCase();
        const merged = (leg.seats || []).slice();
        seats.forEach((s) => {
          const i = merged.findIndex((x) => key(x.who) && key(x.who) === key(s.who));
          if (i >= 0) merged[i] = s;
          else merged.push(s);
        });
        leg.seats = merged;
      }
      // יום בשבוע נגזר מהתאריך, בדיוק כמו בקריאת כרטיס מלשונית הטיסות
      if (leg.date && typeof TripStore !== "undefined") leg.dow = TripStore.dowOf(leg.date);
    });

    if (set.metaSubtitle) trip.meta.subtitle = set.metaSubtitle;

    // סך הק"מ הוא נגזרת — מחשבים מחדש במקום לתת למודל לעדכן אותו
    trip.meta.totalDrivingKm = trip.days.reduce((s, d) => s + (d.drive?.km || 0), 0);
    return trip;
  }

  /* ------------------------------------------------------------------ */
  /*  פס הביטול                                                          */
  /* ------------------------------------------------------------------ */

  /** מה לכתוב בפס אחרי ההחלה — מה שבאמת קרה, ולא רק הסיכום של המודל */
  function applyNote(set, touchedTrip, expenseCount) {
    if (touchedTrip && expenseCount) {
      const summary = set.summary || "השינוי הוחל";
      // הסיכום של המודל כבר אומר לא פעם שההוצאה נרשמה, ואז התוספת
      // הופכת את הפס ל"...וההוצאה נרשמה · הוצאה נרשמה"
      if (/הוצא/.test(summary)) return summary;
      return summary +
        (expenseCount === 1 ? " · הוצאה נרשמה" : ` · ${expenseCount} הוצאות נרשמו`);
    }
    if (expenseCount) {
      return expenseCount === 1 ? "הוצאה נרשמה" : `${expenseCount} הוצאות נרשמו`;
    }
    if (touchedTrip) return set.summary || "השינוי הוחל";
    return (set.docs || []).length > 1 ? "המסמכים נשמרו" : "המסמך נשמר";
  }

  function undoBar(show, text = "", canUndo = true) {
    let bar = $("#aiUndo");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "aiUndo";
      bar.className = "ai-undo";
      bar.innerHTML =
        '<div><span id="aiUndoText"></span>' +
        '<button class="btn btn--sm" id="aiUndoBtn">↩︎ בטל</button></div>';
      document.body.appendChild(bar);
      bar.addEventListener("click", (e) => {
        if (!e.target.closest("#aiUndoBtn")) return;
        // ביטול מחזיר את **כל** מה שההחלה עשתה. ביטול חלקי — שמשאיר
        // מסמך מצורף ליום או הוצאה בטבלה אחרי שהשינוי עצמו בוטל — גרוע
        // מלא לבטל, כי אי אפשר לדעת ממנו מה נשאר
        if (undoDoc) { host.onApply(undoDoc, { undo: true }); undoDoc = null; }
        if (savedDocs.length) { host.onDocsRemove(savedDocs); savedDocs = []; }
        if (savedExpenses.length) { host.onExpensesRemove(savedExpenses); savedExpenses = []; }
        undoBar(false);
      });
    }
    $("#aiUndoText", bar).textContent = text;
    $("#aiUndoBtn", bar).hidden = !canUndo;
    bar.hidden = !show;
    clearTimeout(undoTimer);
    if (show) undoTimer = setTimeout(() => { bar.hidden = true; }, canUndo ? 15000 : 6000);
  }

  /* ------------------------------------------------------------------ */
  /*  הקריאה לשרת                                                        */
  /* ------------------------------------------------------------------ */

  async function send() {
    const instruction = $("#aiPrompt").value.trim();
    // מסמך לבדו הוא בקשה שלמה: מעלים כרטיס, וזה כל מה שצריך לומר
    if (!instruction && !attached.length) return showErr("כתבו מה לשנות, או צרפו מסמך.");
    showErr("");

    const trip = host.getTrip();
    step("aiBusy");
    $("#aiBusyNote").textContent = attached.length
      ? "קורא את המסמך…"
      : "זה לוקח בדרך כלל כמה שניות.";

    // יום־שלושה־ימים: הבקשות הארוכות לוקחות יותר, ושווה לומר את זה
    const slow = setTimeout(() => {
      $("#aiBusyNote").textContent = attached.length
        ? "מסמך סרוק לוקח יותר — עוד כמה שניות."
        : "בקשה מורכבת — עוד כמה שניות.";
    }, 7000);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction,
          doc: trip,
          context: host.getContext(),
          docs: await encodeFiles(),
          answers,
          round: rounds,
          code: localStorage.getItem(CODE_KEY) || $("#aiCode").value || "",
        }),
      });

      const data = await TripAPI.readJson(res);

      // שגיאה יכולה להגיע גם בגוף של תשובה מוזרמת: ברגע שהזרימה התחילה
      // קוד הסטטוס כבר נשלח, ולכן 200 עם error הוא כישלון לכל דבר.
      if (!res.ok || !data || data.error) {
        if (res.status === 401) {
          $("#aiCodeWrap").hidden = false;     // השרת דורש קוד — מבקשים אותו
          try { localStorage.removeItem(CODE_KEY); } catch { /* לא קריטי */ }
        }
        step("aiAsk");
        return showErr(
          data?.error || (res.ok ? "התשובה מהשרת לא נקראה." : `הבקשה נכשלה (${res.status})`)
        );
      }

      // קוד תקין — שומרים כדי לא לבקש אותו שוב
      const code = $("#aiCode").value.trim();
      if (code) { try { localStorage.setItem(CODE_KEY, code); } catch { /* לא קריטי */ } }

      // סבב שאלות: התשובות יחזרו לשרת ונקבל הצעה. המסמך נשאר מצורף,
      // ולכן הוא נקרא שוב עם התשובות ולא נשלח לחינם.
      if (data.kind === "question" && (data.questions || []).length && rounds < MAX_ROUNDS) {
        rounds++;
        $("#aiQSummary").textContent = data.summary || "";
        $("#aiQSummary").hidden = !data.summary;
        $("#aiQErr").hidden = true;
        renderQuestions(data.questions);
        step("aiQuestions");
        return;
      }

      proposal = data;
      $("#aiSummary").textContent = data.summary || "";
      $("#aiWarning").textContent = data.warning || "";
      $("#aiWarning").hidden = !data.warning;

      // הצעה אחת יכולה לכלול כמה דברים בבת אחת: מידע מודבק על מופע
      // שהוזמן הוא גם שורה בלוח הזמנים וגם הוצאה ששולמה. התצוגה מראה
      // את כולם, וההחלה מבצעת את כולם.
      const expenses = data.expenses || [];
      const plan = docPlan(data);
      const dayChanges = data.dayChanges || [];
      const flights = data.flights || [];
      const touchesTrip = dayChanges.length || flights.length;

      $("#aiDiff").innerHTML =
        renderFlights(trip, flights) +
        (dayChanges.length ? renderDiff(trip, dayChanges) : "") +
        renderExpenses(expenses) +
        renderDocs(plan);

      // הכפתור אומר מה הוא עושה בפועל
      const expLabel = expenses.length > 1
        ? `רשום ${expenses.length} הוצאות`
        : "רשום את ההוצאה";
      $("#aiApply").textContent = touchesTrip && expenses.length
        ? "החל והוסף להוצאות"
        : expenses.length ? expLabel
        : touchesTrip ? "החל את השינוי"
        : plan.length > 1 ? "שמור את המסמכים" : "שמור את המסמך";
      // אין מה להחיל כשהבקשה לא הובנה ושום מסמך לא צורף
      $("#aiApply").hidden = data.kind === "unclear" ||
        !(touchesTrip || expenses.length || plan.length);
      $("#aiUsage").textContent = data.usage
        ? `${data.usage.input.toLocaleString("he-IL")} טוקנים נכנסים · ` +
          `${data.usage.output.toLocaleString("he-IL")} יוצאים`
        : "";
      step("aiReview");
    } catch {
      step("aiAsk");
      showErr("אין חיבור לשרת. העוזר עובד רק באתר שפרוס, לא מפתיחה מהדיסק.");
    } finally {
      clearTimeout(slow);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  הכתבה (Web Speech API)                                             */
  /* ------------------------------------------------------------------ */

  /**
   * זיהוי דיבור מקומי בדפדפן — אין כאן העלאת אודיו לשרת שלנו.
   * נתמך בכרום ובספארי; בפיירפוקס הכפתור פשוט לא מוצג.
   * עברית עובדת היטב במילים, אבל מספרים ומטבעות משתבשים — ולכן
   * הפרומפט בשרת מורה למודל לסמן סכום לא סביר ב-warning.
   */
  let recog = null;
  let listening = false;

  function speechSupported() {
    return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
  }

  function stopDictation() {
    listening = false;
    $("#aiMic").classList.remove("is-live");
    $("#aiMic").setAttribute("aria-label", "הכתבה בקול");
    try { recog?.stop(); } catch { /* כבר נעצר */ }
  }

  function micNote(text) {
    const el = $("#aiMicNote");
    el.textContent = text;
    el.hidden = !text;
  }

  function toggleDictation() {
    if (listening) return stopDictation();

    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    recog = new Ctor();
    recog.lang = "he-IL";
    recog.interimResults = true;
    recog.continuous = false;

    // הטקסט שכבר היה בתיבה נשמר — ההכתבה מוסיפה, לא דורסת
    const base = $("#aiPrompt").value.trim();

    recog.onstart = () => {
      listening = true;
      $("#aiMic").classList.add("is-live");
      $("#aiMic").setAttribute("aria-label", "עצירת הכתבה");
      micNote("מקשיב… דברו, וזה ייעצר מעצמו בסוף המשפט.");
    };

    recog.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      $("#aiPrompt").value = (base ? base + " " : "") + text.trim();
    };

    recog.onerror = (e) => {
      stopDictation();
      micNote(
        e.error === "not-allowed"
          ? "אין הרשאה למיקרופון. אפשרו אותה בהגדרות הדפדפן."
          : e.error === "no-speech"
          ? "לא נקלט דיבור. נסו שוב."
          : "ההכתבה נכשלה. אפשר להקליד במקום."
      );
    };

    recog.onend = () => {
      stopDictation();
      if ($("#aiPrompt").value.trim()) micNote("בדקו שהסכום והמטבע נקלטו נכון.");
    };

    try {
      recog.start();
    } catch {
      stopDictation();
      micNote("ההכתבה לא נפתחה. אפשר להקליד במקום.");
    }
  }

  /* ------------------------------------------------------------------ */
  /*  פתיחה וסגירה                                                       */
  /* ------------------------------------------------------------------ */

  function open() {
    showErr("");
    proposal = null;
    // כל פתיחה היא בקשה חדשה: קבצים, שאלות ותשובות של הבקשה הקודמת
    // אינם רלוונטיים לה, ושליחה שלהם שוב הייתה מבלבלת את המודל
    attached = [];
    asked = [];
    answers = [];
    rounds = 0;
    renderFiles();
    $("#aiFiles").value = "";
    $("#aiPrompt").value = "";
    $("#aiBusyNote").textContent = "זה לוקח בדרך כלל כמה שניות.";
    $("#aiApply").hidden = false;
    micNote("");
    $("#aiCodeWrap").hidden = !!localStorage.getItem(CODE_KEY) || !$("#aiCode").value;
    $("#aiCodeWrap").hidden = true;            // מוצג רק אחרי 401
    step("aiAsk");
    $("#aiOverlay").hidden = false;
    $("#aiPrompt").focus();
  }

  function close() {
    stopDictation();
    attached = [];
    renderFiles();
    $("#aiOverlay").hidden = true;
  }

  /* ------------------------------------------------------------------ */

  return {
    /** host: { getTrip(), onApply(doc, {undo}) } */
    init(hostApi) {
      host = hostApi;

      $("#aiChips").innerHTML = EXAMPLES
        .map((t) => `<button type="button">${esc(t)}</button>`)
        .join("");
      $("#aiChips").addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (b) { $("#aiPrompt").value = b.textContent; $("#aiPrompt").focus(); }
      });

        // ההכתבה דורשת הקשר מאובטח (https או localhost) מלבד תמיכת הדפדפן
      if (speechSupported() && window.isSecureContext) {
        $("#aiMic").hidden = false;
        $("#aiMic").addEventListener("click", toggleDictation);
      }

      $("#aiFiles").addEventListener("change", (e) => {
        addFiles(e.target.files);
        e.target.value = "";          // אותו קובץ שוב צריך להפיק אירוע
      });
      $("#aiFileList").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-unattach]");
        if (!btn) return;
        attached.splice(Number(btn.dataset.unattach), 1);
        renderFiles();
      });

      $("#aiQCancel").addEventListener("click", close);
      $("#aiQSend").addEventListener("click", () => {
        const collected = collectAnswers();
        if (collected.some((a) => !a.answer)) {
          $("#aiQErr").textContent = "צריך לענות על כל השאלות. אם אין תשובה — \"לא יודע\".";
          $("#aiQErr").hidden = false;
          return;
        }
        $("#aiQErr").hidden = true;
        // התשובות מצטברות: בסבב שני המודל רואה גם את מה שענינו בראשון
        answers = answers.concat(collected);
        send();
      });

    $("#aiBtn").addEventListener("click", open);
      $("#aiClose").addEventListener("click", close);
      $("#aiCancel").addEventListener("click", close);
      $("#aiReject").addEventListener("click", close);
      $("#aiRetry").addEventListener("click", () => { step("aiAsk"); $("#aiPrompt").focus(); });
      $("#aiSend").addEventListener("click", send);

      $("#aiPrompt").addEventListener("keydown", (e) => {
        // Ctrl/Cmd+Enter שולח — Enter רגיל נשאר שורה חדשה
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
      });

      $("#aiOverlay").addEventListener("click", (e) => {
        if (e.target === $("#aiOverlay")) close();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !$("#aiOverlay").hidden) close();
      });

      $("#aiApply").addEventListener("click", async () => {
        if (!proposal) return;
        const p = proposal;
        proposal = null;
        // התוכנית נבנית לפני הסגירה: close() מנקה את הקבצים המצורפים
        const plan = docPlan(p);
        const expenses = p.expenses || [];
        const touchesTrip = (p.dayChanges || []).length || (p.flights || []).length;

        const trip = host.getTrip();
        undoDoc = touchesTrip ? clone(trip) : null;

        savedDocs = await host.onDocs(plan);
        if (touchesTrip) host.onApply(applyChangeSet(clone(trip), p), { undo: false });
        // focus: לאן לקפוץ אחרי ההחלה. כששונה גם המסלול, הוא מה שרוצים
        // לראות — ההוצאה נרשמה ברקע ואפשר לבדוק אותה בלשונית שלה
        savedExpenses = expenses.length
          ? await host.onExpenses(expenses, { focus: !touchesTrip })
          : [];

        close();
        undoBar(true, applyNote(p, touchesTrip, savedExpenses.length), true);
      });
    },

    // נחשפים לבדיקות
    applyChangeSet,
    renderDiff,
  };
})();
