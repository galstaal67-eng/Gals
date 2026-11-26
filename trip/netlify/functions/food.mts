import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { fail, resolveApiKey, streamJson, StreamError } from "../lib/shared.mts";

/**
 * POST /api/food — איפה אוכלים ליד המקום שבו אנחנו, לפי מה שמתחשק.
 *
 * "בדוק עכשיו" יודע לענות על "איפה אוכלים טוב בסביבה", אבל כשאלה חופשית:
 * צריך לנסח אותה, והתשובה היא שלוש שורות טקסט. אוכל הוא השאלה שחוזרת
 * שלוש פעמים ביום, ולכן יש לה מסך משלה — בוחרים סוג (מסעדה, בית קפה,
 * בר), סגנון (מקומי, לא תיירותי, אוכל מהיר, שף, עממי), ומקבלים רשימה של
 * מקומות שכל אחד מהם נפתח במפות בלחיצה.
 *
 * ── שלוש החלטות ──
 *
 * **המודל מחזיר שמות, לעולם לא קואורדינטות.** אותו כלל של places.mts:
 * קואורדינטה שהומצאה נראית בדיוק כמו נכונה. הלקוח פותח את המקום במפות
 * כחיפוש של השם **סביב** נקודת העוגן, ושם רואים אם הוא קיים, פתוח וכמה
 * רחוק — ממקור שיודע.
 *
 * **רשימה קצרה ואמיתית עדיפה על מלאה ומומצאת.** מסעדה שלא קיימת היא
 * חצי שעה של הליכה בגשם אל דלת סגורה. הפרומפט אומר זאת במפורש, ורשימה
 * ריקה היא תשובה לגיטימית.
 *
 * **הסגנונות מגיעים כמזהים, לא כטקסט.** הלקוח שולח `local` ו-`chef`,
 * והמשמעות שלהם נכתבת כאן. כך ההגדרה של "לא תיירותי" יושבת במקום אחד,
 * ושדה שהגיע מהדפדפן אינו נכנס לפרומפט כמות שהוא — מלבד שורת "משהו
 * נוסף", שמנוקה ומקוצרת.
 *
 * כמו ‎/api/ask: רק בלחיצה, סכמה זעירה, והתשובה היא טקסט להצגה בלבד.
 */

const KINDS: Record<string, string> = {
  restaurant: "מסעדות",
  cafe: "בתי קפה",
  bar: "ברים",
};

const STYLES: Record<string, string> = {
  local:
    "מקומי — המטבח של המקום עצמו, מנות שאוכלים כאן, ולא מטבח בינלאומי",
  hidden:
    "לא תיירותי — מקום שתושבים אוכלים בו. לא ברחוב התיירים הראשי, לא עם " +
    "מלצר שמזמין פנימה מהמדרכה, ולא מה שמופיע ראשון בכל רשימת 'עשרת הגדולים'",
  fast:
    "אוכל מהיר — אוכלים ויוצאים תוך עשרים דקות: דוכן, מאפייה, דלפק, אוכל רחוב",
  chef:
    "מסעדת שף — מטבח של שף מוכר או מסעדה שמדברים עליה, ששווה ערב שלם והזמנה מראש",
  folk:
    "עממי — פשוט, זול ובלי יומרות: מסעדת פועלים, מזנון שכונתי, שולחנות משותפים",
};

const Place = z.object({
  name: z
    .string()
    .describe("שם המקום בדיוק כפי שהוא מופיע ב-Google Maps, באותיות לטיניות"),
  he: z.string().describe("השם בתעתיק עברי, או מחרוזת ריקה"),
  why: z.string().describe("משפט אחד: למה דווקא המקום הזה מתאים לבקשה. בעברית."),
  order: z.string().describe("מה להזמין שם — מנה או שתיים. בעברית. ריק אם לא ידוע."),
  price: z.string().describe("טווח מחיר לאדם במטבע המקומי, או מחרוזת ריקה אם לא ידוע"),
  where: z.string().describe("רחוב או שכונה, ואם ידוע — כמה זה מנקודת המוצא. בעברית."),
});

const Source = z.object({
  title: z.string().describe("שם האתר או הכותרת, בקצרה"),
  url: z.string().describe("הכתובת המלאה"),
});

const Answer = z.object({
  headline: z.string().describe("משפט אחד שמסכם את מה שנמצא. בעברית."),
  places: z.array(Place).describe("עד חמישה מקומות, הטוב ביותר ראשון. ריק אם לא נמצא דבר אמין."),
  caution: z.string().nullable().describe("אזהרה אחת אם יש משהו שעלול להפתיע, אחרת null"),
  fresh: z.boolean().describe("true אם נעשה חיפוש עכשיו, false אם מידע כללי"),
  sources: z.array(Source).describe("המקורות שנבדקו. ריק אם לא נעשה חיפוש."),
});

