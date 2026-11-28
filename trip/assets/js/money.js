/* =========================================================================
   המרת מטבע.

   כפתור צף פותח חלונית קטנה עם שני תאים: סכום ותוצאה. מקלידים באחד —
   השני מתעדכן מיד, ולהפך, כי בחנות לא תמיד יודעים לאיזה כיוון שואלים
   ("כמה זה בשקלים" מול "כמה לשים על הדלפק"). כפתור ⇅ מחליף בין המטבעות.

   השערים הם אותם שערים של האפליקציה — אלה שבלשונית ההוצאות ושמתעדכנים
   מהשכבה החיה. אין כאן מקור שני, ולכן אין סיכוי שההמרה בכיס תגיד דבר
   אחד והסיכום בטיול דבר אחר. השערים נשמרים ביחס לשקל, ולכן כל המרה
   עוברת דרכו: הסכום מתורגם לשקלים ומשם למטבע היעד.

   הכול מקומי ועובד אופליין — חישוב, בלי רשת ובלי שירות המרה.
   ========================================================================= */

const Converter = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  const PAIR_KEY = "fx:pair";
  const NAMES = {
    "₪": "שקל",
    "₾": "לארי",
    $: "דולר",
    "€": "אירו",
    "£": "שטרלינג",
  };

  let host = null;        // { getRates, getTrip }
  let from = "₾";
  let to = "₪";
  let last = "a";         // באיזה תא הקלידו אחרון — לפיו מחשבים מחדש

  const rates = () => host.getRates() || {};
  const rate = (sign) => Number(rates()[sign]) || 1;

  /* ------------------------------------------------------------------ */

  /**
   * המטבע המקומי של הטיול.
   * קודם מה שנקבע לטיול, אחריו המטבע הנפוץ ביותר בתכנון העלויות —
   * ששם הוא נקבע מהמציאות ולא מהגדרה — ורק אז ברירת מחדל.
   */
  function localCurrency() {
    const trip = host.getTrip() || {};
    const all = rates();
    if (trip.currency && trip.currency in all && trip.currency !== "₪") return trip.currency;

    const count = {};
    (trip.cost || []).forEach((group) =>
      (group.items || []).forEach((it) => {
        if (it.currency && it.currency !== "₪") count[it.currency] = (count[it.currency] || 0) + 1;
      })
    );
    const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    if (top && top[0] in all) return top[0];

    return Object.keys(all).find((c) => c !== "₪") || "$";
  }

  /** ההמרה עצמה: דרך השקל, כי כל השערים נשמרים ביחס אליו */
  const convert = (amount, a, b) => (amount * rate(a)) / rate(b);

  /** מספר קריא: בלי אפסים מיותרים, ועם יותר דיוק כשהסכום קטן */
  function show(n) {
    if (!Number.isFinite(n)) return "";
    const digits = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 1 ? 2 : 4;
    return n.toLocaleString("he-IL", { maximumFractionDigits: digits });
  }

  const num = (v) => {
    // מקלידים לפעמים פסיק עשרוני, ומקלדת עברית מכניסה רווחים דקים
    const clean = String(v || "").replace(/[\s,]/g, (c) => (c === "," ? "." : ""));
    const n = parseFloat(clean);
    return Number.isFinite(n) ? n : NaN;
  };

  /* ------------------------------------------------------------------ */

  function options(sel, chosen) {
    sel.innerHTML = Object.keys(rates())
      .map((c) => `<option value="${c}" ${c === chosen ? "selected" : ""}>${c} ${NAMES[c] || ""}</option>`)
      .join("");
  }

  /** שורת השער, כדי שיהיה ברור לפי מה חושב */
  function rateLine() {
    const one = convert(1, from, to);
    $("#fxRate").textContent = `1 ${from} = ${show(one)} ${to}`;
  }

  /** מחשב מחדש את התא שלא הקלידו בו */
  function calc(side) {
    last = side;
    const a = $("#fxA");
    const b = $("#fxB");

    if (side === "a") {
      const v = num(a.value);
      b.value = a.value.trim() === "" ? "" : Number.isNaN(v) ? "" : show(convert(v, from, to));
    } else {
      const v = num(b.value);
      a.value = b.value.trim() === "" ? "" : Number.isNaN(v) ? "" : show(convert(v, to, from));
    }
    rateLine();
  }

  function setPair(f, t) {
    from = f;
    to = t;
    options($("#fxFrom"), from);
    options($("#fxTo"), to);
    $("#fxBtn .fab__icon").textContent = from;
    localStorage.setItem(PAIR_KEY, JSON.stringify([from, to]));
  }

  /**
   * ⇅ — מחליף את המטבעות ואת הסכומים יחד.
   *
   * אין כאן חישוב מחדש כששני התאים מלאים, והסיבה מעשית: התוצאה המוצגת
   * מעוגלת, וחישוב ממנה בחזרה מחזיר 49.99 במקום 50. הזוג שהוחלף כבר
   * נכון — רק הכיוון התהפך.
   */
  function swap() {
    const a = $("#fxA").value;
    const b = $("#fxB").value;
    setPair(to, from);
    $("#fxA").value = b;
    $("#fxB").value = a;

    if (b === "" && a !== "") calc("b");
    else if (a === "" && b !== "") calc("a");
    else { last = last === "a" ? "b" : "a"; rateLine(); }
  }

  /* ------------------------------------------------------------------ */

  const isOpen = () => !$("#fxBox").hidden;

  function open() {
    // השערים מתעדכנים מהשכבה החיה, ולכן נקראים בכל פתיחה ולא פעם אחת
    options($("#fxFrom"), from);
    options($("#fxTo"), to);
    $("#fxBox").hidden = false;
    $("#fxBtn").setAttribute("aria-expanded", "true");
    calc(last);
    $("#fxA").focus();
    $("#fxA").select();
  }

  function close() {
    $("#fxBox").hidden = true;
    $("#fxBtn").setAttribute("aria-expanded", "false");
  }

  function init(hostApi) {
    host = hostApi;

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PAIR_KEY) || "null"); } catch { saved = null; }
    const all = rates();
    if (Array.isArray(saved) && saved[0] in all && saved[1] in all) setPair(saved[0], saved[1]);
    else setPair(localCurrency(), "₪");

    $("#fxBtn").addEventListener("click", () => (isOpen() ? close() : open()));
    $("#fxBox").addEventListener("click", (e) => {
      if (e.target.closest("[data-fx-close]")) close();
      if (e.target.closest("[data-fx-swap]")) swap();
    });

    $("#fxA").addEventListener("input", () => calc("a"));
    $("#fxB").addEventListener("input", () => calc("b"));
    $("#fxFrom").addEventListener("change", () => { setPair($("#fxFrom").value, to); calc(last); });
    $("#fxTo").addEventListener("change", () => { setPair(from, $("#fxTo").value); calc(last); });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) close();
    });
    document.addEventListener("click", (e) => {
      if (!isOpen()) return;
      if (e.target.closest("#fxBox") || e.target.closest("#fxBtn")) return;
      close();
    });
  }

  return { init, open, close, localCurrency };
})();
