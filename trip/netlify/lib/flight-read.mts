import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { StreamError } from "./shared.mts";

/**
 * קריאת פרטי טיסה מתוך כרטיס.
 *
 * זו קריאה נפרדת למודל עם סכמה קטנה משלה, ולא חלק מסכמת העוזר הגדולה.
 * הסיבה אינה אסתטית: structured outputs מהדר את הסכמה לדקדוק, ולדקדוק
 * יש תקרת גודל. סכמה אחת שמכילה גם ימים, גם הוצאות, גם שאלות, גם סיווג
 * מסמכים וגם עשרה שדות טיסה חצתה את התקרה והשירות דחה **כל** בקשה
 * ב-400 — כולל בקשות טקסט פשוטות שלא נגעו במסמכים בכלל.
 *
 * הפיצול הזה גם זול יותר: הקריאה השנייה קורית רק כשבאמת צורף כרטיס טיסה.
 *
 * הפרטים הם מה שמודפס על הכרטיס. אם שדה אינו מופיע — מחזירים "" ולא ניחוש:
 * טרמינל שגוי בכרטיס עלייה למטוס גרוע בהרבה מטרמינל חסר.
 */

export const FlightInfo = z.object({
  flightNo: z.string().describe('מספר הטיסה כפי שמודפס, למשל "LY5117". "" אם אינו מופיע'),
  date: z.string().describe('תאריך הטיסה ב-YYYY-MM-DD. "" אם אינו מופיע'),
  dep: z.string().describe('שעת המראה מקומית, HH:MM. "" אם אינה מופיעה'),
  arr: z.string().describe('שעת נחיתה מקומית, HH:MM. "" אם אינה מופיעה'),
  from: z.string().describe('שדה המוצא עם קוד IATA, למשל "תל אביב (TLV)". "" אם אינו מופיע'),
  to: z.string().describe('שדה היעד עם קוד IATA. "" אם אינו מופיע'),
  terminal: z.string().describe('מספר הטרמינל בשדה המוצא בלבד. "" אם אינו מופיע'),
  duration: z.string().describe('משך הטיסה, H:MM. "" אם אינו מופיע'),
  seats: z.array(z.object({ who: z.string(), seat: z.string() }))
    .describe("מושבים ששמם של הנוסעים מופיע לצידם. ריק אם אין"),
  note: z.string().describe('מה שלא נקרא או שדורש בדיקה. "" אם הכול ברור'),
});

export type FlightInfo = z.infer<typeof FlightInfo>;

const SYSTEM = `אתה קורא כרטיסי טיסה וכרטיסי עלייה למטוס ומחזיר את הפרטים שמודפסים בהם.

- החזר אך ורק מה שכתוב במסמך. אל תשלים ואל תנחש שום שדה.
- שדה שאינו מופיע: החזר "" (מחרוזת ריקה). לא null, לא ניחוש.
- שעות הן מקומיות לשדה הרלוונטי, בפורמט HH:MM.
- טרמינל: רק של שדה המוצא של הטיסה הזו. כרטיס מכיל לעיתים גם את טרמינל
  היעד או טרמינל של רגל אחרת — אל תתבלבל ביניהם.
- מסמך עם כמה רגליים: החזר את הרגל שהתבקשה.
- שמות נוסעים מודפסים בכרטיס באנגלית ובשם מלא. אם תישלח אליך רשימת
  הנוסעים של הטיול ואתה מזהה את אותו אדם בה, החזר את השם **כפי שהוא
  ברשימה** — כך המושב מתעדכן לנוסע הקיים במקום להיווסף כנוסע נוסף.
  בלי התאמה ברורה, החזר את השם כפי שהוא בכרטיס.
- אם המסמך אינו כרטיס טיסה, החזר את כל השדות ריקים והסבר ב-note.`;

/** בלוק מסמך או תמונה, כפי שהוא נבנה מהקובץ שהועלה */
export type DocBlock = Anthropic.Beta.BetaContentBlockParam;

export async function readFlight(
  client: Anthropic,
  block: DocBlock,
  legLabel: string,
  passengers: string[] = []
): Promise<FlightInfo> {
  const who = passengers.length
    ? `\n\nהנוסעים של הטיול הזה: ${passengers.join(", ")}.`
    : "";

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(FlightInfo) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        // המסמך לפני הטקסט — זה הסדר שהתיעוד מחייב למסמכים
        content: [block, { type: "text", text: `הוצא את פרטי רגל ה${legLabel} מהמסמך הזה.${who}` }],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new StreamError("המודל סירב לקרוא את המסמך הזה.");
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new StreamError("התשובה מהמודל לא נקראה. נסו שוב.");
  return parsed;
}
