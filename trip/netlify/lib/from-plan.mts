/**
 * לוח זמנים של יום → רשימת המקומות שהוא עובר בהם.
 *
 * ── למה זה קיים כספרייה ──
 * ליום יש שני ייצוגים: `plan`, לוח הזמנים שאנשים קוראים, ו-`points`,
 * המקומות עם הקואורדינטות. מהראשון נבנה התכנון היומי; מהשני נבנים מבט
 * העל, מסלול היום, הקו על המפה, הקישור ל-Google Maps והנקודות שיורדות.
 * ייצוג אחד שנשאר מאחור מרעיל חמישה מסכים, והתקלה שקטה: מפה שלא השתנתה
 * נראית בדיוק כמו מפה שלא הייתה צריכה להשתנות.
 *
 * הניסיון לפתור את זה בכלל לעוזר ("כשאתה מחזיר plan, החזר גם places")
 * נכשל פעמיים — לא מפני שהכלל לא ברור, אלא מפני שכלל הוא בקשה ולא
 * ערובה. לכן הגזירה עברה לקוד: מי שמשנה לוח זמנים ולא מסר מקומות,
 * המקומות נגזרים עבורו כאן, באותה קריאה שמשרתת גם את כפתור התיקון
 * הידני. מקור אחד, התנהגות אחת.
 *
 * הקריאה מחזירה **שמות בלבד**. הקואורדינטות נפתרות ב-resolvePlaces,
 * מתוך הטיול עצמו ורק אחר כך מהרשת — כך ששם מומצא נגמר ב"לא נמצא"
 * ולא בסיכה על המפה.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { resolveApiKey } from "./shared.mts";

export const PlanPlaces = z.object({
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

export interface PlanDay {
  n?: unknown;
  title?: unknown;
  summary?: unknown;
  plan?: unknown;
  points?: unknown;
  hotel?: unknown;
}

/** השמות שכבר קיימים בטיול — הם נפתרים מהמסמך ולא דרך הרשת */
function knownNames(trip: Record<string, unknown>): string[] {
  const out: string[] = [];
  const days = Array.isArray(trip.days) ? trip.days : [];
  for (const d of days as Record<string, unknown>[]) {
    for (const p of (Array.isArray(d.points) ? d.points : []) as Record<string, unknown>[]) {
      const nm = line(p.name, 60);
      if (nm && !out.includes(nm)) out.push(nm);
    }
  }
  return out;
}

export function planPrompt(day: PlanDay, trip: Record<string, unknown>): string | null {
  const plan = Array.isArray(day.plan) ? day.plan : [];
  if (!plan.length) return null;

  const meta = (trip.meta || {}) as Record<string, unknown>;
  const known = knownNames(trip);
  const hotel = day.hotel as Record<string, unknown> | null | undefined;

  return [
    `טיול: ${line(meta.title, 80)}`,
    Array.isArray(meta.countries) && meta.countries.length
      ? `מדינות: ${(meta.countries as unknown[]).map((c) => line(c, 40)).join(", ")}`
      : "",
    `יום ${line(day.n, 4)} — ${line(day.title, 120)}`,
    day.summary ? `תיאור: ${line(day.summary, 300)}` : "",
    hotel?.name ? `לינה: ${line(hotel.name, 120)}` : "",
    "",
    "לוח הזמנים:",
    ...plan.slice(0, 30).map((p) => {
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
}

/**
 * הקריאה עצמה. מחזירה null כשאין לוח זמנים, כשאין מפתח, או כשהקריאה
 * נכשלה — ואז מי שקרא לה ממשיך בלי לגזור, ואינו נופל בגלל זה.
 */
export async function placesFromPlan(
  day: PlanDay,
  trip: Record<string, unknown>
): Promise<{ places: string[]; note: string } | null> {
  const prompt = planPrompt(day, trip);
  const apiKey = resolveApiKey();
  if (!prompt || !apiKey) return null;

  try {
    const res = await new Anthropic({ apiKey }).beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(PlanPlaces) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = res.parsed_output;
    if (!parsed) return null;
    return {
      places: (parsed.places || []).map((p) => line(p, 80)).filter(Boolean),
      note: parsed.note || "",
    };
  } catch {
    return null;
  }
}
