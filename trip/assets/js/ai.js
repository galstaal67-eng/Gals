/* =========================================================================
   עוזר ה-AI — שינוי חופשי במסלול.

   הזרימה היא תמיד בקשה → הצעה → אישור, לעולם לא בקשה → שמירה. המודל מחזיר
   ערכת שינויים תחומה, האפליקציה מציירת ממנה "לפני ← אחרי", והמשתמש מאשר.
   אחרי ההחלה נשמר עותק של המסמך ופס הביטול מאפשר לחזור בלחיצה אחת.

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

  let host = null;          // { getTrip, onApply, esc }
  let proposal = null;      // ערכת השינויים שחוזרת מהשרת
  let undoDoc = null;       // עותק המסמך שלפני ההחלה
  let undoTimer = null;

  /* ------------------------------------------------------------------ */
  /*  עזרים                                                              */
  /* ------------------------------------------------------------------ */

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function step(which) {
    ["aiAsk", "aiBusy", "aiReview"].forEach((id) => {
      $("#" + id).hidden = id !== which;
    });
  }

  function showErr(msg) {
    const el = $("#aiErr");
    el.textContent = msg;
    el.hidden = !msg;
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
    });

    if (set.metaSubtitle) trip.meta.subtitle = set.metaSubtitle;

    // סך הק"מ הוא נגזרת — מחשבים מחדש במקום לתת למודל לעדכן אותו
    trip.meta.totalDrivingKm = trip.days.reduce((s, d) => s + (d.drive?.km || 0), 0);
    return trip;
  }

  /* ------------------------------------------------------------------ */
  /*  פס הביטול                                                          */
  /* ------------------------------------------------------------------ */

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
        if (!undoDoc) return;
        host.onApply(undoDoc, { undo: true });
        undoDoc = null;
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
    if (!instruction) return showErr("כתבו מה לשנות.");
    showErr("");

    const trip = host.getTrip();
    step("aiBusy");

    // יום־שלושה־ימים: הבקשות הארוכות לוקחות יותר, ושווה לומר את זה
    const slow = setTimeout(() => {
      $("#aiBusyNote").textContent = "בקשה מורכבת — עוד כמה שניות.";
    }, 7000);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction,
          doc: trip,
          context: host.getContext(),
          code: localStorage.getItem(CODE_KEY) || $("#aiCode").value || "",
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 401) {
          $("#aiCodeWrap").hidden = false;     // השרת דורש קוד — מבקשים אותו
          try { localStorage.removeItem(CODE_KEY); } catch { /* לא קריטי */ }
        }
        step("aiAsk");
        return showErr(data?.error || `הבקשה נכשלה (${res.status})`);
      }

      // קוד תקין — שומרים כדי לא לבקש אותו שוב
      const code = $("#aiCode").value.trim();
      if (code) { try { localStorage.setItem(CODE_KEY, code); } catch { /* לא קריטי */ } }

      proposal = data;
      $("#aiSummary").textContent = data.summary || "";
      $("#aiWarning").textContent = data.warning || "";
      $("#aiWarning").hidden = !data.warning;

      const expenses = data.expenses || [];
      const isExpense = data.kind === "expense" && expenses.length;
      $("#aiDiff").innerHTML = isExpense
        ? renderExpenses(expenses)
        : renderDiff(trip, data.dayChanges || []);
      // הכפתור אומר מה הוא עושה: רישום הוצאה אינו "שינוי במסלול"
      $("#aiApply").textContent = isExpense
        ? expenses.length > 1 ? `רשום ${expenses.length} הוצאות` : "רשום את ההוצאה"
        : "החל את השינוי";
      // אין מה להחיל כשהבקשה לא הובנה
      $("#aiApply").hidden = data.kind === "unclear" ||
        (!isExpense && !(data.dayChanges || []).length);
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

        if (p.kind === "expense" && (p.expenses || []).length) {
          close();
          const n = await host.onExpenses(p.expenses);
          // אין undoDoc כאן: הוצאה נמחקת מהטבלה שלה, לא בשחזור המסמך
          undoBar(true, n === 1 ? "הוצאה נרשמה" : `${n} הוצאות נרשמו`, false);
          return;
        }

        const trip = host.getTrip();
        undoDoc = clone(trip);
        host.onApply(applyChangeSet(clone(trip), p), { undo: false });
        undoBar(true, p.summary || "השינוי הוחל", true);
        close();
      });
    },

    // נחשפים לבדיקות
    applyChangeSet,
    renderDiff,
  };
})();
