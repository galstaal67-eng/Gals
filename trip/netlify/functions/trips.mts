import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { json, fail } from "../lib/shared.mts";

/**
 * /api/trips — המסמכים של הטיולים עצמם.
 *
 * GET    מחזיר את כל הטיולים שלא נמחקו, כדי שמכשיר חדש יקבל אותם מיד.
 * POST   שומר מסמך טיול שלם (upsert).
 * DELETE מוחק טיול. המחיקה רכה כאן, אבל ההוצאות נמחקות בפועל דרך ה-FK
 *        שהוגדר ON DELETE CASCADE — ולכן אנו מוחקים את השורה ממש.
 *
 * המסמך נשמר כ-JSONB שלם ולא מפורק לעמודות: המבנה שלו מתפתח (ימים, טיפים,
 * תכנון עלויות), והאפליקציה ממילא קוראת אותו כיחידה אחת.
 *
 * הכרעת התנגשות היא "העדכני מנצח" לפי updatedAt שהלקוח שולח. זה מספיק כאן:
 * שני אנשים עורכים טיול אחד לעיתים נדירות, ובהוצאות — החלק שבאמת נערך
 * במקביל — העדכון ממילא נקודתי ולא החלפה מלאה.
 */

interface TripBody {
  id?: unknown;
  doc?: unknown;
  updatedAt?: unknown;
}

const ID_RE = /^[\p{L}\p{N}-]{1,80}$/u;

export default async (req: Request) => {
  const db = getDatabase();

  /* ------------------------------------------------------------ GET */
  if (req.method === "GET") {
    try {
      const rows = await db.sql`
        SELECT id, doc, updated_at
          FROM trips
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC
      `;
      return json(
        rows.map((r: Record<string, unknown>) => ({
          id: String(r.id),
          doc: r.doc,
          updatedAt: new Date(String(r.updated_at)).toISOString(),
        }))
      );
    } catch (err) {
      console.error("trips: הקריאה נכשלה", err);
      return fail("טעינת הטיולים נכשלה", 500);
    }
  }

  /* ----------------------------------------------------------- POST */
  if (req.method === "POST") {
    let body: TripBody | null;
    try {
      body = (await req.json()) as TripBody;
    } catch {
      return fail("גוף הבקשה אינו JSON תקין", 400);
    }
    if (!body) return fail("גוף הבקשה ריק", 400);

    const id = String(body.id ?? "").trim();
    if (!ID_RE.test(id)) return fail("מזהה טיול לא תקין", 422);

    const doc = body.doc;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      return fail("מסמך הטיול חסר או אינו אובייקט", 422);
    }
    // גבול שפוי: מסמך תקין הוא עשרות קילובייטים, לא מגה־בייטים
    const raw = JSON.stringify(doc);
    if (raw.length > 512_000) return fail("מסמך הטיול גדול מדי", 413);

    const updatedAt = String(body.updatedAt ?? "") || new Date().toISOString();
    if (Number.isNaN(Date.parse(updatedAt))) return fail("חותמת זמן לא תקינה", 422);

    try {
      await db.sql`
        INSERT INTO trips (id, doc, updated_at)
        VALUES (${id}, ${raw}::jsonb, ${updatedAt})
        ON CONFLICT (id) DO UPDATE
          SET doc        = EXCLUDED.doc,
              updated_at = EXCLUDED.updated_at,
              deleted_at = NULL
        -- העדכני מנצח: כתיבה ישנה מהמצב השמור אינה דורסת אותו
        WHERE trips.updated_at <= EXCLUDED.updated_at
      `;
      return json({ id, updatedAt });
    } catch (err) {
      console.error("trips: השמירה נכשלה", err);
      return fail("שמירת הטיול נכשלה", 500);
    }
  }

  /* --------------------------------------------------------- DELETE */
  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
    if (!ID_RE.test(id)) return fail("מזהה טיול לא תקין", 422);
    try {
      await db.sql`DELETE FROM trips WHERE id = ${id}`;
      return json({ id, deleted: true });
    } catch (err) {
      console.error("trips: המחיקה נכשלה", err);
      return fail("מחיקת הטיול נכשלה", 500);
    }
  }

  return fail("שיטה לא נתמכת", 405);
};

export const config: Config = {
  path: "/api/trips",
};
