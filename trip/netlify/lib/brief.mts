import Anthropic from "@anthropic-ai/sdk";
import { resolveApiKey } from "./shared.mts";

/**
 * "מה קורה בעיר" — החלק שאין לו API חינמי.
 *
 * הופעות, פסטיבלים, שביתות, הפגנות, חסימות כבישים וסגירות של אתרים הם
 * בדיוק המידע שמשנה תוכנית ביום נתון, ואין מקור מובנה שמכסה אותו לכל
 * יעד בעולם — בוודאי לא לטביליסי. לכן כאן מפעילים את המודל עם חיפוש
 * ברשת: הוא מוצא, מצטט, ומחזיר רשימה שאפשר להציג.
 *
 * הקריאה הזו יושבת בפונקציית רקע ולא בבקשה של המשתמש: סבב חיפוש יכול
 * לקחת דקות, והלקוח ממילא קורא את התוצאה מהמטמון.
 *
 * הכלל החשוב בפרומפט הוא "אל תמציא". פריט שהומצא כאן גרוע מרשימה
 * ריקה — אדם ייסע לפסטיבל שלא קיים.
 */

export interface BriefItem {
  title: string;
  when: string;
  where: string;
  detail: string;
  level: "urgent" | "warn" | "info";
  url: string;
}

export interface Brief {
  summary: string;
  items: BriefItem[];
  generatedAt: string;
  note: string;
}

export interface BriefInput {
  title: string;
  from: string;
  to: string;
  regions: string[];
}

const SYSTEM = `אתה עוזר נסיעות שבודק מה קורה ביעד בתאריכים מסוימים, ומחזיר רשימה עובדתית.

מה לחפש:
- אירועים: הופעות, פסטיבלים, שווקים, אירועי ספורט, חגיגות מקומיות.
- הפרעות: שביתות, הפגנות, חסימות כבישים, סגירת מעברים הרריים, עבודות בתחבורה.
- סגירות: מוזיאונים ואתרים שסגורים בתאריכים האלה, שעות חורף חריגות.
- אזהרות מסע רלוונטיות ועדכניות, אם יש.

כללים מחייבים:
- כל פריט חייב להתבסס על מקור שמצאת בחיפוש. צרף את הקישור.
- אל תמציא ואל תשלים מהידע הכללי שלך. פריט שאינך בטוח בו — אל תכלול.
- רשימה ריקה היא תשובה לגיטימית ונכונה. עדיף ריק על פני ניחוש.
- אל תכלול מזג אוויר. יש לו מקור נפרד ומדויק יותר.
- אל תכלול המלצות כלליות על היעד ("כדאי לבקר ב..."). רק מה שתלוי בתאריכים.
- התאריכים שמעניינים הם תאריכי הטיול בלבד.
- level: "urgent" למה שחוסם תוכנית (שביתה, כביש סגור), "warn" למה שמשנה
  אותה (סגירה, הפגנה מתוכננת), "info" לאירוע שאפשר להצטרף אליו.

בסוף התשובה החזר בלוק JSON יחיד, בתוך \`\`\`json, בדיוק במבנה הזה:
{"summary": "משפט או שניים בעברית", "items": [{"title": "", "when": "", "where": "", "detail": "", "level": "info", "url": ""}]}

הטקסט שלפני הבלוק אינו מוצג למשתמש — רק ה-JSON. כתוב את כל התוכן בעברית,
למעט שמות מקומות ואירועים שמקובל להשאיר בשפת המקור.`;

/** מוציא את בלוק ה-JSON האחרון מהתשובה. בלי סכמה קשיחה — ציטוטים של
 *  חיפוש ברשת אינם מסתדרים עם structured outputs, ולכן מפענחים בזהירות. */
function extractJson(text: string): { summary: string; items: unknown[] } | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const raw = blocks.length ? blocks[blocks.length - 1][1] : "";
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { summary?: unknown; items?: unknown };
    return {
      summary: String(parsed.summary ?? ""),
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return null;
  }
}

const LEVELS = new Set(["urgent", "warn", "info"]);

function cleanItem(raw: unknown): BriefItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = String(r.title ?? "").trim().slice(0, 160);
  if (!title) return null;
  const level = String(r.level ?? "info");
  const url = String(r.url ?? "").trim();
  return {
    title,
    when: String(r.when ?? "").trim().slice(0, 80),
    where: String(r.where ?? "").trim().slice(0, 120),
    detail: String(r.detail ?? "").trim().slice(0, 600),
    level: (LEVELS.has(level) ? level : "info") as BriefItem["level"],
    // רק http(s) — קישור שחוזר מהמודל נכנס ל-DOM בהמשך
    url: /^https?:\/\//i.test(url) ? url.slice(0, 500) : "",
  };
}

export async function buildBrief(input: BriefInput): Promise<Brief> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error("חסר ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });
  const today = new Date().toISOString().slice(0, 10);

  const question =
    `היעד: ${input.title}\n` +
    (input.regions.length ? `אזורים במסלול: ${input.regions.join(", ")}\n` : "") +
    `תאריכי הטיול: ${input.from} עד ${input.to}\n` +
    `היום: ${today}\n\n` +
    "חפש ברשת מה קורה שם בתאריכים האלה, והחזר את הרשימה.";

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: question }];
  let text = "";

  // pause_turn: סבב חיפוש ארוך נעצר באמצע ומבקש להמשיך. ממשיכים עד
  // שלוש פעמים — מעבר לזה זו כבר תקלה ולא חיפוש.
  for (let turn = 0; turn < 4; turn++) {
    const response: Anthropic.Beta.BetaMessage = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      messages,
    });

    text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  const parsed = extractJson(text);
  if (!parsed) {
    return {
      summary: "",
      items: [],
      generatedAt: new Date().toISOString(),
      note: "התשובה מהמודל לא נקראה",
    };
  }

  const items = parsed.items.map(cleanItem).filter((x): x is BriefItem => x !== null);
  return {
    summary: parsed.summary.slice(0, 600),
    items: items.slice(0, 25),
    generatedAt: new Date().toISOString(),
    note: items.length ? "" : "לא נמצאו אירועים או הפרעות לתאריכים האלה",
  };
}
