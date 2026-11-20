import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { json, fail, resolveApiKey } from "../lib/shared.mts";

/**
 * POST /api/ai — בקשה חופשית בעברית, מוקלדת או מוכתבת.
 *
 * שני סוגי בקשות, והמודל מחליט ביניהם:
 *   • שינוי במסלול  — "תשנה את יום 3 להישאר בעיר וללא נסיעה"
 *   • רישום הוצאה   — "שילמתי 45 לארי על קפה"
 *
 * בשינוי מסלול הפונקציה מחזירה **ערכת שינויים** ולא מסמך חדש.
 *
 * למה ערכת שינויים: מסמך מלא שחוזר מהמודל יכול לאבד שדות בשקט — נקודות מפה,
 * מחירים, מזהים. ערכה תחומה מגבילה את מה שניתן לשנות לשדות טקסטואליים
 * שהמשתמש ממילא עורך ביד, ומשאירה את כל השאר כפי שהוא. השינוי גם מוצג
 * לאישור בלקוח לפני שהוא נשמר.
 *
 * המפתח יושב כאן ולא בדפדפן: ANTHROPIC_API_KEY בצד השרת בלבד.
 */

/* ------------------------------------------------------------------ */
/*  סכמת התשובה                                                        */
/* ------------------------------------------------------------------ */

/**
 * כל שדה חובה אך מקבל null. זו הדרישה של structured outputs (strict),
 * ו-null הוא הסימון ל"אל תיגע בשדה הזה" — להבדיל מ-"" שמנקה אותו.
 */
const DayChange = z.object({
  n: z.number().int().describe("מספר היום שמשתנה, כפי שהוא במסמך"),
  title: z.string().nullable().describe("כותרת היום, או null אם לא משתנה"),
  summary: z.string().nullable().describe("תיאור קצר של היום, או null"),
  mode: z.enum(["flight", "drive", "train", "hike", "city"]).nullable()
    .describe("אופן ההתקדמות ביום. city = עירוני בלי נסיעה בין-עירונית"),
  driveKm: z.number().nullable().describe("ק\"מ נסיעה ביום. 0 ליום בלי נסיעה"),
  driveHours: z.number().nullable().describe("שעות נסיעה ביום. 0 ליום בלי נסיעה"),
  driveNote: z.string().nullable().describe("הערת הנסיעה. \"\" מוחק אותה"),
  hotelName: z.string().nullable().describe("שם הלינה. \"\" מסמן שאין לינה ביום הזה"),
  hotelArea: z.string().nullable().describe("אזור הלינה"),
  plan: z.array(z.object({ time: z.string(), text: z.string() })).nullable()
    .describe("לוח הזמנים המלא של היום, מחליף את הקיים. null = לא משתנה"),
  tips: z.array(z.string()).nullable()
    .describe("הטיפים של היום, מחליפים את הקיימים. null = לא משתנים"),
});

const Expense = z.object({
  date: z.string().describe("תאריך ההוצאה, YYYY-MM-DD"),
  amount: z.number().positive().describe("הסכום, מספר חיובי"),
  currency: z.string().describe("סימן המטבע, אחד מאלה שברשימה שנשלחה"),
  category: z.string().describe("שם הסעיף, בדיוק כפי שהוא ברשימה שנשלחה"),
  payer: z.string().describe("מי שילם, בדיוק כפי שהשם מופיע ברשימת המטיילים"),
  note: z.string().describe("תיאור קצר של ההוצאה. מחרוזת ריקה אם אין"),
});

const Result = z.object({
  kind: z.enum(["trip_edit", "expense", "unclear"])
    .describe("trip_edit = שינוי במסלול · expense = רישום הוצאה · unclear = לא הובן"),
  summary: z.string().describe("משפט או שניים בעברית: מה נעשה בפועל"),
  warning: z.string().nullable()
    .describe("השלכה שהמשתמש צריך לדעת עליה. null אם אין"),
  dayChanges: z.array(DayChange).describe("רק ימים שבאמת משתנים. ריק אם זו אינה בקשת שינוי מסלול"),
  metaSubtitle: z.string().nullable()
    .describe("כותרת המשנה של הטיול, אם השינוי מצדיק עדכון. אחרת null"),
  expenses: z.array(Expense).describe("ההוצאות לרישום. ריק אם זו אינה בקשת הוצאה"),
});

/* ------------------------------------------------------------------ */
/*  הפרומפט                                                            */
/* ------------------------------------------------------------------ */

