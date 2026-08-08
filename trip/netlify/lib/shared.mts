/**
 * עזרים משותפים לפונקציות של אתר הטיול.
 * אין כאן לוגיקה גלובלית שרצה בטעינת המודול — הכול עטוף בפונקציות.
 */

export const CURRENCIES = ["£", "€", "$", "₪"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface ExpenseInput {
  date: string;
  amount: number;
  currency: Currency;
  category: string;
  payer: string;
  note: string;
}

export interface ExpenseRow {
  id: string;
  date: string;
  amount: number;
  currency: string;
  category: string;
  payer: string;
  note: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // הנתונים משתנים תוך כדי הטיול — אסור לשמור אותם במטמון קצה
      "cache-control": "no-store",
    },
  });
}

export function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/** NUMERIC של Postgres חוזר כמחרוזת דרך pg — ממירים במקום אחד */
export function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

/** DATE חוזר כאובייקט Date; מחזירים yyyy-mm-dd בלי הסחת אזור זמן */
export function isoDate(v: unknown): string {
  if (v instanceof Date) {
    return [
      v.getUTCFullYear(),
      String(v.getUTCMonth() + 1).padStart(2, "0"),
      String(v.getUTCDate()).padStart(2, "0"),
    ].join("-");
  }
  return String(v ?? "").slice(0, 10);
}

/**
 * מאמת הוצאה שהגיעה מהלקוח. מחזיר את הערך המנוקה או הודעת שגיאה —
 * לעולם לא סומך על מה שנשלח.
 */
export function parseExpense(raw: unknown): ExpenseInput | string {
  if (typeof raw !== "object" || raw === null) return "גוף הבקשה אינו אובייקט";
  const r = raw as Record<string, unknown>;

  const date = String(r.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "תאריך חייב להיות בפורמט yyyy-mm-dd";
  if (Number.isNaN(Date.parse(date))) return "תאריך אינו חוקי";

  const amount = Number(r.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "סכום חייב להיות מספר חיובי";
  if (amount > 1_000_000) return "סכום גדול מדי";

  const currency = String(r.currency ?? "");
  if (!CURRENCIES.includes(currency as Currency)) return "מטבע לא נתמך";

  const category = String(r.category ?? "").trim();
  if (!category || category.length > 40) return "סעיף הוצאה חסר או ארוך מדי";

  const payer = String(r.payer ?? "").trim();
  if (!payer || payer.length > 40) return "משלם חסר או ארוך מדי";

  const note = String(r.note ?? "").trim().slice(0, 500);

  return { date, amount, currency: currency as Currency, category, payer, note };
}

export interface CostOverride {
  low: number | null;
  high: number | null;
}

/**
 * מאמת את מפת עריכות תכנון העלויות.
 * ערך null עבור מפתח פירושו "מחק את השורה" — כך שדה שרוקנו חוזר לאומדן
 * המקורי בכל המכשירים, ולא רק במכשיר שבו נמחק.
 *
 * שימו לב: low > high אינו נחשב שגיאה. המשתמש מקליט שדה אחד בכל פעם,
 * ובאמצע ההקלדה הטווח יכול להיות הפוך לרגע — דחייה כאן הייתה הופכת
 * את השדה לבלתי ניתן לעריכה.
 */
export function parseCostOverrides(
  raw: unknown
): Record<string, CostOverride | null> | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "overrides חייב להיות אובייקט";
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return "לא נשלחו עריכות";
  if (entries.length > 200) return "יותר מדי עריכות";

  const out: Record<string, CostOverride | null> = {};

  for (const [key, value] of entries) {
    if (!/^[a-z_]+:\d+$/.test(key) || key.length > 40) return `מפתח שורה לא חוקי: ${key}`;

    if (value === null) { out[key] = null; continue; }
    if (typeof value !== "object" || Array.isArray(value)) return `ערך לא חוקי עבור ${key}`;

    const v = value as Record<string, unknown>;
    const low = bound(v.low);
    const high = bound(v.high);
    if (typeof low === "string") return `${low} עבור ${key}`;
    if (typeof high === "string") return `${high} עבור ${key}`;
    if (low === null && high === null) return `שורה ריקה עבור ${key}`;

    out[key] = { low, high };
  }
  return out;
}

/** מספר אופציונלי בתחום סביר, או null כשהשדה ריק */
function bound(v: unknown): number | null | string {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "סכום חייב להיות מספר אי-שלילי";
  if (n > 1_000_000) return "סכום גדול מדי";
  return n;
}

/** UUID v4 — crypto.randomUUID זמין בסביבת ההרצה של פונקציות Netlify */
export function newId(): string {
  return crypto.randomUUID();
}
