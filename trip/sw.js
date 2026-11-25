/* =========================================================================
   Service Worker — מה שמאפשר להתקין את האפליקציה במסך הבית, ולפתוח
   אותה גם בלי רשת.

   זו לא תוספת נוחות: המסלול, הכרטיסים והמסמכים נחוצים בדיוק במקומות
   שבהם אין קליטה — במטוס, בהר, או כשהחבילה הבינלאומית נגמרה.

   מדיניות ההגשה, לפי סוג הבקשה:

   • /api/*      — רשת בלבד. נתונים חיים אסור להגיש מהמטמון: שער חליפין
                   או התרעה מאתמול גרועים מהודעת שגיאה.
   • מסמך HTML   — רשת תחילה, ומטמון רק כשאין רשת. כך פריסה חדשה נתפסת
                   מיד, ובלי קליטה האפליקציה עדיין נפתחת.
   • נכסים       — מהמטמון מיד, ועדכון ברקע (stale-while-revalidate).
                   המסך עולה מהר, והגרסה החדשה נכנסת בטעינה הבאה.

   אין כאן מספר גרסה שצריך להעלות ביד: הנכסים מתעדכנים מעצמם, והמטמונים
   הישנים נמחקים בהפעלה.
   ========================================================================= */

const CACHE = "trip-v4";

/** מה שנשמר כבר בהתקנה, כדי שהפתיחה הראשונה בלי רשת תעבוד */
const SHELL = [
  "./",
  "./index.html",
  "./assets/css/styles.css",
  "./assets/js/api.js",
  "./assets/js/data.js",
  "./assets/js/trips.js",
  "./assets/js/ai.js",
  "./assets/js/docs.js",
  "./assets/js/flights.js",
  "./assets/js/pass.js",
  "./assets/js/mail.js",
  "./assets/js/money.js",
  "./assets/js/install.js",
  "./assets/js/watch.js",
  "./assets/js/route.js",
  "./assets/js/scene.js",
  "./assets/js/live.js",
  "./assets/js/app.js",
  "./assets/vendor/leaflet/leaflet.js",
  "./assets/vendor/leaflet/leaflet.css",
  "./assets/icons/icon-192.png",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll נכשל כולו אם קובץ אחד נכשל — כאן כל קובץ עומד בפני עצמו
      await Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => {}))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // מפות, גופנים, Google
  if (url.pathname.startsWith("/api/")) return;      // נתונים חיים — רשת בלבד

  // מסמך: רשת תחילה, מטמון כרשת ביטחון
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch {
          return (await caches.match("./index.html")) || Response.error();
        }
      })()
    );
    return;
  }

  // נכס: מהמטמון מיד, ועדכון ברקע
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const net = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      return hit || (await net) || Response.error();
    })()
  );
});
