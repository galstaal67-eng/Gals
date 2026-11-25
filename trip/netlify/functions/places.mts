import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { fail, resolveApiKey, streamJson } from "../lib/shared.mts";
import { resolvePlaces } from "../lib/places.mts";

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

const Result = z.object({
  places: z
    .array(z.string())
    .describe(
      "שמות המקומות שהיום עובר בהם, לפי סדר הביקור בלוח הזמנים. " +
        "שמות של מקומות אמיתיים בלבד, בלי קואורדינטות ובלי תיאורים. " +
        "העדף שמות שכבר מופיעים ברשימת המקומות המוכרים."
    ),
  note: z
    .string()
    .describe("משפט אחד בעברית: מה השתנה מול הרשימה הקודמת. בלי פתיח."),
});

const SYSTEM = `אתה קורא לוח זמנים של יום בטיול ומחזיר את רשימת המקומות שהיום עובר בהם.

כללים:
• סדר הביקור, כפי שהוא בלוח הזמנים. לא סדר אלפביתי ולא לפי חשיבות.
• רק מקומות שאפשר להצביע עליהם על מפה: אתר, רחוב, כיכר, שוק, גשר,
  פארק, תחנה, שכונה. לא "ארוחת בוקר" ולא "מנוחה".
• ארוחה במקום ששמו מופיע — המקום נכנס. ארוחה בלי שם — לא.
• המלון אינו תחנה במסלול: הוא נקודת היציאה, ויש לו שדה משלו.
• שם מדויק של מקום אמיתי, כפי שמחפשים אותו במפות. "שוק דזרטירי" ולא
  "השוק הגדול". אם בלוח הזמנים מופיע שם מלא — השתמש בו.
• העדף שמות מתוך הרשימה המוכרת שנשלחה אליך; הם נפתרים מתוך המסמך
  ואינם דורשים חיפוש חיצוני.
• אל תמציא מקומות שאינם בלוח הזמנים, ואל תשמיט מקומות שכן.
• שניים עד עשרה מקומות ביום. אם לוח הזמנים כולו "יום חופשי" בלי
  מקומות — החזר רשימה ריקה והסבר ב-note.`;

const line = (v: unknown, max = 300) =>
  String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

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
  const plan = Array.isArray(day.plan) ? day.plan : [];
  if (!plan.length) {
    return fail("ליום הזה אין לוח זמנים, ולכן אין ממה לגזור מקומות", 422);
  }

  /*
   * `resolvePlaces` מקבל את מסמך הטיול **המלא**: הוא מחפש שם קודם כל
   * בתוך הנקודות שכבר קיימות, ולוקח את תיבת היעד מ-meta.bbox. מסמך
   * מקוצץ היה שולח כל שם לחיפוש חיצוני בלי צורך.
   */
  const trip = body.trip || {};
  const meta = (trip.meta || {}) as Record<string, unknown>;
  const tripDays = Array.isArray(trip.days) ? trip.days : [];

  // השמות שכבר מוכרים בטיול — הם נפתרים מתוך המסמך ולא דרך הרשת
  const known: string[] = [];
  for (const d of tripDays as Record<string, unknown>[]) {
    for (const pt of (Array.isArray(d.points) ? d.points : []) as Record<string, unknown>[]) {
      const nm = line(pt.name, 60);
      if (nm && !known.includes(nm)) known.push(nm);
    }
  }

  const prompt = [
    `טיול: ${line(meta.title, 80)}`,
    Array.isArray(meta.countries) && meta.countries.length
      ? `מדינות: ${(meta.countries as unknown[]).map((c) => line(c, 40)).join(", ")}`
      : "",
    `יום ${line(day.n, 4)} — ${line(day.title, 120)}`,
    day.summary && `תיאור: ${line(day.summary, 300)}`,
    day.hotel && `לינה: ${line((day.hotel as Record<string, unknown>)?.name, 120)}`,
    "",
    "לוח הזמנים:",
    ...plan
      .slice(0, 30)
      .map((p) => {
        const r = p as Record<string, unknown>;
        return `${line(r.time, 8) || "·"} ${line(r.text, 300)}`;
      }),
    "",
    Array.isArray(day.points) && day.points.length
      ? `הרשימה הקודמת (שאולי כבר אינה מתאימה): ${(day.points as Record<string, unknown>[])
          .slice(0, 20)
          .map((p) => line(p.name, 60))
          .filter(Boolean)
          .join(", ")}`
      : "ליום הזה אין כרגע מקומות על המפה.",
    known.length ? `מקומות מוכרים בטיול: ${known.slice(0, 60).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const client = new Anthropic({ apiKey });

  return streamJson(async () => {
    const res = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(Result) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });

    const parsed = res.parsed_output;
    if (!parsed) return { error: "העוזר לא החזיר רשימה" };

    // תקציב קטן: יום אחד, ורוב השמות אמורים להימצא במסמך עצמו
    const { points, unresolved } = await resolvePlaces(parsed.places, trip, {
      lookups: 8,
    });

    return {
      points,
      unresolved,
      note: parsed.note || "",
      usage: { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 },
    };
  });
};

export const config: Config = { path: "/api/places" };
