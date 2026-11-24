/* =========================================================================
   הליווי הפעיל — החבר/ה שבודק/ת גם כשלא שואלים.

   עד כאן הקוביה ידעה לענות כששואלים אותה. כאן היא מתחילה ליזום: כל פרק
   זמן שנבחר היא בודקת ברשת מה השתנה במה שרלוונטי לשעות הקרובות — עיכוב
   בטיסה, שער שהתחלף, מעבר הררי שנסגר, שביתה, מזג אוויר שמשנה את היום —
   ואם מצאה משהו שמצדיק הפרעה, היא אומרת.

   ── ארבע רמות ──
   מלאה (15 דק') · חלקית (שעה) · שקטה (4 שעות) · ללא.
   ברירת המחדל היא **ללא**: בדיקה עולה כסף אמיתי בכל פעם, וזו החלטה של
   המשתמש ולא של הקוד.

   ── מה שצריך לדעת על "רקע" ──
   הבדיקה רצה כל עוד האפליקציה פתוחה, גם בלשונית מוסתרת. טלפון שנעול
   משהה את הטיימר, ולכן בחזרה למסך נעשית **בדיקת השלמה** אם עבר מספיק
   זמן. ליווי אמיתי גם כשהאפליקציה סגורה דורש Service Worker עם Web Push
   ובדיקה מתוזמנת בשרת — זה השלב הבא, ולא מה שיש כאן.

   ── שתיקה היא תשובה ──
   מה שחוזר נשמר רק אם הוא חדש ומצדיק הפרעה. בדיקה שלא מצאה כלום אינה
   מייצרת שורה, אינה מצלצלת, ואינה נספרת. חבר שמדבר כל רבע שעה בלי סיבה
   מפסיק להיות חבר.
   ========================================================================= */