const SYSTEM = `אתה חבר מקומי שממליץ למטיילים ישראלים איפה לאכול, בתוך אפליקציית טיול.

אתה מקבל נקודת מוצא (איפה הם עומדים עכשיו), סוג מקום וסגנון, ומחזיר עד
חמישה מקומות אמיתיים שמתאימים — הטוב ביותר ראשון.

כללים:
• חפש ברשת. המלצות אוכל מתיישנות: מקומות נסגרים, עוברים ומשתנים.
• **אל תמציא.** מקום שאינך בטוח שהוא קיים ופועל — אל תכלול אותו. שלושה
  מקומות אמיתיים עדיפים על חמישה שאחד מהם מומצא, ורשימה ריקה עם הסבר
  בכותרת היא תשובה לגיטימית. מטייל ילך לשם ברגל.
• קרוב לנקודת המוצא. אם התבקש מרחק הליכה — עד רבע שעה ברגל. אל תציע
  מקום בעיר אחרת או בקצה השני של העיר.
• כל הסגנונות שנבחרו חלים יחד. אם אין מקום שעונה על כולם, החזר את
  הקרובים ביותר ואמור בכותרת על מה ויתרת.
• name הוא השם כפי שהוא מופיע ב-Google Maps, באותיות לטיניות — הוא
  ישמש לחיפוש במפות, ושם מתורגם או מתועתק לעברית לא יימצא שם.
• אל תכתוב שעות פתיחה, מחיר או מרחק שלא מצאת. שדה ריק עדיף על ניחוש.
• מחירים במטבע המקומי, ולא בהמרה לשקל.
• עברית, קצר וישיר. בלי "כדאי לציין" ובלי סופרלטיבים ריקים.`;

/** טקסט קצר ובטוח מתוך קלט חופשי */
const line = (v: unknown, max = 200) =>
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
    code?: unknown;
    kind?: unknown;
    styles?: unknown;
    extra?: unknown;
    walk?: unknown;
    anchor?: Record<string, unknown>;
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

  const kind = KINDS[String(body.kind ?? "")] ? String(body.kind) : "restaurant";
  // רק מזהים מוכרים, וכל אחד פעם אחת
  const styles = [
    ...new Set((Array.isArray(body.styles) ? body.styles : []).map(String)),
  ].filter((s) => STYLES[s]);
  const extra = line(body.extra, 160);

  const a = body.anchor || {};
  const lat = Number(a.lat);
  const lng = Number(a.lng);
  const hasGeo =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const near = line(a.name, 120);
  if (!hasGeo && !near) return fail("לא נשלח מקום לחפש סביבו", 422);

  const c = body.context || {};
  const brief = [
    `טיול: ${line(c.trip, 80)}`,
    c.place && `מדינה: ${line(c.place, 80)}`,
    c.region && `אזור: ${line(c.region, 80)}`,
    c.when && `עכשיו: ${line(c.when, 60)}`,
    near && `נקודת המוצא: ${a.mine ? "המיקום שלי, ליד " : ""}${near}`,
    // שלוש ספרות הן כמאה מטר: מספיק כדי לדעת באיזה רחוב, ולא יותר מזה
    hasGeo && `קואורדינטות נקודת המוצא: ${lat.toFixed(3)}, ${lng.toFixed(3)}`,
    `מה מחפשים: ${KINDS[kind]}`,
    styles.length
      ? "סגנון:\n" + styles.map((s) => `  – ${STYLES[s]}`).join("\n")
      : "סגנון: בלי העדפה — פשוט מקומות טובים",
    `מרחק: ${body.walk === false ? "אפשר גם נסיעה קצרה במונית" : "מרחק הליכה, עד רבע שעה"}`,
    extra && `בקשה נוספת מהמטייל: ${extra}`,
  ]
    .filter(Boolean)
    .join("\n");

  const client = new Anthropic({ apiKey });

  return streamJson(async () => {
    /* אותה צורה של ‎/api/ask: קריאה אחת עם כלי החיפוש, ואם הכלי אינו זמין
       — אותה קריאה בלעדיו. השדה `fresh` אומר למשתמש במה הוא מסתכל. */
    const SEARCH = [
      { type: "web_search_20260209", name: "web_search", max_uses: 4 },
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
        messages: [{ role: "user", content: brief }],
      });

    let response;
    let searched = true;
    try {
      response = await call(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|403|credit|balance/i.test(msg)) {
        throw new StreamError("הקריאה למודל נדחתה. בדקו את המפתח ואת היתרה.");
      }
      searched = false;
      response = await call(false);
    }

    if (response.stop_reason === "refusal") {
      throw new StreamError("המודל סירב לבקשה הזו. נסחו אותה אחרת.");
    }
    const parsed = response.parsed_output;
    if (!parsed) throw new StreamError("התשובה מהמודל לא נקראה. נסו שוב.");

    return {
      ...parsed,
      // מקום בלי שם אי אפשר לפתוח במפות, ולכן הוא אינו המלצה
      places: (parsed.places || []).filter((p) => p.name.trim()).slice(0, 5),
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
  path: "/api/food",
};
