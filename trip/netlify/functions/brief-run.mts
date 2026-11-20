import type { Config } from "@netlify/functions";
import { tripIdOf } from "../lib/shared.mts";
import { readCache, writeCache } from "../lib/cache.mts";
import { buildBrief } from "../lib/brief.mts";

/**
 * POST /api/brief-run?trip=<id> — בונה מחדש את "מה קורה בעיר".
 *
 * פונקציית רקע: הלקוח מקבל 202 מיד, והעבודה ממשיכה עד 15 דקות. זה הכרחי
 * כאן — סבב חיפוש ברשת חוצה בקלות את תקרת הזמן של בקשה רגילה, ואין סיבה
 * שמישהו יחזיק מסך טעינה בזמן הזה. התוצאה נכתבת למטמון, והלקוח קורא
 * אותה ב-/api/live.
 *
 * מכיוון שאין למי להחזיר שגיאה, כישלון נכתב גם הוא למטמון — עדיף שהמסך
 * יגיד "החיפוש נכשל" מאשר שיישאר ריק בלי הסבר.
 */

const FRESH_MS = 6 * 60 * 60_000;

export default async (req: Request) => {
  const tripId = tripIdOf(req);
  if (!tripId) return;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* גוף ריק הוא מצב תקין — ממשיכים עם ברירות המחדל */
  }

  const gate = process.env.AI_ACCESS_CODE?.trim();
  if (gate && String(body.code ?? "").trim() !== gate) return;

  const key = `brief:${tripId}`;
  if (!body.force) {
    const hit = await readCache(key);
    if (hit && hit.ageMs < FRESH_MS) return;
  }

  const title = String(body.title ?? "").slice(0, 80);
  const from = String(body.from ?? "").slice(0, 10);
  const to = String(body.to ?? "").slice(0, 10);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;

  const regions = Array.isArray(body.regions)
    ? body.regions.slice(0, 12).map((r) => String(r).slice(0, 40))
    : [];

  try {
    const brief = await buildBrief({ title, from, to, regions });
    await writeCache(key, brief);
  } catch (err) {
    console.error("brief-run: נכשל", err);
    await writeCache(key, {
      summary: "",
      items: [],
      generatedAt: new Date().toISOString(),
      note: `החיפוש נכשל: ${(err as Error).message}`,
    });
  }
};

export const config: Config = {
  path: "/api/brief-run",
  background: true,
};
