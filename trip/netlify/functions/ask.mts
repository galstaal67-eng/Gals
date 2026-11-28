import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { fail, resolveApiKey, streamJson, StreamError } from "../lib/shared.mts";

/**
 * POST /api/ask — שאלה על הרגע הנוכחי בטיול, עם חיפוש ברשת.
 *
 * זה מה שהופך את קוביית "עכשיו" מלוח מידע לחבר מלווה: היא יודעת איפה
 * אנחנו ומה הלאה, וכאן היא יכולה גם **לבדוק בחוץ** — האם הטיסה בזמן
 * ומאיזה שער, מה שעות הפתיחה של המקום שעומדים להיכנס אליו, האם המעבר
 * פתוח היום, ואיפה אוכלים טוב ליד.
 *
 * ── שלוש החלטות ──
 *
 * **רק בלחיצה.** אין כאן רענון אוטומטי. חיפוש ברשת עולה כסף בכל קריאה,
 * וקוביה שמחפשת לבד כל חצי דקה הייתה הופכת מידע שימושי לחשבון חודשי.
 *
 * **סכמה זעירה.** structured outputs מהדר את הסכמה לדקדוק שיש לו תקרת
 * גודל, וחריגה ממנה מפילה **כל** בקשה ב-400 — זה כבר קרה כאן פעם אחת
 * (ראו ai.mts). כותרת, שלוש-ארבע שורות ומקורות; לא יותר.
 *
 * **מה שחוזר מהרשת הוא טקסט להצגה, ולא פקודה.** התשובה אינה נוגעת
 * במסמך הטיול, אינה רושמת הוצאות ואינה משנה דבר — היא מוצגת למטייל
 * והוא מחליט. דף חיצוני שמנסה להורות משהו הוא פשוט עוד טקסט.
 */

const Source = z.object({
  title: z.string().describe("שם האתר או הכותרת, בקצרה"),
  url: z.string().describe("הכתובת המלאה"),
});

const Answer = z.object({
  headline: z.string().describe("משפט אחד שעונה על השאלה. בעברית."),
  bullets: z
    .array(z.string())
    .describe("2–4 שורות קונקרטיות: שעות, מחירים, מספרים, מה לעשות. בעברית."),
  caution: z
    .string()
    .nullable()
    .describe("אזהרה אחת אם יש משהו שעלול להפתיע, אחרת null"),
  fresh: z
    .boolean()
    .describe("true אם התשובה נשענת על חיפוש שנעשה עכשיו, false אם על ידע כללי"),
  alert: z
    .boolean()
    .describe(
      "true רק אם זה משנה את מה שצריך לעשות בשעות הקרובות ומצדיק להפריע למטייל. " +
        "בבדיקה יזומה שלא מצאה דבר — false."
    ),
  sources: z.array(Source).describe("המקורות שנבדקו. ריק אם לא נעשה חיפוש."),
});

const SYSTEM = `אתה חבר שמלווה מטיילים ישראלים בזמן אמת, בתוך אפליקציית טיול.

התפקיד שלך לענות על **הרגע הזה**: מה שקורה עכשיו, מה שעומד לקרות, ומה
שצריך לדעת כדי שזה יעבוד. לא סקירה כללית ולא היסטוריה.

כללים:
• חפש ברשת כשהתשובה תלויה במציאות של עכשיו — סטטוס טיסה, שער עלייה,
  עיכוב, שעות פתיחה, מזג אוויר, מצב כביש או מעבר, אירועים היום.
• אל תחפש כשהתשובה לא משתנה (איך קוראים למנה, מה מקובל לתת כטיפ).
• מספר שער, שעת המראה מעודכנת או שעת פתיחה — או שמצאת אותם במקור, או
  שאתה אומר שלא. אל תנחש. מטייל שיגיע לשער שגוי יפספס טיסה.
• קצר. שורה אחת לכותרת, שתיים עד ארבע שורות אחריה, כל אחת עם מידע
  ממשי — שעה, מחיר, מרחק, שם מקום.
• עברית, ישיר, בלי נימוסים ובלי "כדאי לציין".
• מחירים בלארי או במטבע המקומי, ולא בהמרה לשקל.
• אם אין לך תשובה טובה — אמור זאת בכותרת במקום למלא מקום.`;

