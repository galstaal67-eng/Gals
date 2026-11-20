import type { Config } from "@netlify/functions";
import { json, fail } from "../lib/shared.mts";
import { readCache, writeCache } from "../lib/cache.mts";

/**
 * GET /api/geo?q=פורטו — שם יעד לקואורדינטות, מדינה ואזור זמן.
 *
 * טיול שנוצר באשף מתחיל בלי מיקום בכלל, ובלי מיקום אין תחזית, אין חגים
 * ואין מפה — כלומר כל השכבה החיצונית שותקת. הקריאה הזו היא מה שהופכת
 * "לאן: פורטו" לנקודה על הגלובוס.
 *
 * דרך השרת ולא מהדפדפן, מאותה סיבה כמו שאר המקורות: שירות חיצוני לא
 * צריך לדעת מאיזו כתובת IP מתכננים טיול. התשובה נשמרת במטמון — שם של
 * עיר לא זז.
 */

interface Place {
  name: string;
  country: string;
  countryCode: string;
  admin: string;
  lat: number;
  lng: number;
  timezone: string;
}

export default async (req: Request) => {
  if (req.method !== "GET") return fail("שיטה לא נתמכת", 405);

  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 80);
  if (q.length < 2) return fail("צריך שם יעד", 422);

  const key = `geo:${q.toLowerCase()}`;
  const hit = await readCache(key);
  if (hit) return json(hit.doc);

  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}` +
        "&count=1&language=he&format=json",
      { headers: { accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const r = data.results?.[0];
    if (!r) return json({ found: false, query: q });

    const place: Place = {
      name: String(r.name ?? q),
      country: String(r.country ?? ""),
      countryCode: String(r.country_code ?? "").toUpperCase(),
      admin: String(r.admin1 ?? ""),
      lat: Number(r.latitude),
      lng: Number(r.longitude),
      timezone: String(r.timezone ?? ""),
    };
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
      return json({ found: false, query: q });
    }

    const out = { found: true, query: q, place };
    await writeCache(key, out);
    return json(out);
  } catch (err) {
    console.error("geo: החיפוש נכשל", err);
    return fail("חיפוש היעד נכשל. אפשר להמשיך בלי מיקום ולהוסיף אותו אחר כך.", 502);
  }
};

export const config: Config = {
  path: "/api/geo",
};
