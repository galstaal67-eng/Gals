/* =========================================================================
   מסמכי הטיול — כרטיסי טיסה, כרטיסים להופעות, אישורי לינה, וכל מידע
   שרוצים להחזיק בהישג יד בטיול.

   **המסמכים נשמרים במכשיר ולא בשרת.** זו לא פשרה אלא החלטה:

   1. פרטיות. כרטיס עלייה למטוס מכיל שם מלא ומספר הזמנה, ואישור לינה מכיל
      כתובת. ה-API של האתר פתוח לכל מי שיש לו את הכתובת — ואין שום סיבה
      להעמיד מסמכים כאלה שם.
   2. אופליין. IndexedDB עובד בלי רשת. ה-Wi-Fi בשדה התעופה או בכניסה
      לאולם לא יחליט אם אפשר להציג את הכרטיס.

   המשמעות היא שהמסמכים אינם מסתנכרנים בין מכשירים: כל אחד מעלה את
   הכרטיס שלו למכשיר שלו. **פרטי** הטיול שנקראו מהמסמך — שעת טיסה, מושב,
   שעת הופעה — כן נכנסים למסמך הטיול ולכן כן מסתנכרנים לכולם.

   המאגר הוא אותו מאגר שלשונית הטיסות השתמשה בו מאז שהיא נבנתה; כאן הוא
   רק הוכלל כדי לשרת כל סוג מסמך ולהיקשר ליום במסלול.
   ========================================================================= */

const TripDocs = (() => {
  const DB = "trip-docs";
  const STORE = "docs";
  const MAX_BYTES = 8 * 1024 * 1024;   // תקרה שפויה למסמך; מעבר לזה כנראה צילום מסך ענק

  /**
   * התוויות של סוגי המסמכים.
   *
   * boarding/ticket/other הם הסוגים שלשונית הטיסות כותבת מאז ומתמיד,
   * והם נשארים כפי שהם כדי שמסמכים שהועלו קודם ימשיכו להיקרא נכון.
   * השאר הם מה שהעוזר מסוגל לזהות במסמך שהועלה אליו.
   */
  const KINDS = {
    boarding:  "כרטיס עלייה למטוס",   // לשונית הטיסות
    ticket:    "כרטיס טיסה",          // לשונית הטיסות
    flight:    "כרטיס טיסה",          // העוזר
    event:     "כרטיס כניסה",
    attraction:"כרטיס לאתר",
    lodging:   "אישור לינה",
    transport: "תחבורה",
    rental:    "השכרת רכב",
    insurance: "ביטוח",
    info:      "מידע",
    other:     "מסמך",
  };

  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("trip", "tripId");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out?.result ?? out);
      t.onerror = () => reject(t.error);
    });
  }

  const newId = () =>
    crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

  /** מספר יום חוקי, או null. המודל יכול להחזיר 0 או מספר מחוץ לטווח. */
  function dayOf(v, dayCount) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) return null;
    if (dayCount && n > dayCount) return null;
    return n;
  }

  return {
    available: () => typeof indexedDB !== "undefined",
    KINDS,
    label: (kind) => KINDS[kind] || KINDS.other,
    dayOf,

    /** כל המסמכים של טיול, ממוינים לפי זמן העלאה */
    async list(tripId) {
      const all = await tx("readonly", (os) => os.getAll());
      return (all || [])
        .filter((d) => d.tripId === tripId)
        .sort((a, b) => (a.addedAt || "").localeCompare(b.addedAt || ""));
    },

    /**
     * המסמכים שנקשרו ליום מסוים.
     * זה מה שמאפשר לפתוח את כרטיס יום 3 ולראות שם את הכרטיס להופעה.
     */
    async forDay(tripId, n) {
      const all = await this.list(tripId);
      return all.filter((d) => Number(d.dayN) === Number(n));
    },

    /**
     * meta: { leg, kind, who, title, dayN, note }
     * כל השדות אופציונליים — קובץ שמועלה ביד בלשונית הטיסות מגיע עם
     * leg ו-kind, ומסמך שהעוזר קרא מגיע גם עם כותרת, יום והערה.
     */
    async add(tripId, { file, leg = null, kind = "other", who = "", title = "", dayN = null, note = "" }) {
      if (!file) throw new Error("לא נבחר קובץ.");
      if (file.size > MAX_BYTES) {
        throw new Error(`הקובץ גדול מדי (${Math.round(file.size / 1048576)}MB). עד 8MB.`);
      }
      const doc = {
        id: newId(),
        tripId, leg, kind, who,
        // הכותרת היא מה שמוצג; שם הקובץ נשמר בנפרד כדי שתמיד יהיה אפשר
        // לזהות את המקור, גם אם הכותרת שהעוזר נתן אינה מדויקת
        title: String(title || "").trim() || file.name,
        name: file.name,
        dayN,
        note: String(note || "").trim(),
        type: file.type || "application/octet-stream",
        size: file.size,
        addedAt: new Date().toISOString(),
        blob: file,                       // IndexedDB שומר Blob כמו שהוא
      };
      await tx("readwrite", (os) => os.put(doc));
      return doc;
    },

    /** עדכון שדות מטא בלבד. הקובץ עצמו אינו משתנה אחרי העלאה. */
    async patch(id, fields) {
      const doc = await tx("readonly", (os) => os.get(id));
      if (!doc) return null;
      const next = { ...doc };
      // `at` היא שעת האירוע שהמסמך שייך לו — מה שקובע מתי הכרטיס
      // קופץ מעצמו בקוביה. ריק פירושו "תגזור מלוח הזמנים".
      ["title", "kind", "dayN", "note", "leg", "who", "at"].forEach((k) => {
        if (k in fields) next[k] = fields[k];
      });
      await tx("readwrite", (os) => os.put(next));
      return next;
    },

    async remove(id) {
      await tx("readwrite", (os) => os.delete(id));
    },

    /** מחיקה של כמה מסמכים — מה שביטול של הצעה מהעוזר צריך */
    async removeMany(ids) {
      for (const id of ids || []) {
        try { await this.remove(id); } catch { /* מסמך שכבר נמחק */ }
      }
    },

    async get(id) {
      return tx("readonly", (os) => os.get(id));
    },

    /** base64 נקי בלי התחילית — מה שה-API של Claude מצפה לו */
    async toBase64(file) {
      const buf = await file.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      const CHUNK = 0x8000;             // קריאה ישירה על מערך גדול שוברת את המחסנית
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return btoa(bin);
    },
  };
})();