const TripWatch = (() => {
  const LEVEL_KEY = "watch:level";
  const TOPIC_KEY = "watch:topics";
  const LOG_KEY = "watch:log";
  const LAST_KEY = "watch:last";

  const LEVELS = [
    { key: "full", label: "מלאה", every: 15, note: "בדיקה כל רבע שעה" },
    { key: "partial", label: "חלקית", every: 60, note: "בדיקה כל שעה" },
    { key: "quiet", label: "שקטה", every: 240, note: "בדיקה כל ארבע שעות" },
    { key: "off", label: "ללא", every: 0, note: "בודק רק כשלוחצים" },
  ];

  let host = null;        // { context(), onFound() }
  let timer = null;
  let running = false;
  let log = [];           // מה שנמצא, החדש ראשון

  const level = () => localStorage.getItem(LEVEL_KEY) || "off";
  const levelOf = (k) => LEVELS.find((l) => l.key === k) || LEVELS[3];

  /* ------------------------------------------------------------------ */

  function load() {
    try {
      log = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    } catch {
      log = [];
    }
  }

  function save() {
    // עשרים אחרונים מספיקים; מעבר לזה זו היסטוריה שאיש לא קורא
    log = log.slice(0, 20);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch { /* מלא */ }
  }

  /** חתימה פשוטה, כדי לא לחזור על אותה ידיעה שוב ושוב */
  const sign = (s) =>
    String(s || "").replace(/[^֐-׿a-z0-9]/gi, "").slice(0, 60).toLowerCase();

  /* ------------------------------------------------------------------ */

  /**
   * הנושאים שאפשר לבקש מהחבר להביא.
   *
   * הם **מוסיפים** ואינם מחליפים: מה שקשור לטיסה, להגעה מהשדה למלון
   * ולחזרה לשדה נבדק תמיד, בלי קשר למה שסומן כאן. אלה הדברים שאי אפשר
   * לפספס, והם לא עניין של טעם.
   */
  const TOPICS = [
    { key: "sights", icon: "📷", label: "אתרים לראות" },
    { key: "food", icon: "🍽️", label: "מסעדות" },
    { key: "bars", icon: "🍷", label: "ברים" },
    { key: "shopping", icon: "🛍️", label: "קניות" },
    { key: "general", icon: "💡", label: "כללי" },
  ];

  function topics() {
    try {
      const raw = JSON.parse(localStorage.getItem(TOPIC_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((k) => TOPICS.some((t) => t.key === k)) : [];
    } catch {
      return [];
    }
  }

  function toggleTopic(key) {
    const now = topics();
    const next = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
    localStorage.setItem(TOPIC_KEY, JSON.stringify(next));
  }

  /** השאלה שנשלחת בבדיקה היזומה: קודם הליבה, ואז מה שמעניין */
  function question() {
    const core =
      "קודם כל בדוק את מה שאסור לפספס: עיכוב או שינוי בטיסה, שער עלייה, " +
      "שעת המראה מעודכנת, דרכים להגיע מהשדה למלון או חזרה לשדה, כביש או " +
      "מעבר שנסגר, שביתה, מזג אוויר חריג, או סגירה במקום שאנחנו אמורים " +
      "להיות בו. כל אלה הם alert=true.";

    const picked = topics();
    if (!picked.length) return core;

    const names = TOPICS.filter((t) => picked.includes(t.key)).map((t) => t.label).join(", ");
    return (
      core +
      ` אם אין שום דבר כזה, תן דבר אחד ששווה לדעת עכשיו בנושאים: ${names}. ` +
      "משהו קונקרטי וקרוב למקום שאנחנו בו, עם שם ומחיר או שעה — ולא המלצה " +
      "כללית. טיפ כזה הוא alert=false. אם גם אין טיפ טוב, שתוק."
    );
  }

  async function check(manual) {
    if (running) return null;
    running = true;
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: question(),
          mode: "watch",
          code: localStorage.getItem("ai:code") || "",
          context: host.context(),
        }),
      });
      const out = await TripAPI.readJson(res);
      localStorage.setItem(LAST_KEY, String(Date.now()));
      if (!res.ok || !out || out.error) return null;

      /*
       * שתיקה מזוהה לפי bullets ריק — כך הפרומפט מורה לסמן "אין מה לומר".
       * טיפ בנושא שסומן אינו דחוף (alert=false) אבל כן נשמר ומוצג; מה
       * שמבדיל ביניהם הוא הצלצול, לא הנוכחות.
       */
      const empty = !(out.bullets || []).length;
      if (empty && !manual) return null;

      const id = sign(out.headline);
      if (log.some((x) => x.id === id)) return null;      // כבר נאמר

      const found = {
        id,
        at: Date.now(),
        headline: out.headline,
        bullets: (out.bullets || []).slice(0, 4),
        caution: out.caution || "",
        sources: (out.sources || []).slice(0, 3),
        alert: Boolean(out.alert),
      };
      log.unshift(found);
      save();
      notify(found);
      host.onFound(found);
      return found;
    } catch {
      return null;        // אין רשת, או השרת לא ענה — ננסה בפעם הבאה
    } finally {
      running = false;
    }
  }

  /** התראה רק על מה שמצדיק אותה, ורק בשעות שבהן זה הוגן */
  function notify(found) {
    if (!found.alert) return;
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 7) return;         // לילה
    try {
      if (window.Notification && Notification.permission === "granted") {
        new Notification("החבר המלווה", { body: found.headline, tag: "watch" });
      }
    } catch { /* דפדפן בלי התראות */ }
  }

  /* ------------------------------------------------------------------ */

  function due() {
    const every = levelOf(level()).every;
    if (!every) return false;
    const last = Number(localStorage.getItem(LAST_KEY) || 0);
    return Date.now() - last >= every * 60_000;
  }

  function schedule() {
    clearInterval(timer);
    timer = null;
    const every = levelOf(level()).every;
    if (!every) return;
    // בודקים את התנאי כל דקה ולא כל רבע שעה: טיימר ארוך בלשונית מוסתרת
    // נחנק בדפדפנים ניידים, וטיימר קצר שבודק שעון אמיתי שורד את זה
    timer = setInterval(() => { if (due()) check(false); }, 60_000);
    if (due()) check(false);
  }

  function setLevel(key) {
    localStorage.setItem(LEVEL_KEY, levelOf(key).key);
    schedule();
  }

  function init(hostApi) {
    host = hostApi;
    load();
    schedule();

    // חזרה למסך אחרי שהטלפון היה נעול: הטיימר הושהה, וזו ההשלמה
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && due()) check(false);
    });
  }

  return {
    init,
    LEVELS,
    TOPICS,
    topics,
    toggleTopic,
    level,
    levelOf,
    setLevel,
    check,                       // בדיקה ידנית, מכפתור
    found: () => log.slice(),
    clear() { log = []; save(); },
    dismiss(id) { log = log.filter((x) => x.id !== id); save(); },
  };
})();
