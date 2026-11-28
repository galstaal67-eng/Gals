import type { Config } from "@netlify/functions";
import { fail, resolveApiKey, streamJson } from "../lib/shared.mts";
import { resolvePlaces } from "../lib/places.mts";
import { placesFromPlan } from "../lib/from-plan.mts";

/**
 * POST /api/places — התאמת נקודות המפה של יום ללוח הזמנים שלו.
 *
 * ── למה זה קיים ──
 * ליום יש שני ייצוגים: `plan`, לוח הזמנים שאנשים קוראים, ו-`points`,
 * רשימת המקומות עם הקואורדינטות. מהראשון נבנה התכנון היומי; מהשני
 * נבנים מבט העל, מסלול היום, הקו על המפה, הקישור ל-Google Maps וקובץ
 * הנקודות שיורד. כלומר **ייצוג אחד שגוי מרעיל חמישה מסכים**.
 *
 * העוזר הכללי אמור לעדכן את שניהם יחד, ועכשיו הוא גם מחויב לכך. אבל
 * יום שכבר נסחף — ויש כאלה — צריך דרך לתקן, והדרך הזו לא יכולה להיות
 * "נסח נכון את הבקשה לעוזר". זה מה שהקריאה הזו עושה: קוראת את לוח
 * הזמנים ומחזירה ממנו את רשימת המקומות, לפי סדר הביקור.
 *
 * ── שתי החלטות ──
 * **סכמה זעירה.** מערך של מחרוזות ומשפט אחד. structured outputs מהדר
 * את הסכמה לדקדוק שיש לו תקרת גודל, וחריגה מפילה את הבקשה כולה ב-400
 * (ראו ai.mts). כאן אין מה לחרוג.
 *
 * **המודל מחזיר שמות, השרת פותר קואורדינטות.** אותו `resolvePlaces`
 * של העוזר: קודם מתוך הטיול עצמו, ורק מה שלא נמצא יוצא החוצה. שם
 * שלא נפתר נאמר למשתמש ואינו הופך לנקודה מומצאת על המפה.
 */

export default async (req: Request) => {
  if (req.method !== "POST") return fail("שיטה לא נתמכת", 405);

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return fail(
      "העוזר אינו מוגדר. צריך להוסיף ANTHROPIC_API_KEY במשתני הסביבה של Netlify.",
      503
    );
  }
  const gate = process.env.AI_ACCESS_CODE?.trim();

  let body: {
    code?: unknown;
    day?: Record<string, unknown>;
    trip?: Record<string, unknown>;
  } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("גוף הבקשה אינו JSON תקין", 400);
  }
  if (!body) return fail("גוף הבקשה ריק", 400);
  if (gate && String(body.code ?? "").trim() !== gate) {
    return fail("קוד גישה שגוי", 401);
  }

  const day = body.day || {};
  if (!Array.isArray(day.plan) || !day.plan.length) {
    return fail("ליום הזה אין לוח זמנים, ולכן אין ממה לגזור מקומות", 422);
  }

  const trip = body.trip || {};

  return streamJson(async () => {
    const got = await placesFromPlan(day, trip);
    if (!got) return { error: "העוזר לא החזיר רשימת מקומות" };

    // תקציב נמדד בקריאות ל-Nominatim, ושם בעברית עולה שתיים: תרגום וחיפוש
    const { points, unresolved } = await resolvePlaces(got.places, trip, {
      lookups: 12,
    });

    return { points, unresolved, note: got.note };
  });
};

export const config: Config = { path: "/api/places" };
