import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { json, fail, parseCostOverrides } from "../lib/shared.mts";

/**
 * PUT /api/cost
 * מעדכן עריכות של שורות בתכנון העלויות.
 *
 * בניגוד ל-/api/settings, כאן העדכון נקודתי ולא החלפה מלאה: שני בני הזוג
 * עורכים שורות שונות באותו זמן (אחד סוגר מלון, השני רכב), והחלפה מלאה
 * מתמונת מצב ישנה הייתה מוחקת את העריכה של השני.
 *
 * גוף הבקשה: { overrides: { "hotels:3": { low, high } | null } }
 * ערך null מוחק את השורה — כלומר מחזיר אותה לאומדן המקורי מ-data.js.
 */
export default async (req: Request) => {
  if (req.method !== "PUT") return fail("שיטה לא נתמכת", 405);

  let body: { overrides?: unknown } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("גוף הבקשה אינו JSON תקין", 400);
  }
  if (!body) return fail("גוף הבקשה ריק", 400);

  const overrides = parseCostOverrides(body.overrides);
  if (typeof overrides === "string") return fail(overrides, 422);

  const db = getDatabase();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) {
        await client.query("DELETE FROM cost_overrides WHERE item_key = $1", [key]);
        continue;
      }
      await client.query(
        `INSERT INTO cost_overrides (item_key, low_amount, high_amount, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (item_key) DO UPDATE
           SET low_amount  = EXCLUDED.low_amount,
               high_amount = EXCLUDED.high_amount,
               updated_at  = NOW()`,
        [key, value.low, value.high]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("cost: העדכון נכשל", err);
    return fail("שמירת תכנון העלויות נכשלה", 500);
  } finally {
    client.release();
  }

  return json({ overrides });
};

export const config: Config = {
  path: "/api/cost",
};
