import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { fail, resolveApiKey, streamJson, StreamError } from "../lib/shared.mts";
import { resolvePlaces } from "../lib/places.mts";

/**
 * POST /api/plan — בניית טיול שלם מתוך תדריך.
 *
 * ── למה שתי פאזות ולא אחת ──
 * טיול של שבעה ימים הוא פלט ארוך. קריאה אחת שמייצרת אותו חוצה את תקרת
 * הזמן של פונקציה, והמשתמש יושב מול מסך ריק בלי לדעת אם משהו קורה.
 * לכן הלקוח מנהל את התהליך: קודם **שלד** — שורה אחת לכל יום, קריאה
 * קצרה אחת — ואז **פירוט** במנות של שלושה ימים. כל קריאה חוזרת תוך
 * שניות, והמשתמש רואה התקדמות אמיתית ולא ספינר.
 *
 * ── ולמה סכמת הפירוט זהה ל-DayChange של העוזר ──
 * structured outputs מהדר את הסכמה לדקדוק שיש לו תקרת גודל, וחריגה
 * מפילה את הבקשה כולה ב-400. הצורה שבשימוש כאן כבר רצה באוויר שבועות
 * ונמדדת ב-scripts/grammar-size.mjs. סכמה חדשה ושאפתנית יותר הייתה
 * הימור; זו אינה.
 *
 * ── והמקומות ──
 * המודל מחזיר **שמות בלבד**, והשרת פותר אותם לקואורדינטות דרך
 * resolvePlaces — אותו נתיב של העוזר. מודל שממציא קואורדינטות ממציא
 * אותן משכנעות, ונקודה שגויה על מפה גרועה מנקודה חסרה.
 */

/* ------------------------------------------------------------------ */
/*  סוגי הטיולים                                                       */
/* ------------------------------------------------------------------ */

/**
 * כל סוג הוא לא תווית אלא **כללי בנייה**: מה נחשב יום סביר, מה המרחק
 * היומי, איפה ישנים, ומה בכלל התחנות. יום של טרק רגלי אינו יום עירוני
 * עם נעליים אחרות.
 */
const KINDS = {
  city: {
    label: "עיר",
    rule:
      "ימים עירוניים ברגל ובתחבורה ציבורית. 4–7 עצירות ליום, " +
      "הליכה של 1–2 ק\"מ בין עצירות סמוכות, ארוחות בתוך לוח הזמנים. " +
      "mode = city, driveKm = 0 אלא אם יוצאים מחוץ לעיר.",
  },
  trek: {
    label: "טרק רגלי",
    rule:
      "ימי הליכה. כל יום הוא מקטע מסלול עם נקודת התחלה, נקודות ציון " +
      "בדרך ונקודת סיום. ציין בכל יום אורך בק\"מ, שעות הליכה ועלייה " +
      "מצטברת, ואת סוג הלינה בסוף המקטע (רפיוג', אכסניה, מחנה). " +
      "mode = hike. אל תתכנן מעל 20 ק\"מ ליום בלי סיבה.",
  },
  cycle: {
    label: "אופניים",
    rule:
      "ימי רכיבה. 40–90 ק\"מ ליום לפי הקצב, עם עצירות לאוכל ולמים " +
      "ועם מודעות לשיפועים. ציין מרחק ושעות רכיבה. העדף מסלולים " +
      "ייעודיים ודרכים שקטות. mode = hike, ו-driveKm הוא מרחק הרכיבה.",
  },
  moto: {
    label: "אופנועים",
    rule:
      "ימי רכיבה על אופנוע. 150–350 ק\"מ ליום, כבישים מתפתלים ונופיים " +
      "על פני מהירים, עצירות דלק וקפה כל 1.5–2 שעות. " +
      "mode = drive, driveKm = מרחק היום.",
  },
  caravan: {
    label: "קרוואן",
    rule:
      "נסיעה עם קרוואן או ואן. 100–250 ק\"מ ליום, ולינה באתר מוסדר — " +
      "ציין את שם האתר ב-hotelName ואת מה שיש בו (חשמל, מים, שפכים). " +
      "התחשב בגובה, ברוחב דרכים ובאיסורי חניית לילה. mode = drive.",
  },
  road: {
    label: "רוד־טריפ ברכב",
    rule:
      "נסיעה ברכב בין יעדים. 100–300 ק\"מ ליום, עם עצירות דרך ולא רק " +
      "יעדי קצה. ציין מרחק ושעות נסיעה. mode = drive.",
  },
  resort: {
    label: "ריזורט / חופש",
    rule:
      "ימים רגועים סביב בסיס אחד. 2–4 עצירות ליום לכל היותר, הרבה זמן " +
      "חופשי, ולפחות יום אחד בלי שום תוכנית מלבד הבריכה או החוף. " +
      "אל תמלא את היום. mode = city, driveKm = 0.",
  },
  mixed: {
    label: "מעורב",
    rule: "שלב ימי עיר, ימי טבע וימי נסיעה לפי מה שהיעדים מזמינים.",
  },
} as const;