const SYSTEM = `אתה העוזר של אפליקציית תכנון טיולים בעברית.

המשתמש כותב או מכתיב בקשה חופשית. החלט לאיזה סוג היא שייכת:

• **expense** — רישום הוצאה. סימנים: סכום ומטבע, פועל של תשלום ("שילמתי",
  "קניתי", "עלה לי"), שם של דבר שקונים. גם כמה הוצאות במשפט אחד.
• **trip_edit** — שינוי במסלול: יום, לוח זמנים, לינה, נסיעה.
• **unclear** — לא ברור לאיזה סוג זה שייך, או חסר מידע מהותי.

--- אם זו הוצאה (kind = "expense") ---

- expenses מכיל שורה לכל הוצאה. dayChanges ריק.
- amount הוא מספר בלבד. אל תכלול בו את המטבע.
- currency: אם המשתמש אמר מטבע — השתמש בו. אם לא — ברירת המחדל היא המטבע
  המקומי של הטיול שנשלח לך.
- category: בחר מתוך רשימת הסעיפים שנשלחה, בדיוק כפי שהשם כתוב שם. אם שום
  סעיף לא מתאים — "אחר".
- payer: בחר מתוך רשימת המטיילים שנשלחה. אם המשתמש לא אמר מי שילם — בחר את
  הראשון ברשימה, וציין זאת ב-warning.
- date: אם לא נאמר תאריך — השתמש בתאריך של היום שנשלח לך. "אתמול" ו"שלשום"
  הם יחסית אליו. אם התאריך נופל מחוץ לטווח הטיול, ציין זאת ב-warning.
- note: תיאור קצר במילים של המשתמש ("קפה", "מונית לשדה"). לא לנפח.
- הכתבה קולית משבשת מספרים ומטבעות. אם הסכום או המטבע נראים לא סבירים,
  רשום את מה שהבנת וציין את הספק ב-warning.

--- אם זה שינוי מסלול (kind = "trip_edit") ---

- dayChanges מכיל רק את הימים שמשתנים. expenses ריק.

כללים:
- כתוב הכול בעברית, באותו טון של המסמך: ענייני, ללא שיווק וללא סימני קריאה.
- שנה רק מה שהבקשה מחייבת. כל שדה שלא צריך להשתנות — החזר בו null.
- ערוך רק ימים שבאמת משתנים. אל תחזיר יום שלא נגעת בו.
- כשיום הופך ליום עירוני ללא נסיעה: mode = "city", driveKm = 0, driveHours = 0,
  ו-driveNote ריק. אל תשכח להתאים גם את הכותרת, התיאור ולוח הזמנים.
- לוח זמנים: שעות אמיתיות ורצף הגיוני. התחשב בזמני פתיחה, בזמני נסיעה
  ובשעות האור של העונה והיעד.
- אל תמציא מחירים, מספרי הזמנה, שמות מלונות או שעות טיסה שלא הופיעו במסמך.
  אם הבקשה דורשת מידע כזה — אמור זאת ב-warning במקום להמציא.
- אם לשינוי יש השלכה שהמשתמש עלול לפספס — לינה שהוזמנה ביעד שהוסר, יום
  שנשאר בלי מלון, נסיעה שהתארכה מאוד — כתוב אותה ב-warning.
- אם הבקשה אינה ברורה או אינה ניתנת לביצוע על המסמך הזה, החזר kind = "unclear"
  עם dayChanges ו-expenses ריקים, והסבר ב-summary מה חסר.`;

/** גרסה מצומצמת של המסמך: בלי נתיבים ונקודות מפה, שאינם ניתנים לעריכה כאן */
function compactTrip(doc: Record<string, unknown>): unknown {
  const meta = doc.meta as Record<string, unknown> | undefined;
  const days = Array.isArray(doc.days) ? doc.days : [];
  return {
    title: meta?.title ?? "",
    subtitle: meta?.subtitle ?? "",
    countries: meta?.countries ?? [],
    days: days.map((d: Record<string, unknown>) => {
      const hotel = d.hotel as Record<string, unknown> | undefined;
      const drive = d.drive as Record<string, unknown> | undefined;
      const points = Array.isArray(d.points) ? d.points : [];
      return {
        n: d.n,
        date: d.date,
        dow: d.dow,
        title: d.title,
        region: d.region,
        mode: d.mode,
        summary: d.summary,
        drive: { km: drive?.km ?? 0, hours: drive?.hours ?? 0, note: drive?.note ?? "" },
        hotel: hotel ? { name: hotel.name, area: hotel.area } : null,
        plan: d.plan ?? [],
        tips: d.tips ?? [],
        // שמות בלבד — נותן למודל הקשר גאוגרפי בלי להציף אותו בקואורדינטות
        mapPoints: points.map((p: Record<string, unknown>) => p.name),
      };
    }),
  };
}

