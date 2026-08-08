import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { json, fail, num, CURRENCIES, type Currency } from "../lib/shared.mts";

/**
 * PUT /api/settings
 * מחליף את רשימת המטיילים ו/או את שערי ההמרה.
 * שני אלה קטנים ומשתנים נדיר, ולכן החלפה מלאה פשוטה ובטוחה יותר
 * מעדכון חלקי — ורצה בטרנזקציה כדי שלא תישאר רשימה חלקית.
 */
export default async (req: Request) => {
  if (req.method !== "PUT") return fail("שיטה לא נתמכת", 405);

  let body: { people?: unknown; rates?: unknown } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("גוף הבקשה אינו JSON תקין", 400);
  }
  if (!body) return fail("גוף הבקשה ריק", 400);

  const people = body.people === undefined ? null : parsePeople(body.people);
  if (typeof people === "string") return fail(people, 422);

  const rates = body.rates === undefined ? null : parseRates(body.rates);
  if (typeof rates === "string") return fail(rates, 422);

  if (people === null && rates === null) return fail("לא נשלח מה לעדכן", 422);

  const db = getDatabase();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    if (people) {
      await client.query("DELETE FROM travellers");
      for (const [i, p] of people.entries()) {
        await client.query(
          "INSERT INTO travellers (name, couple_group, sort_order) VALUES ($1, $2, $3)",
          [p.name, p.group, i + 1]
        );
      }
    }

    if (rates) {
      for (const [currency, value] of Object.entries(rates)) {
        await client.query(
          `INSERT INTO fx_rates (currency, ils_per_unit, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (currency)
           DO UPDATE SET ils_per_unit = EXCLUDED.ils_per_unit, updated_at = NOW()`,
          [currency, value]
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("settings: העדכון נכשל", err);
    return fail("שמירת ההגדרות נכשלה", 500);
  } finally {
    client.release();
  }

  return json({ people, rates });
};

function parsePeople(raw: unknown): { name: string; group: number }[] | string {
  if (!Array.isArray(raw)) return "people חייב להיות מערך";
  if (raw.length > 20) return "יותר מדי מטיילים";

  const seen = new Set<string>();
  const out: { name: string; group: number }[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) return "מטייל שאינו אובייקט";
    const name = String((item as Record<string, unknown>).name ?? "").trim();
    const group = num((item as Record<string, unknown>).group);

    if (!name || name.length > 40) return "שם מטייל חסר או ארוך מדי";
    if (seen.has(name)) return `המטייל "${name}" מופיע פעמיים`;
    if (!Number.isInteger(group) || group < 1 || group > 9) return "מספר זוג חייב להיות 1–9";

    seen.add(name);
    out.push({ name, group });
  }
  return out;
}

function parseRates(raw: unknown): Record<string, number> | string {
  if (typeof raw !== "object" || raw === null) return "rates חייב להיות אובייקט";

  const out: Record<string, number> = {};
  for (const [currency, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!CURRENCIES.includes(currency as Currency)) return `מטבע לא נתמך: ${currency}`;
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0 || v > 1000) return `שער לא חוקי עבור ${currency}`;
    out[currency] = v;
  }
  if (Object.keys(out).length === 0) return "לא נשלחו שערים";
  return out;
}

export const config: Config = {
  path: "/api/settings",
};