/** טקסט קצר ובטוח מתוך קלט חופשי */
const line = (v: unknown, max = 400) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

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
    question?: unknown;
    mode?: unknown;
    code?: unknown;
    context?: Record<string, unknown>;
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

  const question = line(body.question, 500);
  if (!question) return fail("לא נשלחה שאלה", 422);

  // בדיקה יזומה ברקע היא לא שאלה של המטייל, וצריך לומר לה מתי לשתוק
  const watching = String(body.mode ?? "") === "watch";

  /* ההקשר הוא מה שהקוביה כבר יודעת: איפה אנחנו, מתי, ומה הלאה.
     רק שדות קצרים, וכולם עוברים ניקוי — זה קלט מהדפדפן. */
  const c = body.context || {};
  const context = [
    `טיול: ${line(c.trip, 80)}`,
    c.place && `יעד: ${line(c.place, 80)}`,
    c.when && `עכשיו: ${line(c.when, 40)}`,
    c.state && `מצב: ${line(c.state, 60)}`,
    c.spot && `איפה אני: ${line(c.spot, 220)}`,
    c.now && `מה קורה עכשיו: ${line(c.now, 300)}`,
    c.next && `הבא בתור: ${line(c.next, 300)}`,
    c.hotel && `לינה: ${line(c.hotel, 120)}`,
    c.flight && `טיסה: ${line(c.flight, 160)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const client = new Anthropic({ apiKey });

  return streamJson(async () => {
    /**
     * קריאה אחת עם כלי החיפוש, ואם היא נדחית — אותה קריאה בלי הכלי.
     *
     * הכלי של צד-שרת אינו זמין בכל מודל ובכל פריסה, והכישלון שלו הוא
     * שגיאת בקשה ולא תשובה ריקה. תשובה מידע כללי עדיפה על הודעת שגיאה,
     * והשדה `fresh` אומר למשתמש במה הוא מסתכל.
     */
    // max_uses נמוך בכוונה: כל חיפוש עולה, והשאלות כאן צרות.
    // ההמרה היא על מערך הכלים בלבד — כך שאר הקריאה נשארת מוקלדת,
    // ו-parsed_output ממשיך לדעת מה הסכמה מחזירה
    const SEARCH = [
      { type: "web_search_20260209", name: "web_search", max_uses: 3 },
    ] as unknown as Parameters<typeof client.beta.messages.parse>[0]["tools"];

    const call = (withSearch: boolean) =>
      client.beta.messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 4000,
        output_config: { effort: "low", format: zodOutputFormat(Answer) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        tools: withSearch ? SEARCH : undefined,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content:
              `${context}\n\nהשאלה: ${question}` +
              (watching
                ? "\n\nזו בדיקה יזומה שרצה ברקע, ולא שאלה שנשאלה עכשיו. " +
                  "אם אין שום דבר חדש שמצדיק להפריע — כתוב זאת בכותרת, " +
                  "השאר את bullets ריק, ו-alert=false. עדיף שתיקה על רעש."
                : ""),
          },
        ],
      });

    let response;
    let searched = true;
    try {
      response = await call(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 401/403 הם מפתח, ולא הכלי — אין טעם לנסות שוב בלעדיו
      if (/401|403|credit|balance/i.test(msg)) {
        throw new StreamError("הקריאה למודל נדחתה. בדקו את המפתח ואת היתרה.");
      }
      searched = false;
      response = await call(false);
    }

    if (response.stop_reason === "refusal") {
      throw new StreamError("המודל סירב לשאלה הזו. נסחו אותה אחרת.");
    }
    const parsed = response.parsed_output;
    if (!parsed) throw new StreamError("התשובה מהמודל לא נקראה. נסו שוב.");

    return {
      ...parsed,
      fresh: searched && parsed.fresh,
      // כתובות בלבד, ולא javascript: או data:
      sources: (parsed.sources || [])
        .filter((s) => /^https?:\/\//i.test(s.url))
        .slice(0, 4),
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  });
};

export const config: Config = {
  path: "/api/ask",
};
