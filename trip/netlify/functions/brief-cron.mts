import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { writeCache } from "../lib/cache.mts";
import { buildBrief } from "../lib/brief.mts";

/**
 * רענון יומי של "מה קורה בעיר", לטיולים שקרובים או שכבר התחילו.
 *
 * הסיבה לקיומה: אם הרשימה נבנית רק כשפותחים את הלשונית, היא תמיד תהיה
 * בת רגע — וההתרעה על שביתה מחר תגיע רק אם במקרה פתחו את האפליקציה.
 * כך היא מוכנה בבוקר, והפתיחה הראשונה כבר רואה מידע עדכני.
 *
 * 04:37 UTC הוא 08:37 בטביליסי ו-06:37 בישראל — אחרי שהחדשות המקומיות
 * כבר פורסמו ולפני שיוצאים ליום.
 *
 * רק טיולים בחלון של יומיים אחורה עד עשרה ימים קדימה מרועננים. חיפוש
 * לטיול שעוד לא קרוב הוא בזבוז של כסף אמיתי.
 */

function windowed(doc: Record<string, unknown>): { from: string; to: string } | null {
  const meta = doc.meta as Record<string, unknown> | undefined;
  const from = String(meta?.startDate ?? "").slice(0, 10);
  const to = String(meta?.endDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;

  const day = 86_400_000;
  const now = Date.now();
  const starts = Date.parse(from);
  const ends = Date.parse(to);
  if (Number.isNaN(starts) || Number.isNaN(ends)) return null;

  if (ends < now - 2 * day) return null; // נגמר
  if (starts > now + 10 * day) return null; // עוד רחוק
  return { from, to };
}

export default async () => {
  let rows: Record<string, unknown>[] = [];
  try {
    const db = getDatabase();
    rows = (await db.sql`
      SELECT id, doc FROM trips WHERE deleted_at IS NULL
    `) as Record<string, unknown>[];
  } catch (err) {
    console.error("brief-cron: קריאת הטיולים נכשלה", err);
    return;
  }

  for (const row of rows) {
    const id = String(row.id);
    const doc = (row.doc || {}) as Record<string, unknown>;
    const span = windowed(doc);
    if (!span) continue;

    const meta = doc.meta as Record<string, unknown> | undefined;
    const title = String(meta?.title ?? "").slice(0, 80);
    if (!title) continue;

    const days = Array.isArray(doc.days) ? doc.days : [];
    const regions = [
      ...new Set(
        days
          .map((d) => String((d as Record<string, unknown>).region ?? ""))
          .filter(Boolean)
      ),
    ].slice(0, 12);

    try {
      const brief = await buildBrief({ title, from: span.from, to: span.to, regions });
      await writeCache(`brief:${id}`, brief);
      console.log(`brief-cron: ${id} עודכן · ${brief.items.length} פריטים`);
    } catch (err) {
      console.error(`brief-cron: ${id} נכשל`, err);
    }
  }
};

export const config: Config = {
  schedule: "37 4 * * *",
};
