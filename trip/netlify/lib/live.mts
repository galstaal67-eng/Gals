/**
 * מקורות המידע החיצוניים של הטיול.
 *
 * כל המקורות כאן ציבוריים ואינם דורשים מפתח, וכולם נקראים מהשרת ולא
 * מהדפדפן — כך שהמטמון משותף לכל המכשירים, ושום כתובת IP של טלפון
 * בחו"ל לא נחשפת לשירותים האלה.
 *
 * הקואורדינטות מעוגלות לשתי ספרות אחרי הנקודה (כקילומטר) לפני שהן
 * יוצאות החוצה. זה מדויק די והותר לתחזית, ואין סיבה לשלוח לשירות זר
 * את המיקום המדויק של המלון שבו ישנים.
 *
 * עיקרון שחוזר בכל הקובץ: מקור שנופל אינו מפיל את התשובה. כל מקור
 * מוחזר עם סטטוס משלו, והלקוח מציג מה שיש ואומר מה חסר — במקום להראות
 * מסך ריק שאי אפשר להבין ממנו אם אין אירועים או שהשירות לא ענה.
 */

export interface LivePoint {
  n: number;
  date: string;
  label: string;
  lat: number;
  lng: number;
  kind: string;
  driveKm: number;
  mode: string;
}

export interface LiveRequest {
  tripId: string;
  title: string;
  countryCode: string;
  from: string;
  to: string;
  points: LivePoint[];
}

export interface SourceStatus {
  id: string;
  label: string;
  ok: boolean;
  note: string;
}

export interface DayWeather {
  n: number;
  date: string;
  place: string;
  code: number;
  text: string;
  icon: string;
  tMax: number | null;
  tMin: number | null;
  /** הטמפרטורה **עכשיו**, רק ליום שהוא היום באותו מקום */
  tNow: number | null;
  rainMm: number | null;
  rainChance: number | null;
  windKmh: number | null;
  sunrise: string;
  sunset: string;
}

export interface Alert {
  level: "urgent" | "warn" | "info";
  title: string;
  detail: string;
  day: number | null;
  source: string;
}

/* ------------------------------------------------------------------ */
/*  עזרים                                                              */
/* ------------------------------------------------------------------ */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** קריאה עם תקציב זמן. שירות שלא עונה תוך 8 שניות לא יחזיק את כל הלוח */
async function getJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      // ללא User-Agent מזהה: אין סיבה לספר לשירות ציבורי של מי הבקשה
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** WMO weather code — הקוד שכל שירותי מזג האוויר מחזירים */
const WMO: Record<number, [string, string]> = {
  0: ["בהיר", "☀️"],
  1: ["בהיר ברובו", "🌤️"],
  2: ["מעונן חלקית", "⛅"],
  3: ["מעונן", "☁️"],
  45: ["ערפל", "🌫️"],
  48: ["ערפל מקפיא", "🌫️"],
  51: ["טפטוף קל", "🌦️"],
  53: ["טפטוף", "🌦️"],
  55: ["טפטוף חזק", "🌦️"],
  56: ["טפטוף קפוא", "🌧️"],
  57: ["טפטוף קפוא חזק", "🌧️"],
  61: ["גשם קל", "🌧️"],
  63: ["גשם", "🌧️"],
  65: ["גשם חזק", "🌧️"],
  66: ["גשם קפוא", "🌧️"],
  67: ["גשם קפוא חזק", "🌧️"],
  71: ["שלג קל", "🌨️"],
  73: ["שלג", "🌨️"],
  75: ["שלג כבד", "❄️"],
  77: ["גרגרי שלג", "🌨️"],
  80: ["ממטרים", "🌦️"],
  81: ["ממטרים חזקים", "🌧️"],
  82: ["ממטרים עזים", "⛈️"],
  85: ["ממטרי שלג", "🌨️"],
  86: ["ממטרי שלג כבדים", "❄️"],
  95: ["סופת רעמים", "⛈️"],
  96: ["סופת רעמים עם ברד", "⛈️"],
  99: ["סופת רעמים עם ברד כבד", "⛈️"],
};