type KindKey = keyof typeof KINDS;
const kindOf = (v: unknown): KindKey =>
  typeof v === "string" && v in KINDS ? (v as KindKey) : "mixed";

const PACE = {
  easy: "קצב רגוע: בוקר מאוחר, פחות עצירות, זמן חופשי בכל יום.",
  normal: "קצב רגיל: יום מלא אבל לא דחוס, עם הפסקות אמיתיות.",
  packed: "קצב דחוס: מוציאים מהיום את המקסימום, יציאה מוקדמת.",
} as const;

/* ------------------------------------------------------------------ */
/*  הסכמות                                                             */
/* ------------------------------------------------------------------ */

/** השלד: שורה אחת לכל יום. קצר בכוונה — זו קריאה שצריכה לחזור מהר. */
const SkeletonDay = z.object({
  n: z.number().int(),
  base: z.string().describe("היעד שבו היום הזה מתרחש, כפי שנכתב בתדריך"),
  title: z.string().describe("כותרת קצרה ליום, בעברית"),
  summary: z.string().describe("משפט אחד או שניים: מה קורה ביום הזה"),
  stay: z.string().describe("איפה ישנים בסוף היום. ריק ביום האחרון"),
});

const Skeleton = z.object({
  title: z.string().describe("שם הטיול, קצר"),
  subtitle: z.string().describe("שורה אחת שמתארת את מבנה הטיול"),
  countries: z.array(z.string()).describe("המדינות שהטיול עובר בהן"),
  note: z.string().describe("משפט על החלטה שקיבלת ושכדאי שהמשתמש יידע"),
  days: z.array(SkeletonDay),
});

/** הפירוט: אותה צורה בדיוק של DayChange בעוזר — ראו ההערה למעלה */
const PlanRow = z.object({ time: z.string(), text: z.string() });

const DayDetail = z.object({
  n: z.number().int(),
  title: z.string(),
  summary: z.string(),
  mode: z.enum(["flight", "drive", "train", "hike", "city"]),
  driveKm: z.number(),
  driveHours: z.number(),
  driveNote: z.string(),
  hotelName: z.string(),
  hotelArea: z.string(),
  plan: z.array(PlanRow),
  tips: z.array(z.string()),
  places: z.array(z.string()).describe("שמות המקומות של היום, לפי סדר הביקור"),
});

const Detail = z.object({ days: z.array(DayDetail) });

/* ------------------------------------------------------------------ */
/*  הפרומפטים                                                          */
/* ------------------------------------------------------------------ */