/** הרשימות שמהן המודל חייב לבחור כשהוא רושם הוצאה */
function expenseContext(ctx: Record<string, unknown> | undefined) {
  const arr = (v: unknown, fallback: string[]) =>
    Array.isArray(v) && v.length ? v.map(String) : fallback;
  return {
    today: String(ctx?.today ?? new Date().toISOString().slice(0, 10)),
    travellers: arr(ctx?.people, ["גל"]),
    categories: arr(ctx?.categories, ["אחר"]),
    currencies: arr(ctx?.currencies, ["$"]),
  };
}

/* ------------------------------------------------------------------ */

export default async (req: Request) => {
  if (req.method !== "POST") return fail("שיטה לא נתמכת", 405);

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return fail(
      "העוזר אינו מוגדר. צריך להוסיף ANTHROPIC_API_KEY במשתני הסביבה של Netlify.",
      503
    );
  }

  // הגנה אופציונלית: אם הוגדר קוד, הוא נדרש. האתר עצמו פתוח, ובלי זה
  // כל מי שיש לו את הכתובת יכול להפעיל את המודל על חשבון המפתח.
  const gate = process.env.AI_ACCESS_CODE;

  let body: {
    doc?: unknown;
    instruction?: unknown;
    code?: unknown;
    context?: { people?: unknown; categories?: unknown; currencies?: unknown; today?: unknown };
  } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("גוף הבקשה אינו JSON תקין", 400);
  }
  if (!body) return fail("גוף הבקשה ריק", 400);

  if (gate && String(body.code ?? "") !== gate) {
    return fail("קוד גישה שגוי", 401);
  }

  const instruction = String(body.instruction ?? "").trim();
  if (!instruction) return fail("לא נשלחה בקשה לשינוי", 422);
  if (instruction.length > 2000) return fail("הבקשה ארוכה מדי", 413);

  const doc = body.doc;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return fail("מסמך הטיול חסר", 422);
  }
  const days = (doc as Record<string, unknown>).days;
  if (!Array.isArray(days) || !days.length) return fail("אין ימים במסלול לערוך", 422);

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // ברירת המחדל ב-Opus 5.5 היא medium; מציינים במפורש כדי שלא תשתנה מתחתינו
      output_config: { effort: "medium", format: zodOutputFormat(Result) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        // הפרומפט יציב בין בקשות — שומרים אותו במטמון כדי שכמה עריכות
        // ברצף ישלמו עליו פעם אחת
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content:
            "המסלול הנוכחי:\n```json\n" +
            JSON.stringify(compactTrip(doc as Record<string, unknown>), null, 1) +
            "\n```\n\nהקשר לרישום הוצאות:\n```json\n" +
            JSON.stringify(expenseContext(body.context), null, 1) +
            "\n```\n\nהבקשה שלי:\n" +
            instruction,
        },
      ],
    });

    // מסרב = אין תוכן. בלי הבדיקה הזו parsed_output הוא null וההודעה סתומה.
    if (response.stop_reason === "refusal") {
      return fail("המודל סירב לבקשה הזו. נסחו אותה אחרת.", 422);
    }

    const parsed = response.parsed_output;
    if (!parsed) return fail("התשובה מהמודל לא נקראה. נסו שוב.", 502);

    return json({
      ...parsed,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
      },
    });
  } catch (err) {
    // שגיאות מפתח ומכסה הן המקרים שהמשתמש יכול לפעול לפיהם — מפרידים אותן
    if (err instanceof Anthropic.AuthenticationError) {
      return fail("מפתח ה-API שגוי או פג.", 502);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return fail("חריגה ממכסת הקריאות. נסו שוב בעוד דקה.", 429);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return fail("אין חיבור לשירות. בדקו רשת ונסו שוב.", 504);
    }
    console.error("ai: הקריאה נכשלה", err);
    return fail("העוזר נכשל. נסו שוב.", 502);
  }
};

export const config: Config = {
  path: "/api/ai",
};