const isSnow = (code: number) => [71, 73, 75, 77, 85, 86].includes(code);
const isHeavyRain = (code: number) => [65, 67, 82, 95, 96, 99].includes(code);

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/* ------------------------------------------------------------------ */
/*  מזג אוויר                                                          */
/* ------------------------------------------------------------------ */

const DAILY =
  "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum," +
  "precipitation_probability_max,wind_speed_10m_max,sunrise,sunset";

interface CurrentBlock {
  time?: unknown;
  temperature_2m?: unknown;
}

interface DailyBlock {
  time?: unknown;
  weather_code?: unknown;
  temperature_2m_max?: unknown;
  temperature_2m_min?: unknown;
  precipitation_sum?: unknown;
  precipitation_probability_max?: unknown;
  wind_speed_10m_max?: unknown;
  sunrise?: unknown;
  sunset?: unknown;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * תחזית לכל יום, לפי המקום שבאמת קובע באותו יום.
 *
 * ימים שונים נקראים בנפרד ולא בקריאה אחת מרובת־מיקומים: הצורה של
 * תשובה בודדת ידועה ויציבה, והרווח בביצועים בין ארבע קריאות מקבילות
 * לקריאה אחת אינו שווה את הסיכון.
 */
export async function fetchWeather(
  points: LivePoint[]
): Promise<{ days: DayWeather[]; status: SourceStatus }> {
  if (!points.length) {
    return {
      days: [],
      status: { id: "weather", label: "מזג אוויר", ok: false, note: "אין נקודות במסלול" },
    };
  }

  // מיקומים חוזרים (כל ימי העיר) נקראים פעם אחת
  const byPlace = new Map<string, LivePoint[]>();
  for (const p of points) {
    const key = `${round2(p.lat)},${round2(p.lng)}`;
    const list = byPlace.get(key);
    if (list) list.push(p);
    else byPlace.set(key, [p]);
  }

  const days: DayWeather[] = [];
  const failures: string[] = [];

  await Promise.all(
    [...byPlace.entries()].map(async ([key, group]) => {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${key.split(",")[0]}` +
        `&longitude=${key.split(",")[1]}&daily=${DAILY}&current=temperature_2m` +
        "&timezone=auto&forecast_days=16";
      try {
        const data = (await getJson(url)) as { daily?: DailyBlock; current?: CurrentBlock };
        const d = data.daily || {};
        // הטמפרטורה הנוכחית שייכת ליום אחד — זה שהתאריך שלו הוא התאריך
        // שהשירות החזיר ב-current, בשעון המקום עצמו
        const nowDate = String(data.current?.time ?? "").slice(0, 10);
        const nowTemp = num(data.current?.temperature_2m);
        const times = arr(d.time).map(String);
        for (const point of group) {
          const i = times.indexOf(point.date);
          if (i < 0) continue; // מעבר לטווח התחזית
          const code = Number(arr(d.weather_code)[i] ?? -1);
          const [text, icon] = WMO[code] || ["—", "❔"];
          days.push({
            n: point.n,
            date: point.date,
            place: point.label,
            code,
            text,
            icon,
            tMax: num(arr(d.temperature_2m_max)[i]),
            tMin: num(arr(d.temperature_2m_min)[i]),
            tNow: point.date === nowDate ? nowTemp : null,
            rainMm: num(arr(d.precipitation_sum)[i]),
            rainChance: num(arr(d.precipitation_probability_max)[i]),
            windKmh: num(arr(d.wind_speed_10m_max)[i]),
            sunrise: String(arr(d.sunrise)[i] ?? "").slice(11, 16),
            sunset: String(arr(d.sunset)[i] ?? "").slice(11, 16),
          });
        }
      } catch (err) {
        failures.push(`${group[0]?.label || key}: ${(err as Error).message}`);
      }
    })
  );

  days.sort((a, b) => a.n - b.n);
  return {
    days,
    status: {
      id: "weather",
      label: "מזג אוויר",
      ok: days.length > 0,
      note: failures.length
        ? `נכשל עבור ${failures.join("; ")}`
        : days.length
          ? `${days.length} ימים · Open-Meteo`
          : "אף יום אינו בטווח התחזית (16 יום קדימה)",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  איכות אוויר                                                        */
/* ------------------------------------------------------------------ */

export interface Air {
  aqi: number | null;
  pm25: number | null;
  text: string;
}

/**
 * us_aqi ולא european_aqi: המדד האירופי מכסה את אירופה בלבד, והאפליקציה
 * אמורה לעבוד גם בטיול הבא, באיזו יבשת שלא תהיה.
 */
export async function fetchAir(
  lat: number,
  lng: number
): Promise<{ air: Air | null; status: SourceStatus }> {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${round2(lat)}` +
    `&longitude=${round2(lng)}&current=us_aqi,pm2_5&timezone=auto`;
  try {
    const data = (await getJson(url)) as { current?: Record<string, unknown> };
    const aqi = num(data.current?.us_aqi);
    const pm25 = num(data.current?.pm2_5);
    const text =
      aqi === null ? "—"
      : aqi <= 50 ? "טובה"
      : aqi <= 100 ? "בינונית"
      : aqi <= 150 ? "לא טובה לרגישים"
      : aqi <= 200 ? "לא בריאה"
      : "מסוכנת";
    return {
      air: { aqi, pm25, text },
      status: { id: "air", label: "איכות אוויר", ok: aqi !== null, note: "Open-Meteo" },
    };
  } catch (err) {
    return {
      air: null,
      status: { id: "air", label: "איכות אוויר", ok: false, note: (err as Error).message },
    };
  }
}

/* ------------------------------------------------------------------ */
/*  חגים רשמיים                                                        */
/* ------------------------------------------------------------------ */

export interface Holiday {
  date: string;
  name: string;
  local: string;
}

/**
 * חג רשמי הוא מידע מעשי ולא טריוויה: מוזיאונים, בנקים ומשרדים סגורים,
 * והתחבורה עובדת אחרת. Nager.Date מכסה כ-110 מדינות — מדינה שאינה
 * ברשימה פשוט לא תחזיר כלום, וזה מצב תקין ולא שגיאה.
 */
export async function fetchHolidays(
  countryCode: string,
  from: string,
  to: string
): Promise<{ holidays: Holiday[]; status: SourceStatus }> {
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return {
      holidays: [],
      status: { id: "holidays", label: "חגים רשמיים", ok: false, note: "אין קוד מדינה לטיול" },
    };
  }
  const years = [...new Set([from.slice(0, 4), to.slice(0, 4)])];
  const out: Holiday[] = [];
  try {
    for (const year of years) {
      const data = (await getJson(
        `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`
      )) as Array<Record<string, unknown>>;
      for (const h of Array.isArray(data) ? data : []) {
        const date = String(h.date ?? "");
        if (date >= from && date <= to) {
          out.push({
            date,
            name: String(h.name ?? ""),
            local: String(h.localName ?? ""),
          });
        }
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return {
      holidays: out,
      status: {
        id: "holidays",
        label: "חגים רשמיים",
        ok: true,
        note: out.length ? `${out.length} בתאריכי הטיול` : "אין חגים בתאריכי הטיול",
      },
    };
  } catch (err) {
    return {
      holidays: [],
      status: {
        id: "holidays",
        label: "חגים רשמיים",
        ok: false,
        // מדינה שאינה נתמכת מחזירה 404 — לא תקלה, פשוט אין נתונים
        note: `${countryCode}: ${(err as Error).message}`,
      },
    };
  }
}

/* ------------------------------------------------------------------ */
/*  רעידות אדמה                                                        */
/* ------------------------------------------------------------------ */

export interface Quake {
  mag: number;
  place: string;
  when: string;
  url: string;
}

/** הקווקז פעיל סייסמית. שבוע אחורה, מגניטודה 3.5 ומעלה — מה שמרגישים */
export async function fetchQuakes(
  bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number } | null
): Promise<{ quakes: Quake[]; status: SourceStatus }> {
  if (!bbox) {
    return {
      quakes: [],
      status: { id: "quakes", label: "רעידות אדמה", ok: false, note: "אין תיחום לטיול" },
    };
  }
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const url =
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
    `&starttime=${since}&minmagnitude=3.5` +
    `&minlatitude=${bbox.latMin}&maxlatitude=${bbox.latMax}` +
    `&minlongitude=${bbox.lngMin}&maxlongitude=${bbox.lngMax}`;
  try {
    const data = (await getJson(url)) as { features?: unknown };
    const quakes = arr(data.features)
      .map((f) => (f as { properties?: Record<string, unknown> }).properties || {})
      .map((p) => ({
        mag: Number(p.mag ?? 0),
        place: String(p.place ?? ""),
        when: new Date(Number(p.time ?? 0)).toISOString(),
        url: String(p.url ?? ""),
      }))
      .filter((q) => q.mag > 0)
      .sort((a, b) => b.when.localeCompare(a.when));
    return {
      quakes,
      status: {
        id: "quakes",
        label: "רעידות אדמה",
        ok: true,
        note: quakes.length ? `${quakes.length} בשבוע האחרון` : "שקט בשבוע האחרון",
      },
    };
  } catch (err) {
    return {
      quakes: [],
      status: { id: "quakes", label: "רעידות אדמה", ok: false, note: (err as Error).message },
    };
  }
}

/* ------------------------------------------------------------------ */
/*  שערי מטבע                                                          */
/* ------------------------------------------------------------------ */

/**
 * השערים באפליקציה הם "כמה שקלים שווה יחידה אחת", ולכן הבסיס כאן הוא
 * שקל והערך הוא ההופכי של מה שהשירות מחזיר.
 */
export async function fetchRates(): Promise<{
  rates: Record<string, number>;
  status: SourceStatus;
}> {
  try {
    const data = (await getJson("https://open.er-api.com/v6/latest/ILS")) as {
      result?: unknown;
      rates?: Record<string, unknown>;
    };
    if (String(data.result ?? "") !== "success" || !data.rates) {
      throw new Error("תשובה לא צפויה");
    }
    const want: Record<string, string> = { GEL: "₾", USD: "$", EUR: "€", GBP: "£" };
    const rates: Record<string, number> = {};
    for (const [code, sign] of Object.entries(want)) {
      const perIls = num(data.rates[code]);
      if (perIls && perIls > 0) rates[sign] = Math.round((1 / perIls) * 1000) / 1000;
    }
    return {
      rates,
      status: {
        id: "rates",
        label: "שערי מטבע",
        ok: Object.keys(rates).length > 0,
        note: `${Object.keys(rates).length} מטבעות · open.er-api.com`,
      },
    };
  } catch (err) {
    return {
      rates: {},
      status: { id: "rates", label: "שערי מטבע", ok: false, note: (err as Error).message },
    };
  }
}

/* ------------------------------------------------------------------ */
/*  קוד מדינה                                                          */
/* ------------------------------------------------------------------ */

/** שם היעד שהוקלד באשף → קוד מדינה, לצורך לוח החגים */
export async function resolveCountry(title: string): Promise<string> {
  const name = title.trim();
  if (!name) return "";
  try {
    const data = (await getJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=he`
    )) as { results?: Array<Record<string, unknown>> };
    const code = String(data.results?.[0]?.country_code ?? "").toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : "";
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/*  התרעות                                                             */
/* ------------------------------------------------------------------ */

/**
 * ההתרעות נגזרות מהנתונים במקום אחד — בשרת — כדי ששני הטלפונים יראו
 * בדיוק את אותו דבר, ושהכלל יהיה כתוב פעם אחת.
 *
 * הסף נקבע לפי מה שבאמת משנה תוכנית: שלג על מעבר הררי ביום נסיעה הוא
 * אירוע, גשם קל ביום עירוני הוא לא.
 */
export function buildAlerts(input: {
  points: LivePoint[];
  weather: DayWeather[];
  holidays: Holiday[];
  quakes: Quake[];
  air: Air | null;
  today: string;
}): Alert[] {
  const alerts: Alert[] = [];
  const byDay = new Map(input.points.map((p) => [p.n, p]));

  for (const w of input.weather) {
    if (w.date < input.today) continue;
    const point = byDay.get(w.n);
    const driving = (point?.driveKm ?? 0) >= 80;
    const pass = point?.kind === "pass";
    const when = w.date === input.today ? "היום" : `ביום ${w.n} (${w.date.slice(8)}/${w.date.slice(5, 7)})`;

    if (isSnow(w.code) && (pass || driving)) {
      alerts.push({
        level: "urgent",
        title: `שלג ב${w.place} ${when}`,
        detail:
          `${w.text}, ${w.tMin ?? "?"}°–${w.tMax ?? "?"}°. ` +
          (pass
            ? "מעבר הררי בשלג נסגר לעיתים בלי התראה — בדקו מול הנהג או המלון בבוקר היציאה."
            : "יום נסיעה ארוך בשלג. שקלו להחליף בין הימים."),
        day: w.n,
        source: "מזג אוויר",
      });
    } else if (isHeavyRain(w.code) && driving) {
      alerts.push({
        level: "warn",
        title: `גשם חזק ב${w.place} ${when}`,
        detail: `${w.text}, ${w.rainMm ?? 0} מ"מ. יום נסיעה — צאו מוקדם יותר.`,
        day: w.n,
        source: "מזג אוויר",
      });
    } else if ((w.tMin ?? 99) <= 0 && driving) {
      alerts.push({
        level: "warn",
        title: `מתחת לאפס ב${w.place} ${when}`,
        detail: `מינימום ${w.tMin}°. קרח על הכביש בשעות הבוקר.`,
        day: w.n,
        source: "מזג אוויר",
      });
    }

    if ((w.windKmh ?? 0) >= 60) {
      alerts.push({
        level: "warn",
        title: `רוחות חזקות ב${w.place} ${when}`,
        detail: `עד ${Math.round(w.windKmh ?? 0)} קמ"ש. רכבלים נסגרים ברוח כזו.`,
        day: w.n,
        source: "מזג אוויר",
      });
    }
  }

  for (const h of input.holidays) {
    if (h.date < input.today) continue;
    const day = input.points.find((p) => p.date === h.date);
    alerts.push({
      level: "info",
      title: `${h.local || h.name} — חג רשמי ב-${h.date.slice(8)}/${h.date.slice(5, 7)}`,
      detail: "מוזיאונים, בנקים ומשרדים עשויים להיות סגורים, והתחבורה עובדת בתדירות של סוף שבוע.",
      day: day ? day.n : null,
      source: "לוח חגים",
    });
  }

  const recent = input.quakes.filter(
    (q) => q.mag >= 4.5 && Date.now() - Date.parse(q.when) < 2 * 86_400_000
  );
  for (const q of recent) {
    alerts.push({
      level: "warn",
      title: `רעידת אדמה ${q.mag} באזור`,
      detail: `${q.place}. דווח לפני פחות מיומיים.`,
      day: null,
      source: "USGS",
    });
  }

  if ((input.air?.aqi ?? 0) > 150) {
    alerts.push({
      level: "warn",
      title: `איכות אוויר ${input.air?.text}`,
      detail: `מדד ${input.air?.aqi}. יום טוב למוזיאונים ופחות לטיול רגלי ארוך.`,
      day: null,
      source: "איכות אוויר",
    });
  }

  const rank = { urgent: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.level] - rank[b.level] || (a.day ?? 99) - (b.day ?? 99));
}
