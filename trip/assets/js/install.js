/* =========================================================================
   התקנה במסך הבית.

   שתי מערכות, שתי התנהגויות:

   • אנדרואיד / כרום — הדפדפן יורה `beforeinstallprompt` כשהאתר עומד
     בתנאים (manifest, service worker, HTTPS). תופסים את האירוע, מונעים
     את הבאנר של הדפדפן, ומציעים כפתור במקום שבו הוא מובן.
   • iOS / ספארי — אין API כזה. ההתקנה נעשית ביד דרך תפריט השיתוף,
     ולכן מה שאפשר לעשות הוא להראות את שני הצעדים בדיוק.

   כשהאפליקציה כבר מותקנת ורצה כאפליקציה, אין מה להציע — והכרטיס מוחלף
   באישור קצר.
   ========================================================================= */

const InstallApp = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  let deferred = null;          // האירוע שנתפס, עד שלוחצים

  const standalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // אייפד חדש מתחזה למק; המגע הוא מה שמסגיר אותו
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function render() {
    const card = $("#installCard");
    if (!card) return;
    const text = $("#installText");
    const btn = $("#installBtn");

    if (standalone()) {
      text.innerHTML =
        "האפליקציה מותקנת ורצה מהמסך הבית. היא נפתחת גם בלי רשת — " +
        "המסלול, הכרטיסים והמסמכים נמצאים במכשיר.";
      btn.hidden = true;
      card.hidden = false;
      return;
    }

    if (deferred) {
      text.textContent =
        "התקנה מוסיפה אייקון למסך הבית, פותחת את האפליקציה במסך מלא בלי " +
        "סרגל הדפדפן, ומאפשרת לפתוח אותה גם בלי רשת.";
      btn.hidden = false;
      card.hidden = false;
      return;
    }

    if (isIOS()) {
      text.innerHTML =
        "בספארי: לוחצים על כפתור <b>השיתוף</b> (הריבוע עם החץ למעלה), " +
        "גוללים ובוחרים <b>הוספה למסך הבית</b>. אחר כך האפליקציה נפתחת " +
        "מהאייקון, במסך מלא, וגם בלי רשת.";
      btn.hidden = true;
      card.hidden = false;
      return;
    }

    // דפדפן שלא הציע התקנה: לרוב כי היא כבר נעשתה, או שהוא אינו תומך
    text.innerHTML =
      "בכרום בנייד: תפריט <b>⋮</b> ← <b>הוספה למסך הבית</b>. " +
      "במחשב: סמל ההתקנה בשורת הכתובת.";
    btn.hidden = true;
    card.hidden = false;
  }

  async function install() {
    if (!deferred) return;
    const btn = $("#installBtn");
    btn.disabled = true;
    try {
      deferred.prompt();
      await deferred.userChoice;
    } finally {
      // אירוע כזה ניתן לשימוש פעם אחת בלבד
      deferred = null;
      btn.disabled = false;
      render();
    }
  }

  function init() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferred = e;
      render();
    });
    window.addEventListener("appinstalled", () => {
      deferred = null;
      render();
    });
    $("#installBtn")?.addEventListener("click", install);
    render();
  }

  return { init };
})();
