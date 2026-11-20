import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { fail, resolveApiKey, streamJson, StreamError } from "../lib/shared.mts";

/**
 * POST /api/flight-doc — קריאת פרטי טיסה מתוך כרטיס שהועלה.
 *
 * המסמך עצמו חי במכשיר (IndexedDB) ונשלח לכאן רק לקריאה החד-פעמית הזו;
 * הוא אינו נשמר בשרת ואינו נכתב לשום מסד. התשובה חוזרת ללקוח, מוצגת
 * לאישור, ורק אז נכנסת למסמך הטיול.
 *
 * הפרטים הם מה שמודפס על הכרטיס. אם שדה אינו מופיע — מחזירים "" ולא ניחוש:
 * טרמינל שגוי בכרטיס עלייה למטוס גרוע בהרבה מטרמינל חסר.
 */

const FlightInfo = z.object({
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

const SYSTEM = `אתה קורא כרטיסי טיסה וכרטיסי עלייה למטוס ומחזיר את הפרטים שמודפסים בהם.

- החזר אך ורק מה שכתוב במסמך. אל תשלים ואל תנחש שום שדה.
- שדה שאינו מופיע: החזר "" (מחרוזת ריקה). לא null, לא ניחוש.
- שעות הן מקומיות לשדה הרלוונטי, בפורמט HH:MM.
- טרמינל: רק של שדה המוצא של הטיסה הזו. כרטיס מכיל לעיתים גם את טרמינל
  היעד או טרמינל של רגל אחרת — אל תתבלבל ביניהם.
- מסמך עם כמה רגליים: החזר את הרגל שהתבקשה.
- שמות נוסעים מופיעים באנגלית בכרטיס. החזר אותם כפי שהם.
- אם המסמך אינו כרטיס טיסה, החזר את כל השדות ריקים והסבר ב-note.`;

const MEDIA = {
  pdf: ["application/pdf"],
  image: ["image/png", "image/jpeg", "image/gif", "image/webp"],
};

export default async (req: Request) => {
  if (req.method !== "POST") return fail("שיטה לא נתמכת", 405);

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return fail("העוזר אינו מוגדר. צריך ANTHROPIC_API_KEY במשתני הסביבה.", 503);
  }

  let body: { data?: unknown; mediaType?: unknown; leg?: unknown; code?: unknown } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("גוף הבקשה אינו JSON תקין", 400);
  }
  if (!body) return fail("גוף הבקשה ריק", 400);

  const gate = process.env.AI_ACCESS_CODE?.trim();
  if (gate && String(body.code ?? "").trim() !== gate) return fail("קוד גישה שגוי", 401);

  const data = String(body.data ?? "");
  const mediaType = String(body.mediaType ?? "");
  if (!data) return fail("לא נשלח מסמך", 422);
  // base64 מנפח ~33%, והמגבלה של ה-API היא 32MB לבקשה
  if (data.length > 24_000_000) return fail("המסמך גדול מדי", 413);

  const isPdf = MEDIA.pdf.includes(mediaType);
  const isImage = MEDIA.image.includes(mediaType);
  if (!isPdf && !isImage) {
    return fail("אפשר לקרוא רק PDF או תמונה (PNG/JPEG/GIF/WebP).", 415);
  }

  const leg = body.leg === "back" ? "חזור" : "הלוך";

  const client = new Anthropic({ apiKey });

  // קריאת PDF סרוק יכולה לקחת יותר מ-30 השניות שפונקציה רגילה מקבלת —
  // מזרימים, ובכך התקרה עולה ל-60.
  return streamJson(async () => {
    try {
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
            content: [
              isPdf
                ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
                : { type: "image", source: { type: "base64", media_type: mediaType as "image/png", data } },
              { type: "text", text: `הוצא את פרטי רגל ה${leg} מהמסמך הזה.` },
            ],
          },
        ],
      });

      if (response.stop_reason === "refusal") {
        throw new StreamError("המודל סירב לקרוא את המסמך הזה.");
      }
      const parsed = response.parsed_output;
      if (!parsed) throw new StreamError("התשובה מהמודל לא נקראה. נסו שוב.");

      return parsed;
    } catch (err) {
      if (err instanceof StreamError) throw err;
      if (err instanceof Anthropic.AuthenticationError) throw new StreamError("מפתח ה-API שגוי או פג.");
      if (err instanceof Anthropic.RateLimitError) throw new StreamError("חריגה ממכסה. נסו שוב בעוד דקה.");
      if (err instanceof Anthropic.APIConnectionError) throw new StreamError("אין חיבור לשירות.");
      console.error("flight-doc: הקריאה נכשלה", err);
      throw new StreamError("קריאת המסמך נכשלה.");
    }
  });
};

export const config: Config = {
  path: "/api/flight-doc",
};
