/* =========================================================================
   Service Worker — מה שמאפשר להתקין את האפליקציה במסך הבית, ולפתוח
   אותה גם בלי רשת.

   זו לא תוספת נוחות: המסלול, הכרטיסים והמסמכים נחוצים בדיוק במקומות
   שבהם אין קליטה — במטוס, בהר, או כשהחבילה הבינלאומית נגמרה.

   מדיניות ההגשה, לפי סוג הבקשה:

   • /api/*      — רשת בלבד. נתונים חיים אסור להגיש מהמטמון: שער חליפין
                   או התרעה מאתמול גרועים מהודעת שגיאה.
   • קוד האפליקציה — ה-HTML, ה-JS וה-CSS שלנו: רשת תחילה, ומטמון רק
                   כשאין רשת. בלי קליטה האפליקציה עדיין נפתחת.
   • שאר הנכסים  — מהמטמון מיד, ועדכון ברקע (stale-while-revalidate).

   ── למה קוד האפליקציה אינו stale-while-revalidate ──
   כי **הוא יחידה אחת**. ה-HTML היה מגיע מהרשת וה-JS מהמטמון, ושניהם
   מפריסות שונות. index.html חדש עם app.js ישן אינו "קצת מיושן" אלא
   שבור: שורה בקוד הישן פונה לאלמנט שה-HTML החדש כבר לא מכיל, זורקת
   חריגה, והמסך נשאר חצי ריק. זה בדיוק מה שקרה בפריסה של התרשים הציורי.
   ספריות צד שלישי ואייקונים נשארים במדיניות המהירה: הם לא משתנים יחד
   עם הקוד, והנתיב שלהם הוא הגרסה שלהם.

   המטמונים הישנים נמחקים בהפעלה.
   ========================================================================= */

const CACHE = "trip-v6";

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
  "./assets/js/guide.js",
  "./assets/js/live.js",
  "./assets/js/food.js",
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

  // קוד האפליקציה: אותה מדיניות של המסמך, כי הוא נטען יחד איתו
  if (/\/assets\/(js|css)\//.test(url.pathname)) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(req)) || Response.error();
        }
      })()
    );
    return;
  }

  // שאר הנכסים: מהמטמון מיד, ועדכון ברקע
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
