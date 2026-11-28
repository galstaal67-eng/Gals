import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { fail, resolveApiKey, streamJson, StreamError } from "../lib/shared.mts";
import { readFlight, type DocBlock } from "../lib/flight-read.mts";

/**
 * POST /api/flight-doc — קריאת פרטי טיסה מתוך כרטיס שהועלה מלשונית הטיסות.
 *
 * המסמך עצמו חי במכשיר (IndexedDB) ונשלח לכאן רק לקריאה החד-פעמית הזו;
 * הוא אינו נשמר בשרת ואינו נכתב לשום מסד. התשובה חוזרת ללקוח, מוצגת
 * לאישור, ורק אז נכנסת למסמך הטיול.
 *
 * הקריאה עצמה והסכמה שלה יושבות ב-lib/flight-read.mts, כי גם העוזר
 * משתמש בהן כשמצרפים אליו כרטיס טיסה.
 */

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

  const block: DocBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: mediaType as "image/png", data } };

  const leg = body.leg === "back" ? "חזור" : "הלוך";

  const client = new Anthropic({ apiKey });

  // קריאת PDF סרוק יכולה לקחת יותר מ-30 השניות שפונקציה רגילה מקבלת —
  // מזרימים, ובכך התקרה עולה ל-60.
  return streamJson(async () => {
    try {
      return await readFlight(client, block, leg);
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
