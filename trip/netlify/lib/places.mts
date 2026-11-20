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
 *
 * שם שלא נפתר מושמט ומדווח. מוטב נקודה חסרה מנקודה שגויה.
 */

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
async function geocode(name: string, bbox: Bbox): Promise<ResolvedPoint | null> {
  const url =
    "https://nominatim.openstreetmap.org/search" +
    `?q=${encodeURIComponent(name)}&format=jsonv2&limit=1&accept-language=he` +
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
    return { name, lat, lng, type: "sight" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolvePlaces(
  names: string[],
  doc: Record<string, unknown>,
  budget: Budget
): Promise<{ points: ResolvedPoint[]; unresolved: string[] }> {
  const index = indexTrip(doc);
  const bbox = bboxOf(doc);

  const points: ResolvedPoint[] = [];
  const unresolved: string[] = [];
  let externalCalls = 0;

  for (const raw of names.slice(0, 20)) {
    const name = String(raw || "").trim().slice(0, 80);
    if (!name) continue;

    const local = findLocal(name, index);
    if (local) {
      // השם שהמודל השתמש בו גובר, כדי שהמפה תתאר את היום כפי שנוסח
      points.push({ ...local, name });
      continue;
    }

    if (!bbox || budget.lookups <= 0) {
      unresolved.push(name);
      continue;
    }

    // מדיניות Nominatim: בקשה אחת לשנייה. ההשהיה רק בין קריאות חיצוניות.
    if (externalCalls > 0) await sleep(1_100);
    externalCalls++;
    budget.lookups--;

    const found = await geocode(name, bbox);
    if (found) points.push(found);
    else unresolved.push(name);
  }

  return { points, unresolved };
}
