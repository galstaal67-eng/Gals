/**
 * שמות מקומות → נקודות על המפה.
 *
 * כשהעוזר משנה לאן יום הולך, המפה חייבת לזוז איתו — אחרת כרטיס היום אומר
 * דבר אחד והמפה מראה דבר אחר, וזה גרוע מלא לשנות בכלל.
 *
 * המודל מחזיר **שמות בלבד**, לעולם לא קואורדינטות. קואורדינטה שהומצאה
 * נראית בדיוק כמו קואורדינטה נכונה, ואי אפשר לזהות את הטעות עד שעומדים
 * במקום הלא נכון. לכן כל שם נפתר כאן משני מקורות אמינים בלבד:
 *
 *   1. הנקודות שכבר קיימות בטיול — ללא קריאה חיצונית בכלל. זה מכסה את
 *      רוב המקרים, כי רוב השינויים מזיזים מקומות שכבר במסלול.
 *   2. Nominatim של OpenStreetMap, מתוחם לאזור הטיול.
 *   3. ואם גם זה נכשל — תרגום השם לשם החיפוש שלו, וניסיון שני.
 *
 * ── למה שלב 3 קיים ──
 * האפליקציה כולה בעברית, ולכן המודל מחזיר "שוק דזרטירי". ב-OpenStreetMap
 * המקום הזה נקרא "დეზერტირების ბაზარი" ו-"Dezerter Bazaar"; שם בעברית
 * קיים שם רק למקומות מפורסמים מאוד. כלומר **כל מקום חדש שהעוזר הוסיף
 * נכשל בחיפוש** — והתוצאה היא יום שלוח הזמנים שלו התעדכן והמפה שלו לא.
 * זה לא היה באג גלוי: המפה פשוט נשארה כפי שהייתה.
 *
 * לכן מה שלא נפתר נאסף, ונשלח בקריאה אחת קטנה שמחזירה לכל שם את מחרוזת
 * החיפוש שלו — באנגלית או בכתב המקומי, עם שם העיר. הקריאה הזו אינה
 * ממציאה קואורדינטות: היא רק מנסחת שאילתה, והאימות נשאר אצל Nominatim.
 *
 * שם שלא נפתר גם ככה מושמט ומדווח. מוטב נקודה חסרה מנקודה שגויה.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { resolveApiKey } from "./shared.mts";

export interface ResolvedPoint {
  name: string;
  lat: number;
  lng: number;
  type: string;
}

export interface Budget {
  lookups: number;
}

/** השוואה סלחנית: רווחים כפולים, גרשיים ומקפים אינם אמורים להכשיל התאמה */
function norm(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/["'`״׳()]/g, "")
    .replace(/[-–—_,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Indexed {
  key: string;
  point: ResolvedPoint;
}

/** כל הנקודות שכבר קיימות בטיול, מכל הימים — כולל מלונות */
function indexTrip(doc: Record<string, unknown>): Indexed[] {
  const out: Indexed[] = [];
  const days = Array.isArray(doc.days) ? doc.days : [];
  for (const raw of days) {
    const day = raw as Record<string, unknown>;
    const points = Array.isArray(day.points) ? day.points : [];
    for (const p of points) {
      const pt = p as Record<string, unknown>;
      const lat = Number(pt.lat);
      const lng = Number(pt.lng);
      const name = String(pt.name ?? "");
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({
        key: norm(name),
        point: { name, lat, lng, type: String(pt.type ?? "sight") },
      });
    }
    const hotel = day.hotel as Record<string, unknown> | undefined;
    if (hotel && Number(hotel.lat)) {
      out.push({
        key: norm(String(hotel.name ?? "")),
        point: {
          name: String(hotel.name ?? ""),
          lat: Number(hotel.lat),
          lng: Number(hotel.lng),
          type: "hotel",
        },
      });
    }
  }
  return out;
}

function findLocal(name: string, index: Indexed[]): ResolvedPoint | null {
  const key = norm(name);
  if (!key) return null;
  const exact = index.find((i) => i.key === key);
  if (exact) return exact.point;
  // הכלה לשני הכיוונים, אבל רק על שם ארוך מספיק כדי שלא יתפוס במקרה
  if (key.length >= 4) {
    const near = index.find((i) => i.key.includes(key) || key.includes(i.key));
    if (near) return near.point;
  }
  return null;
}

interface Bbox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

function bboxOf(doc: Record<string, unknown>): Bbox | null {
  const meta = doc.meta as Record<string, unknown> | undefined;
  const b = meta?.bbox as Record<string, unknown> | undefined;
  if (!b) return null;
  const nums = ["latMin", "latMax", "lngMin", "lngMax"].map((k) => Number(b[k]));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return { latMin: nums[0], latMax: nums[1], lngMin: nums[2], lngMax: nums[3] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * חיפוש ב-Nominatim, מתוחם לאזור הטיול.
 *
 * התיחום אינו קישוט: "גשר השלום" קיים בעשרות ערים, ובלי bounded=1 אפשר
 * לקבל גשר בארץ אחרת לגמרי. בלי תיחום לטיול — לא פונים לשירות בכלל.
 */
async function geocode(query: string, bbox: Bbox, label: string): Promise<ResolvedPoint | null> {
  /*
   * אין כאן accept-language=he. השם שיוצג הוא `label` — מה שהמודל כתב,
   * בעברית — ומ-Nominatim צריך רק קואורדינטה. בקשת תשובה בעברית הייתה
   * מטה את הדירוג לטובת רשומות שיש להן תרגום לעברית, וזה בדיוק ההפך
   * ממה שרוצים כשמחפשים מקום מקומי.
   */
  const url =
    "https://nominatim.openstreetmap.org/search" +
    `?q=${encodeURIComponent(query)}&format=jsonv2&limit=1` +
    `&viewbox=${bbox.lngMin},${bbox.latMax},${bbox.lngMax},${bbox.latMin}&bounded=1`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        // מדיניות Nominatim דורשת מזהה לקוח. שם גנרי של האפליקציה בלבד —
        // אין כאן שום פרט מזהה של המשתמש.
        "user-agent": "trip-planner/1.0",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<Record<string, unknown>>;
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { name: label, lat, lng, type: "sight" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SearchNames = z.object({
  names: z.array(
    z.object({
      he: z.string().describe("השם בדיוק כפי שנשלח אליך"),
      q: z.string().describe(
        "מחרוזת חיפוש ל-OpenStreetMap: השם הרשמי של המקום באנגלית או " +
          "בכתב המקומי, ואחריו שם העיר. ריק אם אינך יודע את המקום."
      ),
    })
  ),
});

/**
 * שמות בעברית → מחרוזות חיפוש שמפה מכירה.
 *
 * קריאה אחת לכל הקבוצה, ולא אחת לכל שם. היא גם לא נוגעת בקואורדינטות:
 * מה שחוזר ממנה הוא טקסט לחיפוש בלבד, והקואורדינטה עדיין מגיעה רק
 * מ-Nominatim. מודל שימציא מקום יקבל "לא נמצא" ולא סיכה על המפה.
 */
async function searchNames(
  names: string[],
  doc: Record<string, unknown>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const apiKey = resolveApiKey();
  if (!apiKey || !names.length) return out;

  const meta = (doc.meta || {}) as Record<string, unknown>;
  const where = [meta.title, ...(Array.isArray(meta.countries) ? meta.countries : [])]
    .filter(Boolean)
    .join(", ")
    .slice(0, 120);

  try {
    const res = await new Anthropic({ apiKey }).beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 1200,
      output_config: { effort: "low", format: zodOutputFormat(SearchNames) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        {
          type: "text",
          text:
            "אתה מקבל שמות מקומות בעברית ומחזיר לכל אחד את מחרוזת החיפוש " +
            "שלו במפות — השם הרשמי באנגלית או בכתב המקומי, ואחריו שם העיר. " +
            'דוגמה: "שוק דזרטירי" → "Dezerter Bazaar, Tbilisi". ' +
            "אל תמציא מקומות. אם אינך יודע בוודאות על איזה מקום מדובר, " +
            "החזר q ריק. החזר שורה לכל שם שנשלח, באותו סדר.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `האזור: ${where || "לא צוין"}\n\nהמקומות:\n${names.join("\n")}`,
        },
      ],
    });

    for (const row of res.parsed_output?.names ?? []) {
      const he = String(row.he || "").trim();
      const q = String(row.q || "").trim();
      if (he && q) out.set(norm(he), q.slice(0, 120));
    }
  } catch {
    /* בלי תרגום פשוט ממשיכים; מה שלא נפתר ידווח כלא נפתר */
  }
  return out;
}

export async function resolvePlaces(
  names: string[],
  doc: Record<string, unknown>,
  budget: Budget
): Promise<{ points: ResolvedPoint[]; unresolved: string[] }> {
  const index = indexTrip(doc);
  const bbox = bboxOf(doc);

  /*
   * הסדר נשמר: הנקודות חייבות לצאת לפי סדר הביקור, גם אם חלקן נפתרו
   * בסבב הראשון וחלקן רק בשני. לכן תאים לפי מיקום, ולא דחיפה לסוף.
   */
  const slots: (ResolvedPoint | null)[] = [];
  const labels: string[] = [];
  const pending: number[] = [];
  let externalCalls = 0;

  const hit = async (query: string, label: string) => {
    if (!bbox || budget.lookups <= 0) return null;
    // מדיניות Nominatim: בקשה אחת לשנייה. ההשהיה רק בין קריאות חיצוניות.
    if (externalCalls > 0) await sleep(1_100);
    externalCalls++;
    budget.lookups--;
    return geocode(query, bbox, label);
  };

  /* ---------- סבב ראשון: הטיול עצמו, ואז השם כפי שהוא ---------- */
  for (const raw of names.slice(0, 20)) {
    const name = String(raw || "").trim().slice(0, 80);
    if (!name) continue;

    const i = labels.push(name) - 1;
    const local = findLocal(name, index);
    if (local) {
      // השם שהמודל השתמש בו גובר, כדי שהמפה תתאר את היום כפי שנוסח
      slots[i] = { ...local, name };
      continue;
    }

    /*
     * שם בעברית אינו נשלח לסבב הראשון בכלל. הוא כמעט לעולם לא יימצא,
     * וכל ניסיון כזה עולה שנייה שלמה מהתקציב בגלל מדיניות הקצב של
     * Nominatim — שנייה שהייתה חסרה לשם שכן אפשר למצוא.
     */
    if (/[\u0590-\u05FF]/.test(name)) { pending.push(i); continue; }

    slots[i] = await hit(name, name);
    if (!slots[i]) pending.push(i);
  }

  /* ---------- סבב שני: אותם שמות, הפעם כשאילתה שמפה מכירה ---------- */
  if (pending.length && bbox && budget.lookups > 0) {
    const map = await searchNames(
      pending.map((i) => labels[i]),
      doc
    );
    for (const i of pending) {
      if (budget.lookups <= 0) break;
      const q = map.get(norm(labels[i]));
      if (!q) continue;
      slots[i] = await hit(q, labels[i]);
    }
  }

  const points: ResolvedPoint[] = [];
  const unresolved: string[] = [];
  labels.forEach((label, i) => {
    if (slots[i]) points.push(slots[i] as ResolvedPoint);
    else unresolved.push(label);
  });

  return { points, unresolved };
}
