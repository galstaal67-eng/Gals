/* =========================================================================
   שכבת הגישה לשרת.

   האתר עובד בשני מצבים:
   • מסונכרן — הפונקציות של Netlify זמינות, והמצב המשותף (הוצאות, מטיילים,
     שערים ותכנון העלויות) נשמר ב-Postgres ומשותף לכל המכשירים.
   • מקומי   — אין שרת (פתיחה של הקובץ מהדיסק, פריסה סטטית, או תקלת רשת),
     והכול ממשיך לעבוד מול localStorage בדיוק כמו קודם.

   הזיהוי אוטומטי: ניסיון קריאה אחד ל-/api/state בטעינה.
   ========================================================================= */

const TripAPI = (() => {
  "use strict";

  let online = false;
  const listeners = new Set();

  /** 'local' | 'syncing' | 'synced' | 'error' */
  let status = "local";

  function setStatus(next, detail = "") {
    status = next;
    listeners.forEach((fn) => {
      try { fn(next, detail); } catch (err) { console.warn("מאזין סטטוס נכשל:", err); }
    });
  }

  async function request(path, options = {}) {
    const res = await fetch(path, {
      headers: { "content-type": "application/json" },
      ...options,
    });

    if (!res.ok) {
      let message = `שגיאת שרת ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch { /* גוף שאינו JSON — נשארים עם הודעת ברירת המחדל */ }
      throw new Error(message);
    }

    return res.status === 204 ? null : res.json();
  }

  /**
   * עוטף מוטציה: מסמן "שומר…", ובכישלון מסמן שגיאה ומחזיר false
   * במקום לזרוק — הקורא ממשיך לעבוד מקומית.
   */
  async function mutate(fn, errorPrefix) {
    if (!online) return false;
    setStatus("syncing");
    try {
      const result = await fn();
      setStatus("synced");
      return result === undefined ? true : result;
    } catch (err) {
      console.error(errorPrefix, err);
      setStatus("error", err.message);
      return false;
    }
  }

  return {
    get isOnline() { return online; },
    get status() { return status; },

    onStatusChange(fn) { listeners.add(fn); },

    /**
     * בדיקה חד-פעמית בטעינה. מחזירה את המצב מהשרת, או null אם אין שרת.
     * כישלון כאן אינו שגיאה — הוא פשוט אומר "מצב מקומי".
     */
    async connect() {
      try {
        const state = await request("/api/state");
        online = true;
        setStatus("synced");
        return state;
      } catch (err) {
        online = false;
        setStatus("local", err.message);
        return null;
      }
    },

    async refresh() {
      if (!online) return null;
      try {
        const state = await request("/api/state");
        setStatus("synced");
        return state;
      } catch (err) {
        setStatus("error", err.message);
        return null;
      }
    },

    addExpense(expense) {
      return mutate(
        () => request("/api/expenses", { method: "POST", body: JSON.stringify(expense) }),
        "הוספת הוצאה נכשלה"
      );
    },

    addExpenses(items) {
      return mutate(
        () => request("/api/expenses/bulk", { method: "POST", body: JSON.stringify({ items }) }),
        "הוספת אצווה נכשלה"
      );
    },

    deleteExpense(id) {
      return mutate(
        () => request(`/api/expenses/${encodeURIComponent(id)}`, { method: "DELETE" }),
        "מחיקת הוצאה נכשלה"
      );
    },

    clearExpenses() {
      return mutate(
        () => request("/api/expenses", { method: "DELETE" }),
        "ניקוי ההוצאות נכשל"
      );
    },

    /**
     * שולח עריכות של שורות תכנון העלויות. מפתח עם ערך null נמחק בשרת,
     * כלומר השורה חוזרת לאומדן המקורי בכל המכשירים.
     */
    saveCost(overrides) {
      if (!overrides || Object.keys(overrides).length === 0) return false;
      return mutate(
        () => request("/api/cost", { method: "PUT", body: JSON.stringify({ overrides }) }),
        "שמירת תכנון העלויות נכשלה"
      );
    },

    saveSettings({ people, rates }) {
      const body = {};
      if (people) body.people = people;
      if (rates) body.rates = rates;
      return mutate(
        () => request("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
        "שמירת ההגדרות נכשלה"
      );
    },
  };
})();
