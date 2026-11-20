import type { Config } from "@netlify/functions";
import { json, fail, tripIdOf, NO_TRIP } from "../lib/shared.mts";
import { readCache, writeCache } from "../lib/cache.mts";
import {
  fetchWeather,
  fetchAir,
  fetchHolidays,
  fetchQuakes,
  fetchRates,
  resolveCountry,
  buildAlerts,
  type LivePoint,
  type SourceStatus,
} from "../lib/live.mts";

/**
 * POST /api/live?trip=<id> — כל מה שהעולם יודע על הטיול הזה עכשיו.
 *
 * הלקוח שולח את מה שהוא כבר יודע (נקודה מייצגת לכל יום, תיחום, תאריכים),
 * והשרת מביא מזג אוויר, איכות אוויר, חגים, רעידות אדמה ושערי מטבע,
 * גוזר מהם התרעות, ומצרף את ה"מה קורה בעיר" האחרון שנבנה ברקע.
 *
 * התשובה נשמרת במטמון לחצי שעה. תחזית לא משתנה מהר יותר מזה, ואין סיבה
 * שרענון של הדף יפעיל חמישה שירותים חיצוניים מחדש.
 */

const MAX_AGE_MS = 30 * 60_000;

interface Body {
  title?: unknown;
  countryCode?: unknown;
  from?: unknown;
  to?: unknown;
  bbox?: unknown;
  points?: unknown;
  force?: unknown;
}

function parsePoints(raw: unknown): LivePoint[] {
  if (!Array.isArray(raw)) return [];
  const out: LivePoint[] = [];
  for (const item of raw.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    const date = String(p.date ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    out.push({
      n: Number(p.n) || 0,
      date,
      label: String(p.label ?? "").slice(0, 60),
      lat,
      lng,
      kind: String(p.kind ?? "").slice(0, 20),
      driveKm: Number(p.driveKm) || 0,
      mode: String(p.mode ?? "").slice(0, 20),
    });
  }
  return out;
}

function parseBbox(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const nums = ["latMin", "latMax", "lngMin", "lngMax"].map((k) => Number(b[k]));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return { latMin: nums[0], latMax: nums[1], lngMin: nums[2], lngMax: nums[3] };
}

export default async (req: Request) => {
  if (req.method !== "POST") return fail("שיטה לא נתמכת", 405);

  const tripId = tripIdOf(req);
  if (!tripId) return fail(NO_TRIP, 400);

  let body: Body | null;
  try {
    body = (await req.json()) as Body;
  } catch {
    return fail("גוף הבקשה אינו JSON תקין", 400);
  }
  if (!body) return fail("גוף הבקשה ריק", 400);

  const points = parsePoints(body.points);
  if (!points.length) return fail("אין ימים עם מיקום במסלול", 422);

  const from = String(body.from ?? points[0].date);
  const to = String(body.to ?? points[points.length - 1].date);
  const title = String(body.title ?? "").slice(0, 80);
  const bbox = parseBbox(body.bbox);

  const cacheKey = `live:${tripId}`;
  const brief = await readCache(`brief:${tripId}`);

  if (!body.force) {
    const hit = await readCache(cacheKey);
    if (hit && hit.ageMs < MAX_AGE_MS) {
      return json({
        ...(hit.doc as Record<string, unknown>),
        cached: true,
        fetchedAt: hit.fetchedAt,
        brief: brief?.doc ?? null,
        briefAgeMs: brief?.ageMs ?? null,
      });
    }
  }

  // קוד המדינה נשמר בנפרד: הוא לא משתנה, ואין טעם לפתור אותו שוב בכל רענון
  let countryCode = String(body.countryCode ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    const saved = await readCache(`country:${tripId}`);
    countryCode = String(saved?.doc ?? "");
    if (!/^[A-Z]{2}$/.test(countryCode) && title) {
      countryCode = await resolveCountry(title);
      if (countryCode) await writeCache(`country:${tripId}`, countryCode);
    }
  }

  const base = points[0];
  const [weather, air, holidays, quakes, rates] = await Promise.all([
    fetchWeather(points),
    fetchAir(base.lat, base.lng),
    fetchHolidays(countryCode, from, to),
    fetchQuakes(bbox),
    fetchRates(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const alerts = buildAlerts({
    points,
    weather: weather.days,
    holidays: holidays.holidays,
    quakes: quakes.quakes,
    air: air.air,
    today,
  });

  const sources: SourceStatus[] = [
    weather.status,
    air.status,
    holidays.status,
    quakes.status,
    rates.status,
  ];

  const payload = {
    days: weather.days,
    air: air.air,
    holidays: holidays.holidays,
    quakes: quakes.quakes,
    rates: rates.rates,
    alerts,
    sources,
    countryCode,
    today,
  };

  await writeCache(cacheKey, payload);

  return json({
    ...payload,
    cached: false,
    fetchedAt: new Date().toISOString(),
    brief: brief?.doc ?? null,
    briefAgeMs: brief?.ageMs ?? null,
  });
};

export const config: Config = {
  path: "/api/live",
};