const BASE = `אתה מתכנן טיולים בעברית. אתה בונה מסלול אמיתי שאפשר לצאת איתו.

כללים:
- הכול בעברית, בטון ענייני: בלי שיווק, בלי סימני קריאה, בלי "חוויה בלתי נשכחת".
- מקומות אמיתיים בשמות שאפשר למצוא במפה. אל תמציא מקום, מסעדה או אתר.
- התחשב בעונה ובשעות האור של התאריכים שנשלחו: מה שדורש אור לא נכנס לשעה
  שבה כבר חושך.
- התחשב בזמני פתיחה אופייניים: מוזיאון ביום שני, שוק אחרי הצהריים, מסעדה
  שפתוחה רק לארוחת ערב.
- אל תמציא מחירים, שעות טיסה או מספרי הזמנה.
- כשאתה לא בטוח במשהו — כתוב אותו כהמלצה ולא כעובדה, או השמט אותו.`;

const SYS_SKELETON = `${BASE}

אתה מקבל תדריך ומחזיר **שלד**: שורה אחת לכל יום בטיול.

- חלק את הימים בין היעדים לפי מספר הלילות שנדרש בכל אחד, ולפי הסדר שנשלח.
- יום המעבר בין יעד ליעד הוא יום של נסיעה, והוא נספר ליעד שמגיעים אליו.
- היום הראשון מתחיל בשעת ההגעה שנשלחה, והאחרון נגמר בשעת היציאה. אל
  תתכנן בהם יום מלא.
- \`stay\` הוא איפה ישנים בסוף היום — שם של עיר או אזור, לא שם מלון
  שהמצאת. ביום האחרון הוא ריק.
- ב-\`note\` כתוב החלטה אחת מהותית שקיבלת: חלוקת לילות, יעד שקיבל פחות
  ממה שביקשו, או סדר שהפכת — ולמה.`;

const SYS_DETAIL = `${BASE}

אתה מקבל תדריך, שלד של הטיול כולו, ורשימת ימים לפרט. פרט **רק** אותם.

- \`plan\` הוא לוח הזמנים של היום: שעה אמיתית לכל שורה, ברצף הגיוני,
  כולל ארוחות וכולל זמני מעבר. 5–10 שורות ליום רגיל.
- \`places\` הוא רשימת המקומות של היום **לפי סדר הביקור**, בשמות בלבד.
  הקואורדינטות נפתרות בשרת, ולכן שם מדויק של מקום אמיתי הוא קריטי.
  אל תכלול בו ארוחות גנריות ("ארוחת בוקר במלון") — רק מקומות שיש להם
  נקודה על המפה.
- \`tips\` הוא 2–4 דברים מעשיים ליום הזה: מה לקנות מראש, מה פתוח מתי,
  מה לקחת, מה לא שווה. לא כללי — ספציפי ליום.
- \`hotelName\` הוא האזור או סוג הלינה כשאין מלון ידוע, ולא שם מומצא.
- \`driveKm\` ו-\`driveHours\` לפי סוג הטיול. ביום שאין בו נסיעה — 0.`;

/* ------------------------------------------------------------------ */
/*  התדריך כטקסט                                                       */
/* ------------------------------------------------------------------ */

const str = (v: unknown, max = 200) =>
  String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

interface Stop {
  name: string;
  nights: number;
  /* הקואורדינטות שהאשף כבר איתר. הן לא קישוט: resolvePlaces מחפש
     **בתוך תיבת היעד** בלבד, ובלי תיבה הוא מחזיר אפס תוצאות — גם על
     שמות שכל מפה מכירה. ראו boxOf. */
  lat?: number;
  lng?: number;
}

interface Brief {
  kind: KindKey;
  stops: Stop[];
  from: string;
  to: string;
  outTime: string;
  backTime: string;
  pace: keyof typeof PACE;
  interests: string[];
  budget: string;
  lodging: string;
  travellers: number;
  currency: string;
  musts: string;
  limits: string;
}

