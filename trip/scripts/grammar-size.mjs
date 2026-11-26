/**
 * מדידת גודל הסכמה של /api/ai — הרצה: node scripts/grammar-size.mjs
 *
 * structured outputs מהדר את סכמת התשובה לדקדוק, ולדקדוק יש תקרת גודל.
 * כשחרגנו ממנה השירות החזיר 400 ו**כל** העוזר נפל, גם בקשות טקסט שלא
 * נגעו במסמכים — וטסט שמדמה את השרת אינו יכול לתפוס את זה, כי הוא לא
 * קורא למודל בכלל.
 *
 * אין דרך לדעת מהקוד איפה בדיוק התקרה. מה שכן אפשר למדוד הוא יחס מול
 * הסכמה שרצה באוויר במשך שבועות. לפני שמרחיבים סכמה — מריצים את זה.
 */
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const PlanRow = z.object({ time: z.string(), text: z.string() });

const DayChange = z.object({
  n: z.number().int(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  mode: z.enum(["flight", "drive", "train", "hike", "city"]).nullable(),
  driveKm: z.number().nullable(),
  driveHours: z.number().nullable(),
  driveNote: z.string().nullable(),
  hotelName: z.string().nullable(),
  hotelArea: z.string().nullable(),
  plan: z.array(PlanRow).nullable(),
  tips: z.array(z.string()).nullable(),
  places: z.array(z.string()).nullable(),
});

const Expense = z.object({
  date: z.string(), amount: z.number().positive(), currency: z.string(),
  category: z.string(), payer: z.string(), note: z.string(),
});

const Question = z.object({
  text: z.string(),
  options: z.array(z.string()).nullable(),
});

const FlightLeg = z.object({
  leg: z.enum(["out", "back"]),
  flightNo: z.string(), date: z.string(), dep: z.string(), arr: z.string(),
  from: z.string(), to: z.string(), terminal: z.string(), duration: z.string(),
  seats: z.array(z.object({ who: z.string(), seat: z.string() })),
});

const DocMetaBig = z.object({
  index: z.number().int(), title: z.string(),
  kind: z.enum(["boarding", "ticket", "event", "attraction", "lodging",
                "transport", "rental", "insurance", "info", "other"]),
  dayN: z.number().int().nullable(),
  leg: z.enum(["out", "back"]).nullable(),
  who: z.string(), note: z.string(),
});

const DocMeta = z.object({
  index: z.number().int(), title: z.string(),
  kind: z.enum(["flight", "event", "lodging", "transport", "info", "other"]),
  dayN: z.number().int().nullable(),
  leg: z.enum(["out", "back"]).nullable(),
  note: z.string(),
});

const DocDayChange = z.object({
  n: z.number().int(),
  plan: z.array(PlanRow).nullable(),
  tips: z.array(z.string()).nullable(),
  places: z.array(z.string()).nullable(),
  hotelName: z.string().nullable(),
  hotelArea: z.string().nullable(),
});

/* --- the three variants --- */

// what ran in production for weeks, before documents
const BASELINE = z.object({
  kind: z.enum(["trip_edit", "expense", "unclear"]),
  summary: z.string(), warning: z.string().nullable(),
  dayChanges: z.array(DayChange),
  metaSubtitle: z.string().nullable(),
  expenses: z.array(Expense),
});

// what the API rejected
const BROKEN = z.object({
  kind: z.enum(["trip_edit", "expense", "question", "unclear"]),
  summary: z.string(), warning: z.string().nullable(),
  questions: z.array(z.object({
    id: z.string(), text: z.string(), options: z.array(z.string()).nullable(),
  })),
  dayChanges: z.array(DayChange),
  flights: z.array(FlightLeg),
  docs: z.array(DocMetaBig),
  metaSubtitle: z.string().nullable(),
  expenses: z.array(Expense),
});

// the two new ones
const TEXT = z.object({
  kind: z.enum(["trip_edit", "expense", "unclear"]),
  summary: z.string(), warning: z.string().nullable(),
  dayChanges: z.array(DayChange),
  metaSubtitle: z.string().nullable(),
  expenses: z.array(Expense),
});

const DOC = z.object({
  kind: z.enum(["trip_edit", "question", "unclear"]),
  summary: z.string(), warning: z.string().nullable(),
  questions: z.array(Question),
  docs: z.array(DocMeta),
  dayChanges: z.array(DocDayChange),
});

/* --- /api/plan: שתי הפאזות של בניית טיול --- */

const SkeletonDay = z.object({
  n: z.number().int(), base: z.string(), title: z.string(),
  summary: z.string(), stay: z.string(),
});
const SKELETON = z.object({
  title: z.string(), subtitle: z.string(),
  countries: z.array(z.string()), note: z.string(),
  days: z.array(SkeletonDay),
});

const DayDetail = z.object({
  n: z.number().int(), title: z.string(), summary: z.string(),
  mode: z.enum(["flight", "drive", "train", "hike", "city"]),
  driveKm: z.number(), driveHours: z.number(), driveNote: z.string(),
  hotelName: z.string(), hotelArea: z.string(),
  plan: z.array(PlanRow), tips: z.array(z.string()), places: z.array(z.string()),
});
const DETAIL = z.object({ days: z.array(DayDetail) });

const FLIGHT = z.object({
  flightNo: z.string(), date: z.string(), dep: z.string(), arr: z.string(),
  from: z.string(), to: z.string(), terminal: z.string(), duration: z.string(),
  seats: z.array(z.object({ who: z.string(), seat: z.string() })),
  note: z.string(),
});

function stats(name, schema) {
  const out = zodOutputFormat(schema, "result");
  const json = JSON.stringify(out);
  let props = 0, enums = 0, enumValues = 0, unions = 0;
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.properties) props += Object.keys(n.properties).length;
    if (n.enum) { enums++; enumValues += n.enum.length; }
    if (n.anyOf || n.oneOf) unions++;
    if (Array.isArray(n.type) && n.type.length > 1) unions++;
    Object.values(n).forEach(walk);
  };
  walk(out);
  return { name, bytes: json.length, props, enums, enumValues, unions };
}

/* /api/ask — שאלה על הרגע הנוכחי, עם חיפוש ברשת */
const ASK = z.object({
  headline: z.string(),
  bullets: z.array(z.string()),
  caution: z.string().nullable(),
  fresh: z.boolean(),
  alert: z.boolean(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});

const rows = [
  stats("BASELINE (worked in production)", BASELINE),
  stats("BROKEN   (rejected: grammar too large)", BROKEN),
  stats("new TEXT path", TEXT),
  stats("new DOC path", DOC),
  stats("flight read (already in production)", FLIGHT),
  stats("ask (web search)", ASK),
  stats("plan: skeleton", SKELETON),
  stats("plan: day detail", DETAIL),
];

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("variant", 42), pad("bytes", 8), pad("props", 7), pad("enums", 7), pad("enumVals", 9), "unions");
for (const r of rows) {
  console.log(pad(r.name, 42), pad(r.bytes, 8), pad(r.props, 7), pad(r.enums, 7), pad(r.enumValues, 9), r.unions);
}

const base = rows[0].bytes;
console.log("\nrelative to the baseline that worked:");
for (const r of rows.slice(1)) {
  console.log(`  ${pad(r.name, 42)} ${(r.bytes / base).toFixed(2)}x`);
}
