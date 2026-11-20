import { getDatabase } from "@netlify/database";

/**
 * מטמון משותף למקורות החיצוניים.
 *
 * הוא יושב במסד ולא בזיכרון הפונקציה בכוונה: פונקציה חסרת־מצב מתחילה
 * קרה, ושני טלפונים שפותחים את האפליקציה באותו בוקר צריכים לקבל את
 * אותה תשובה בלי לקרוא פעמיים לכל שירות חיצוני.
 */

export interface Cached {
  doc: unknown;
  ageMs: number;
  fetchedAt: string;
}

export async function readCache(key: string): Promise<Cached | null> {
  try {
    const db = getDatabase();
    const rows = await db.sql`
      SELECT doc, fetched_at FROM live_cache WHERE key = ${key}
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const fetchedAt = new Date(String(row.fetched_at));
    return {
      doc: row.doc,
      ageMs: Date.now() - fetchedAt.getTime(),
      fetchedAt: fetchedAt.toISOString(),
    };
  } catch (err) {
    // מטמון שלא נקרא אינו סיבה להפיל בקשה — פשוט מביאים מחדש
    console.error("cache: קריאה נכשלה", err);
    return null;
  }
}

export async function writeCache(key: string, doc: unknown): Promise<void> {
  try {
    const db = getDatabase();
    const raw = JSON.stringify(doc);
    await db.sql`
      INSERT INTO live_cache (key, doc, fetched_at)
      VALUES (${key}, ${raw}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
        SET doc = EXCLUDED.doc, fetched_at = EXCLUDED.fetched_at
    `;
  } catch (err) {
    console.error("cache: כתיבה נכשלה", err);
  }
}