function readBrief(raw: Record<string, unknown>): Brief | string {
  const kind = kindOf(raw.kind);
  const stops = (Array.isArray(raw.stops) ? raw.stops : [])
    .map((s) => {
      const o = (s || {}) as Record<string, unknown>;
      const lat = Number(o.lat);
      const lng = Number(o.lng);
      return {
        name: str(o.name, 80),
        nights: Math.max(0, Math.min(60, Number(o.nights) || 0)),
        ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
      };
    })
    .filter((s) => s.name);
  if (!stops.length) return "צריך לפחות יעד אחד";

  const from = str(raw.from, 10);
  const to = str(raw.to, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return "תאריכים לא תקינים";
  }
  if (to < from) return "תאריך החזרה מוקדם מתאריך היציאה";

  const pace = (["easy", "normal", "packed"] as const).includes(raw.pace as never)
    ? (raw.pace as keyof typeof PACE)
    : "normal";

  return {
    kind,
    stops: stops.slice(0, 12),
    from,
    to,
    outTime: str(raw.outTime, 5),
    backTime: str(raw.backTime, 5),
    pace,
    interests: (Array.isArray(raw.interests) ? raw.interests : []).map((x) => str(x, 30)).slice(0, 12),
    budget: str(raw.budget, 20),
    lodging: str(raw.lodging, 20),
    travellers: Math.max(1, Math.min(20, Number(raw.travellers) || 2)),
    currency: str(raw.currency, 3),
    musts: str(raw.musts, 600),
    limits: str(raw.limits, 600),
  };
}

/**
 * תיבת היעד, סביב כל היעדים שאותרו.
 *
 * אותו תיחום נדיב של buildTrip — 1.2° ברוחב ו-1.6° באורך — כדי שטיול
 * יום לכל כיוון ייכנס אליה. בלי אף יעד שאותר אין תיבה, ואז המקומות
 * פשוט לא נפתרים: זה מדווח למשתמש, ולא הופך לנקודה מומצאת.
 */
function boxOf(stops: Stop[]) {
  const pts = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (!pts.length) return null;
  const lat = pts.map((s) => s.lat as number);
  const lng = pts.map((s) => s.lng as number);
  return {
    latMin: Math.min(...lat) - 1.2,
    latMax: Math.max(...lat) + 1.2,
    lngMin: Math.min(...lng) - 1.6,
    lngMax: Math.max(...lng) + 1.6,
  };
}

