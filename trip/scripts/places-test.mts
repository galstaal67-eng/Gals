/* =========================================================================
   בדיקת פותר המקומות — ללא רשת וללא מודל.

   הבאג שהיא שומרת עליו חזר שלוש פעמים: העוזר שינה יום, לוח הזמנים
   התעדכן, והמפה נשארה כפי שהייתה. הסיבה הייתה שקטה — שם בעברית אינו
   נמצא ב-OpenStreetMap, וכישלון החיפוש נראה בדיוק כמו "אין שינוי".

   הרצה:  node --experimental-strip-types scripts/places-test.mts
   ========================================================================= */

import { resolvePlaces } from "../netlify/lib/places.mts";

const doc = {
  meta: { title: "טביליסי", countries: ["גאורגיה"],
          bbox: { latMin: 41.0, latMax: 42.9, lngMin: 43.4, lngMax: 46.8 } },
  days: [],
};

let askedModel: string | null = null;
const nominatim: string[] = [];

globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const u = String(url);

  if (u.includes("anthropic.com")) {
    askedModel = String(init?.body ?? "");
    // תשובה בצורת Messages API עם פלט מובנה
    return new Response(JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
      stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
      content: [{ type: "text", text: JSON.stringify({ names: [
        { he: "שוק דזרטירי", q: "Dezerter Bazaar, Tbilisi" },
        { he: "שוק הפשפשים בגשר היבש", q: "Dry Bridge Market, Tbilisi" },
      ] }) }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  const q = decodeURIComponent(u.split("?q=")[1]?.split("&")[0] ?? "");
  nominatim.push(q);
  const hit = q.includes("Dezerter") ? { lat: "41.7121", lon: "44.7918" }
            : q.includes("Dry Bridge") ? { lat: "41.6977", lon: "44.7999" } : null;
  return new Response(JSON.stringify(hit ? [hit] : []), {
    status: 200, headers: { "content-type": "application/json" },
  });
}) as unknown as typeof fetch;

process.env.ANTHROPIC_API_KEY = "sk-ant-test";

const r = await resolvePlaces(
  ["שוק דזרטירי", "שוק הפשפשים בגשר היבש"], doc, { lookups: 12 }
);

const ok = (l: string, c: boolean) => console.log(`${c ? "PASS" : "FAIL"}  ${l}`);
console.log("points    :", r.points.map((p) => `${p.name}@${p.lat},${p.lng}`));
console.log("unresolved:", r.unresolved);
console.log("nominatim :", nominatim);

ok("נעשתה קריאת תרגום", Boolean(askedModel));
ok("השמות בעברית נשלחו לתרגום", String(askedModel).includes("\\u05d3\\u05d6\\u05e8") || String(askedModel).includes("דזר"));
ok("Nominatim קיבל את השם המתורגם", nominatim.some((q) => q.includes("Dezerter Bazaar")));
ok("שני המקומות נפתרו", r.points.length === 2 && r.unresolved.length === 0);
ok("השם המוצג נשאר בעברית", r.points[0]?.name === "שוק דזרטירי");
ok("הסדר נשמר", r.points[1]?.name === "שוק הפשפשים בגשר היבש");

/* ---------- והמקרה ההפוך: מה שכבר בטיול נפתר בלי אף קריאה ---------- */
nominatim.length = 0;
const known = await resolvePlaces(["כיכר החירות"], {
  ...doc,
  days: [{ n: 2, points: [{ name: "כיכר החירות", lat: 41.6934, lng: 44.8015, type: "sight" }] }],
}, { lookups: 12 });
ok("מקום שכבר בטיול אינו עולה קריאה", nominatim.length === 0 && known.points.length === 1);
