import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { json, fail, num, isoDate } from "../lib/shared.mts";

/**
 * GET /api/state
 * מחזיר את כל המצב המשותף בבקשה אחת — הוצאות, מטיילים, שערים ותכנון העלויות.
 * הצורה זהה למבנה שהלקוח מחזיק ב-localStorage, כדי ששני המצבים
 * (מסונכרן ומקומי) ישתמשו באותו קוד רינדור.
 */
export default async (req: Request) => {
  if (req.method !== "GET") return fail("שיטה לא נתמכת", 405);

  try {
    const db = getDatabase();

    const [expenses, travellers, rates, costs] = await Promise.all([
      db.sql`
        SELECT id, spent_on, amount, currency, category, payer, note
        FROM expenses
        WHERE deleted_at IS NULL
        ORDER BY spent_on, created_at
      `,
      db.sql`SELECT name, couple_group FROM travellers ORDER BY sort_order, name`,
      db.sql`SELECT currency, ils_per_unit FROM fx_rates`,
      db.sql`SELECT item_key, low_amount, high_amount FROM cost_overrides`,
    ]);

    return json({
      expenses: expenses.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        date: isoDate(r.spent_on),
        amount: num(r.amount),
        currency: String(r.currency),
        category: String(r.category),
        payer: String(r.payer),
        note: String(r.note ?? ""),
      })),
      people: travellers.map((r: Record<string, unknown>) => ({
        name: String(r.name),
        group: num(r.couple_group),
      })),
      rates: Object.fromEntries(
        rates.map((r: Record<string, unknown>) => [String(r.currency), num(r.ils_per_unit)])
      ),
      // אותה צורה שהלקוח מחזיק: "groupKey:index" -> { low, high }.
      // שדה שלא נערך אינו מופיע כאן כלל, ולכן נופל לאומדן שב-data.js.
      costOverrides: Object.fromEntries(
        costs.map((r: Record<string, unknown>) => {
          const o: Record<string, number> = {};
          if (r.low_amount  !== null) o.low  = num(r.low_amount);
          if (r.high_amount !== null) o.high = num(r.high_amount);
          return [String(r.item_key), o];
        })
      ),
    });
  } catch (err) {
    console.error("state: קריאת המצב נכשלה", err);
    return fail("קריאת הנתונים מהשרת נכשלה", 500);
  }
};

export const config: Config = {
  path: "/api/state",
};