const dayCount = (from: string, to: string) => {
  const a = Date.parse(from + "T12:00:00Z");
  const b = Date.parse(to + "T12:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.min(60, Math.max(1, Math.round((b - a) / 86400000) + 1));
};

const BUDGET: Record<string, string> = {
  low: "תקציב חסכוני: אוכל רחוב ושווקים, אתרים חינמיים, תחבורה ציבורית.",
  mid: "תקציב בינוני: מסעדות סבירות, כניסה לאתרים מרכזיים, מוניות כשצריך.",
  high: "תקציב נוח: מסעדות טובות, סיורים מודרכים, נוחות על פני חיסכון.",
};

const LODGING: Record<string, string> = {
  hotel: "מלונות",
  apartment: "דירות",
  hostel: "אכסניות",
  camp: "קמפינג",
  refuge: "בקתות ורפיוג'ים",
  mixed: "לינה מעורבת",
};

function briefText(b: Brief): string {
  const n = dayCount(b.from, b.to);
  const lines = [
    `סוג הטיול: ${KINDS[b.kind].label}. ${KINDS[b.kind].rule}`,
    `יעדים לפי הסדר: ${b.stops.map((s) => `${s.name} (${s.nights} לילות)`).join(" ← ")}`,
    `תאריכים: ${b.from} עד ${b.to} — ${n} ימים.`,
    b.outTime ? `שעת ההגעה ביום הראשון: ${b.outTime}.` : "",
    b.backTime ? `שעת היציאה ביום האחרון: ${b.backTime}.` : "",
    `${b.travellers} נוסעים. ${PACE[b.pace]}`,
    b.interests.length ? `מה מעניין אותם: ${b.interests.join(", ")}.` : "",
    BUDGET[b.budget] || "",
    LODGING[b.lodging] ? `לינה: ${LODGING[b.lodging]}.` : "",
    b.musts ? `חובה שייכנס: ${b.musts}` : "",
    b.limits ? `מגבלות והעדפות: ${b.limits}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/* ------------------------------------------------------------------ */
/*  הקריאה                                                             */
/* ------------------------------------------------------------------ */

export default async (req: Request) => {
  if (req.method !== "POST") return fail("שיטה לא נתמכת", 405);

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return fail(
      "התכנון אינו מוגדר. צריך להוסיף ANTHROPIC_API_KEY במשתני הסביבה של Netlify.",
      503
    );
  }
  const gate = process.env.AI_ACCESS_CODE?.trim();

  let body: Record<string, unknown> | null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("גוף הבקשה אינו JSON תקין", 400);
  }
  if (!body) return fail("גוף הבקשה ריק", 400);
  if (gate && String(body.code ?? "").trim() !== gate) return fail("קוד גישה שגוי", 401);

  const brief = readBrief((body.brief || {}) as Record<string, unknown>);
  if (typeof brief === "string") return fail(brief, 422);

  const phase = body.phase === "detail" ? "detail" : "skeleton";
  const client = new Anthropic({ apiKey });

  return streamJson(async () => {
    if (phase === "skeleton") return skeleton(client, brief);
    return detail(client, brief, body!);
  });
};

async function skeleton(client: Anthropic, b: Brief) {
  const n = dayCount(b.from, b.to);
  const res = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(Skeleton) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYS_SKELETON, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `${briefText(b)}\n\nהחזר שלד של ${n} ימים, ממוספרים 1 עד ${n}.`,
      },
    ],
  });

  if (res.stop_reason === "refusal") throw new StreamError("המודל סירב לתדריך הזה.");
  const out = res.parsed_output;
  if (!out) throw new StreamError("השלד לא נקרא. נסו שוב.");

  return { skeleton: out, days: n };
}

async function detail(client: Anthropic, b: Brief, body: Record<string, unknown>) {
  const sk = body.skeleton as z.infer<typeof Skeleton> | undefined;
  if (!sk || !Array.isArray(sk.days)) throw new StreamError("חסר שלד הטיול");

  const want = (Array.isArray(body.want) ? body.want : [])
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0)
    .slice(0, 4);
  if (!want.length) throw new StreamError("לא נאמר אילו ימים לפרט");

  // השלד כולו נשלח גם כשמפרטים שלושה ימים: בלי לדעת מה קורה מחר אי
  // אפשר לסיים את היום של היום בשעה הנכונה ובמקום הנכון
  const outline = sk.days
    .map((d) => `יום ${d.n} · ${d.base} · ${d.title} — ${d.summary}${d.stay ? ` · לינה: ${d.stay}` : ""}`)
    .join("\n");

  const dates = want.map((n) => {
    const t = Date.parse(b.from + "T12:00:00Z") + (n - 1) * 86400000;
    return `יום ${n} = ${new Date(t).toISOString().slice(0, 10)}`;
  });

  const res = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(Detail) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYS_DETAIL, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          `${briefText(b)}\n\nהשלד:\n${outline}\n\n${dates.join("\n")}\n\n` +
          `פרט את הימים: ${want.join(", ")}. החזר רק אותם.`,
      },
    ],
  });

  if (res.stop_reason === "refusal") throw new StreamError("המודל סירב לימים האלה.");
  const out = res.parsed_output;
  if (!out) throw new StreamError("הפירוט לא נקרא. נסו שוב.");

  /* המקומות נפתרים כאן, לא אצל המודל. תקציב של 10 חיפושים למנה של
     שלושה ימים — שם בעברית עולה שניים, תרגום וחיפוש. */
  const doc = {
    meta: { countries: sk.countries || [], bbox: boxOf(b.stops) },
    days: [] as unknown[],
  };
  const days = [];
  for (const d of out.days) {
    const { points, unresolved } = await resolvePlaces(d.places || [], doc, { lookups: 10 });
    days.push({ ...d, points, unresolved });
  }

  return { days };
}

export const config: Config = { path: "/api/plan" };
