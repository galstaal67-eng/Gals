import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { json, fail, num, isoDate, newId, parseExpense } from "../lib/shared.mts";

/**
 * POST   /api/expenses          הוספת הוצאה אחת
 * POST   /api/expenses/bulk     הוספת אצווה (ייבוא CSV / העלאת נתונים מקומיים)
 * DELETE /api/expenses/:id      מחיקה רכה של רשומה
 * DELETE /api/expenses          מחיקה רכה של הכול
 */
export default async (req: Request, context: Context) => {
  const db = getDatabase();
  const id = context.params?.id;

  try {
    if (req.method === "POST" && id === "bulk") return await addBulk(db, req);
    if (req.method === "POST") return await addOne(db, req);
    if (req.method === "DELETE" && id) return await softDelete(db, id);
    if (req.method === "DELETE") return await softDeleteAll(db);
    return fail("שיטה לא נתמכת", 405);
  } catch (err) {
    console.error("expenses: הפעולה נכשלה", err);
    return fail("הפעולה נכשלה בשרת", 500);
  }
};

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

async function addOne(db: ReturnType<typeof getDatabase>, req: Request) {
  const parsed = parseExpense(await readJson(req));
  if (typeof parsed === "string") return fail(parsed, 422);

  const id = newId();
  const [row] = await db.sql`
    INSERT INTO expenses (id, spent_on, amount, currency, category, payer, note)
    VALUES (${id}, ${parsed.date}, ${parsed.amount}, ${parsed.currency},
            ${parsed.category}, ${parsed.payer}, ${parsed.note})
    RETURNING id, spent_on, amount, currency, category, payer, note
  `;

  return json(
    {
      id: String(row.id),
      date: isoDate(row.spent_on),
      amount: num(row.amount),
      currency: String(row.currency),
      category: String(row.category),
      payer: String(row.payer),
      note: String(row.note ?? ""),
    },
    201
  );
}

async function addBulk(db: ReturnType<typeof getDatabase>, req: Request) {
  const body = (await readJson(req)) as { items?: unknown } | null;
  const items = body?.items;
  if (!Array.isArray(items)) return fail("נדרש שדה items שהוא מערך", 422);
  if (items.length === 0) return json({ added: 0 });
  if (items.length > 500) return fail("יותר מ-500 רשומות בבקשה אחת", 413);

  // מאמתים הכול לפני שכותבים משהו — אצווה חלקית גרועה מאצווה שנדחתה
  const clean = [];
  for (const [i, raw] of items.entries()) {
    const parsed = parseExpense(raw);
    if (typeof parsed === "string") return fail(`רשומה ${i + 1}: ${parsed}`, 422);
    clean.push(parsed);
  }

  const values = db.sql.values(
    clean.map((e) => [newId(), e.date, e.amount, e.currency, e.category, e.payer, e.note])
  );
  await db.sql`
    INSERT INTO expenses (id, spent_on, amount, currency, category, payer, note)
    VALUES ${values}
  `;

  return json({ added: clean.length }, 201);
}

async function softDelete(db: ReturnType<typeof getDatabase>, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("מזהה לא חוקי", 422);

  const rows = await db.sql`
    UPDATE expenses SET deleted_at = NOW()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id
  `;
  if (rows.length === 0) return fail("הרשומה לא נמצאה", 404);
  return new Response(null, { status: 204 });
}

async function softDeleteAll(db: ReturnType<typeof getDatabase>) {
  const rows = await db.sql`
    UPDATE expenses SET deleted_at = NOW()
    WHERE deleted_at IS NULL
    RETURNING id
  `;
  return json({ deleted: rows.length });
}

export const config: Config = {
  path: ["/api/expenses", "/api/expenses/:id"],
};
