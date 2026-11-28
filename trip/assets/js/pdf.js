/* =========================================================================
   PDF שמצויר אצלנו, ולא אצל הדפדפן.

   ── למה בכלל ──
   ‎<iframe src="blob:…"> עובד במחשב, ובטלפון הוא הימור: דפדפנים רבים
   אינם מציגים PDF בתוך הדף, ומה שמתקבל הוא עמוד ביניים של הדפדפן עם
   כפתור "הורד קובץ". בשער העלייה למטוס או בכניסה לאולם זה לא פחות
   מכישלון — הכרטיס קיים במכשיר, ובכל זאת אי אפשר להראות אותו.

   כאן אנחנו מציירים את העמודים בעצמנו, ל-canvas. מה שיוצא הוא תמונה
   רגילה בדף: נראית בכל דפדפן, נשארת על המסך, ועובדת אופליין — הקובץ
   יושב ב-IndexedDB ו-pdf.js מוגש מהאתר.

   ── הרזולוציה ──
   נגזרת מרוחב התצוגה ומצפיפות המסך. עמוד שמרונדר קטן ואז נמתח ב-CSS
   יוצא מטושטש, וברקוד מטושטש הוא ברקוד שלא נסרק.
   ========================================================================= */

const TripPdf = (() => {
  let lib = null;

  /** 1.4MB שאין סיבה לשלם עליהם עד שבאמת יש PDF על המסך */
  async function load() {
    if (lib) return lib;
    const mod = await import("../vendor/pdfjs/pdf.min.mjs");
    mod.GlobalWorkerOptions.workerSrc = "assets/vendor/pdfjs/pdf.worker.min.mjs";
    lib = mod;
    return mod;
  }

  /**
   * עמודי ה-PDF כקנבסים.
   *
   * @param blob   הקובץ עצמו
   * @param width  רוחב התצוגה בפיקסלים לוגיים — ממנו נגזר קנה המידה
   * @param max    תקרת עמודים. כל עמוד הוא ביטמאפ של מגהבייטים בודדים,
   *               ומסמך של חמישים עמודים אינו מה שמראים בכניסה.
   * @returns { canvases, total } — total הוא מספר העמודים האמיתי
   */
  async function pages(blob, { width = 420, max = 6 } = {}) {
    const pdfjs = await load();
    const data = await blob.arrayBuffer();
    const doc = await pdfjs.getDocument({ data }).promise;
    const total = doc.numPages;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const canvases = [];

    for (let n = 1; n <= Math.min(total, max); n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(1.5, Math.min(6, (width * dpr) / base.width));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      canvases.push(canvas);
    }

    doc.cleanup();
    return { canvases, total };
  }

  /** האם הקובץ הזה הוא PDF — לפי הסוג, ואם אין סוג אז לפי הסיומת */
  const is = (type, name) =>
    type === "application/pdf" || /\.pdf$/i.test(String(name || ""));

  return { pages, is };
})();
