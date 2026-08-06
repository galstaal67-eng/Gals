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

/** UUID v4 — crypto.randomUUID זמין בסביבת ההרצה של פונקציות Netlify */
export function newId(): string {
  return crypto.randomUUID();
}
