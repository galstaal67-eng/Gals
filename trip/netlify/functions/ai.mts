import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { fail, resolveApiKey, streamJson, StreamError } from "../lib/shared.mts";
import { resolvePlaces } from "../lib/places.mts";
import { readFlight, type DocBlock, type FlightInfo } from "../lib/flight-read.mts";

/**
 * POST /api/ai — בקשה חופשית בעברית, מוקלדת, מוכתבת או מסמך מצורף.
 *
 * שלושה סוגי קלט:
 *   • שינוי במסלול  — "תשנה את יום 3 להישאר בעיר וללא נסיעה"
 *   • רישום הוצאה   — "שילמתי 45 לארי על קפה"
 *   • מסמך          — כרטיס טיסה, כרטיס להופעה, אישור לינה, או סתם מידע
 *
 * בשינוי מסלול הפונקציה מחזירה **ערכת שינויים** ולא מסמך חדש.
 *
 * למה ערכת שינויים: מסמך מלא שחוזר מהמודל יכול לאבד שדות בשקט — נקודות מפה,
 * מחירים, מזהים. ערכה תחומה מגבילה את מה שניתן לשנות לשדות טקסטואליים
 * שהמשתמש ממילא עורך ביד, ומשאירה את כל השאר כפי שהוא. השינוי גם מוצג
 * לאישור בלקוח לפני שהוא נשמר.
 *
 * כשחסר מידע כדי לבצע את הבקשה, המודל **שואל** (kind = "question") במקום
 * לנחש. שעת הופעה שנוחשה נראית בדיוק כמו שעת הופעה שנקראה מהכרטיס, ואין
 * דרך לגלות את הטעות עד שמגיעים לאולם בזמן הלא נכון.
 *
 * ── שתי סכמות ולא אחת ──
 *
 * structured outputs מהדר את הסכמה לדקדוק, ולדקדוק יש תקרת גודל. סכמה
 * אחת שהכילה ימים, הוצאות, שאלות, סיווג מסמכים ופרטי טיסה חצתה אותה,
 * והשירות דחה **כל** בקשה ב-400 — גם בקשת טקסט שלא נגעה במסמכים.
 *
 * לכן: מסלול טקסט ומסלול מסמך, כל אחד עם סכמה תחומה משלו, ופרטי הטיסה
 * בקריאה שלישית קטנה (lib/flight-read.mts) שרצה רק כשצורף כרטיס טיסה.
 * הפיצול גם מוזיל: כל בקשה משלמת רק על מה שהיא באמת צריכה.
 *
 * המסמכים עצמם אינם נשמרים בשרת. הם חיים במכשיר (IndexedDB) ונשלחים לכאן
 * לקריאה החד-פעמית הזו בלבד. ראה assets/js/docs.js.
 *
 * המפתח יושב כאן ולא בדפדפן: ANTHROPIC_API_KEY בצד השרת בלבד.
 */

/* ------------------------------------------------------------------ */
/*  חלקים משותפים לשתי הסכמות                                          */
/* ------------------------------------------------------------------ */

/** שאלה אחת שהמודל מבקש שיענו עליה לפני שהוא קובע משהו */
const Question = z.object({
  text: z.string().describe("השאלה בעברית, משפט אחד, קונקרטית"),
  options: z.array(z.string()).nullable()
    .describe("אפשרויות לבחירה כשהן ידועות וסופרות. null = תשובה חופשית"),
});

const PlanRow = z.object({ time: z.string(), text: z.string() });

/* ------------------------------------------------------------------ */
/*  מסלול הטקסט                                                        */
/* ------------------------------------------------------------------ */

/**
 * כל שדה חובה אך מקבל null. זו הדרישה של structured outputs (strict),
 * ו-null הוא הסימון ל"אל תיגע בשדה הזה" — להבדיל מ-"" שמנקה אותו.
 */
const DayChange = z.object({
  n: z.number().int().describe("מספר היום שמשתנה, כפי שהוא במסמך"),
  title: z.string().nullable().describe("כותרת היום, או null אם לא משתנה"),
  summary: z.string().nullable().describe("תיאור קצר של היום, או null"),
  mode: z.enum(["flight", "drive", "train", "hike", "city"]).nullable()
    .describe("אופן ההתקדמות ביום. city = עירוני בלי נסיעה בין-עירונית"),
  driveKm: z.number().nullable().describe("ק\"מ נסיעה ביום. 0 ליום בלי נסיעה"),
  driveHours: z.number().nullable().describe("שעות נסיעה ביום. 0 ליום בלי נסיעה"),
  driveNote: z.string().nullable().describe("הערת הנסיעה. \"\" מוחק אותה"),
  hotelName: z.string().nullable().describe("שם הלינה. \"\" מסמן שאין לינה ביום הזה"),
  hotelArea: z.string().nullable().describe("אזור הלינה"),
  plan: z.array(PlanRow).nullable()
    .describe("לוח הזמנים המלא של היום, מחליף את הקיים. null = לא משתנה"),
  tips: z.array(z.string()).nullable()
    .describe("הטיפים של היום, מחליפים את הקיימים. null = לא משתנים"),
  places: z.array(z.string()).nullable()
    .describe(
      "הנקודות שיופיעו על המפה ביום הזה, לפי סדר הביקור, בשמות בלבד " +
      "ולעולם לא בקואורדינטות. העדף שמות שכבר מופיעים ב-mapPoints של " +
      "הטיול. **חובה בכל פעם ש-plan אינו null**, גם אם רוב המקומות לא " +
      "השתנו — אחרת מבט העל של היום יציג מסלול אחר מלוח הזמנים. " +
      "null מותר רק כש-plan הוא null. [] = היום נשאר בלי נקודות על המפה."
    ),
});

const Expense = z.object({
  date: z.string().describe("תאריך ההוצאה, YYYY-MM-DD"),
  amount: z.number().positive().describe("הסכום, מספר חיובי"),
  currency: z.string().describe("סימן המטבע, אחד מאלה שברשימה שנשלחה"),
  category: z.string().describe("שם הסעיף, בדיוק כפי שהוא ברשימה שנשלחה"),
  payer: z.string().describe("מי שילם, בדיוק כפי שהשם מופיע ברשימת המטיילים"),
  note: z.string().describe("תיאור קצר של ההוצאה. מחרוזת ריקה אם אין"),
});

/**
 * זו בדיוק הסכמה שרצה בייצור לפני שהמסמכים נוספו, לתו האחרון.
 *
 * אין בה שאלות הבהרה בכוונה. השאלות נולדו בשביל מסמכים — "לאיזה יום
 * שייך הכרטיס" — ושם הן נשארות. בקשת טקסט שאינה ברורה מקבלת
 * kind = "unclear" עם הסבר מה חסר, כפי שתמיד היה.
 *
 * הריסון הזה אינו אסתטי: אחרי שהדקדוק חרג וכל העוזר נפל, מסלול הטקסט
 * חוזר למידה שהוכיחה את עצמה באוויר במשך שבועות, בלי שוליים לנחש בהם.
 */
const TextResult = z.object({
  kind: z.enum(["trip_edit", "expense", "unclear"])
    .describe(
      "trip_edit = שינוי במסלול, או מידע שהודבק ונכנס אליו · " +
      "expense = רישום הוצאה בלבד · unclear = לא הובן"
    ),
  summary: z.string().describe("משפט או שניים בעברית: מה נעשה בפועל"),
  warning: z.string().nullable()
    .describe("השלכה שהמשתמש צריך לדעת עליה. null אם אין"),
  dayChanges: z.array(DayChange).describe("רק ימים שבאמת משתנים. ריק אם זו אינה בקשת שינוי מסלול"),
  metaSubtitle: z.string().nullable()
    .describe("כותרת המשנה של הטיול, אם השינוי מצדיק עדכון. אחרת null"),
  expenses: z.array(Expense)
    .describe(
      "ההוצאות לרישום. ריק אם אין. יכול להיות מלא גם יחד עם dayChanges — " +
      "מידע מודבק על משהו שהוזמן ושולם הוא גם שינוי במסלול וגם הוצאה"
    ),
});

/* ------------------------------------------------------------------ */
/*  מסלול המסמך                                                        */
/* ------------------------------------------------------------------ */

/**
 * מסמך משנה ביום דברים אחרים מבקשה חופשית: הוא מוסיף שורה ללוח הזמנים,
 * מקום על המפה, הערה, או לינה. הוא כמעט לעולם לא משנה ק"מ נסיעה או את
 * אופן ההתקדמות — ולכן השדות האלה אינם כאן. סכמה קטנה יותר היא גם
 * דקדוק קטן יותר, וזו הסיבה שהעוזר כולו נפל.
 */
const DocDayChange = z.object({
  n: z.number().int().describe("מספר היום שהמסמך נוגע לו, כפי שהוא במסלול"),
  plan: z.array(PlanRow).nullable()
    .describe("לוח הזמנים המלא של היום אחרי השילוב, מחליף את הקיים. null = לא משתנה"),
  tips: z.array(z.string()).nullable()
    .describe("הטיפים של היום אחרי השילוב, מחליפים את הקיימים. null = לא משתנים"),
  places: z.array(z.string()).nullable()
    .describe(
      "נקודות המפה של היום, בשמות בלבד ולפי סדר הביקור. חובה בכל פעם " +
      "ש-plan אינו null, גם אם רוב המקומות לא השתנו. null מותר רק כש-plan null"
    ),
  hotelName: z.string().nullable().describe("שם הלינה, מאישור לינה. null = לא משתנה"),
  hotelArea: z.string().nullable().describe("אזור הלינה. null = לא משתנה"),
});

/** הסיווג של מסמך שצורף, כדי שהוא יישמר עם כותרת ויקושר ליום הנכון */
const DocMeta = z.object({
  index: z.number().int().describe("מספר המסמך כפי שנשלח אליך, מתחיל ב-1"),
  title: z.string().describe('כותרת קצרה בעברית, למשל "כרטיס להופעה — Nikala". לא שם הקובץ'),
  kind: z.enum(["flight", "event", "lodging", "transport", "info", "other"])
    .describe(
      "flight = כרטיס טיסה או עלייה למטוס · event = כרטיס להופעה, מופע או אתר · " +
      "lodging = אישור לינה · transport = רכבת, אוטובוס, הסעה או רכב · " +
      "info = מידע כללי · other = אחר"
    ),
  dayN: z.number().int().nullable()
    .describe("היום במסלול שהמסמך שייך לו, לפי התאריך שבו. null אם אינו שייך ליום מסוים"),
  leg: z.enum(["out", "back"]).nullable()
    .describe("רק ל-kind = flight: לאיזו רגל הכרטיס שייך. null לכל סוג אחר"),
  note: z.string().describe('מה שחשוב לדעת — מספר הזמנה, שעת כניסה, מחיר. "" אם אין'),
});

const DocResult = z.object({
  kind: z.enum(["trip_edit", "question", "unclear"])
    .describe("trip_edit = המסמך נקרא ונכנס · question = חסר מידע ואני שואל · unclear = לא נקרא"),
  summary: z.string().describe("משפט או שניים בעברית: מה קראתי ומה נכנס"),
  warning: z.string().nullable()
    .describe("מה שצריך לדעת — תאריך מחוץ לטווח, התנגשות בלוח הזמנים. null אם אין"),
  questions: z.array(Question)
    .describe("השאלות שלי. ריק בכל סוג שאינו question. עד שלוש שאלות"),
  docs: z.array(DocMeta).describe("שורה לכל מסמך שצורף, לפי המספר שנשלח אליו"),
  dayChanges: z.array(DocDayChange).describe("רק ימים שהמסמך באמת משנה. ריק אם אין"),
});

/* ------------------------------------------------------------------ */
/*  הפרומפטים                                                          */
/* ------------------------------------------------------------------ */

/** הכללים שמשותפים לשני המסלולים — נכתבים פעם אחת ומוזרקים לשניהם */
const RULES = `כללים:
- כתוב הכול בעברית, באותו טון של המסמך: ענייני, ללא שיווק וללא סימני קריאה.
- שנה רק מה שהבקשה מחייבת. כל שדה שלא צריך להשתנות — החזר בו null.
- ערוך רק ימים שבאמת משתנים. אל תחזיר יום שלא נגעת בו.
- לוח זמנים: שעות אמיתיות ורצף הגיוני. התחשב בזמני פתיחה, בזמני נסיעה
  ובשעות האור של העונה והיעד.
- **plan ו-places הולכים תמיד יחד.** בכל פעם שאתה מחזיר plan, החזר גם
  places: את הרשימה **המלאה** של המקומות שהיום עובר בהם, לפי סדר הביקור,
  גם כשרובם לא השתנו. לוח הזמנים של היום נבנה מ-plan, ומבט העל ומסלול
  היום נבנים מ-places — אם רק אחד מהם מתעדכן, המשתמש רואה יום אחד בתכנון
  ויום אחר במבט העל. אין מצב חוקי שבו plan אינו null ו-places הוא null.
- ב-places החזר שמות בלבד. הקואורדינטות נפתרות בשרת, ולכן שם מדויק של מקום
  אמיתי הוא קריטי. העדף שמות שכבר מופיעים ב-mapPoints של הטיול — הם נפתרים
  מתוך המסמך עצמו. שם שלא יימצא יושמט מהמפה ותוצג על כך הודעה.
- אל תמציא מחירים, מספרי הזמנה, שמות מלונות או שעות טיסה.`;

const ASKING = `--- אם חסר מידע (kind = "question") ---

שאל כשהתשובה משנה את מה שייכנס לטיול, ואין לך דרך לדעת אותה:
- שעה או תאריך שבלעדיהם אין איפה להכניס את מה שהתבקש.
- מידע שמתאים לשני ימים במסלול, ואין מה שמכריע ביניהם.
- בקשה שאפשר לבצע בשתי דרכים שונות מאוד.

כללי השאלות:
- עד שלוש שאלות, ורק על מה שבאמת חוסם. שאלה שאתה יכול לענות עליה בעצמך
  מהמסלול או מהמסמך אינה שאלה.
- כל שאלה קונקרטית ועומדת בעצמה, בעברית, בלי מונחים טכניים.
- כשהתשובות האפשריות ידועות וסופרות (יום 2 או יום 5, גל או נועה) — החזר
  אותן ב-options. אחרת options = null.
- בסבב של שאלות החזר את כל שאר המערכים ריקים. ב-summary כתוב בשורה אחת
  מה כבר הבנת, כדי שהמשתמש יראה שלא התחלת מאפס.
- **אל תשאל שאלה שהמשתמש אינו יכול לדעת את תשובתה.** אם המידע אינו קיים
  בשום מקום, בצע את מה שאפשר וציין את החסר ב-warning.`;

const SYSTEM_TEXT = `אתה העוזר של אפליקציית תכנון טיולים בעברית.

המשתמש כותב או מכתיב בקשה חופשית. החלט לאיזה סוג היא שייכת:

• **expense** — רישום הוצאה. סימנים: סכום ומטבע, פועל של תשלום ("שילמתי",
  "קניתי", "עלה לי"), שם של דבר שקונים. גם כמה הוצאות במשפט אחד.
• **trip_edit** — שינוי במסלול: יום, לוח זמנים, לינה, נסיעה. גם מידע
  שהודבק ושייך למסלול.
• **unclear** — לא ברור לאיזה סוג זה שייך, או חסר מידע מהותי.

--- מידע מודבק ---

לא כל בקשה היא פקודה. לעיתים המשתמש מדביק את מה שקיבל: אישור הזמנה,
פרטי מופע, רשימת המלצות, תשובה ממקור אחר. **הדבקה כזו היא בקשה להכניס
את המידע לטיול**, גם כשאין בה מילת פעולה. אל תחזיר unclear רק משום
שלא נכתב "תוסיף".

- מידע על משהו שהוזמן, עם תאריך ושעה — הכנס אותו ללוח הזמנים של היום
  המתאים לפי התאריך, ואת שם המקום הוסף ל-places של אותו יום.
- רשימת המלצות בלי תאריך — הוסף אותה כטיפים ליום שבו היא שימושית. אל
  תמציא לה שעה ביומן. רשימה שמתאימה לכמה ימים — פזר אותה לפי ההקשר
  (מסעדות ערב ליום שנגמר בעיר, וכו').
- טקסט מודבק מכיל לא פעם רעש: שורות שחוזרות על עצמן, שמות של מקורות,
  הסברי רקע ("מי היא X"). קח ממנו את העובדות — מה, מתי, איפה, כמה —
  והשאר את הרקע בחוץ.
- **אם יש במידע גם אירוע וגם מחיר ששולם — עשה את שניהם באותה תשובה**:
  dayChanges למסלול ו-expenses לרישום. kind יישאר trip_edit.

--- אם זו הוצאה (kind = "expense") ---

- expenses מכיל שורה לכל הוצאה. dayChanges ריק.
- amount הוא מספר בלבד. אל תכלול בו את המטבע.
- currency: אם המשתמש אמר מטבע — השתמש בו. אם לא — ברירת המחדל היא המטבע
  המקומי של הטיול שנשלח לך.
- category: בחר מתוך רשימת הסעיפים שנשלחה, בדיוק כפי שהשם כתוב שם. אם שום
  סעיף לא מתאים — "אחר".
- payer: בחר מתוך רשימת המטיילים שנשלחה. אם המשתמש לא אמר מי שילם — בחר את
  הראשון ברשימה, וציין זאת ב-warning.
- date: אם לא נאמר תאריך — השתמש בתאריך של היום שנשלח לך. "אתמול" ו"שלשום"
  הם יחסית אליו. אם התאריך נופל מחוץ לטווח הטיול, ציין זאת ב-warning.
- note: תיאור קצר במילים של המשתמש ("קפה", "מונית לשדה"). לא לנפח.
- הכתבה קולית משבשת מספרים ומטבעות. אם הסכום או המטבע נראים לא סבירים,
  רשום את מה שהבנת וציין את הספק ב-warning.

--- אם זה שינוי מסלול (kind = "trip_edit") ---

- dayChanges מכיל רק את הימים שמשתנים. expenses ריק.

${RULES}
- כשיום הופך ליום עירוני ללא נסיעה: mode = "city", driveKm = 0, driveHours = 0,
  ו-driveNote ריק. אל תשכח להתאים גם את הכותרת, התיאור ולוח הזמנים.
- **המפה חייבת להתאים ליום.** places הוא תמיד רשימת המקומות המלאה של
  היום אחרי השינוי, לפי סדר הביקור — גם ביום נסיעה שהפך ליום עירוני, וגם
  כששונתה רק שעה אחת. null מותר רק ביום שלא נגעת בלוח הזמנים שלו.
- אם לשינוי יש השלכה שהמשתמש עלול לפספס — לינה שהוזמנה ביעד שהוסר, יום
  שנשאר בלי מלון, נסיעה שהתארכה מאוד — כתוב אותה ב-warning.

--- אם זה לא ברור (kind = "unclear") ---

החזר dayChanges ו-expenses ריקים, והסבר ב-summary **מה בדיוק חסר** כדי
שאפשר יהיה לנסח מחדש: לא "לא הבנתי" אלא "לא ברור לאיזה יום להוסיף".`;

const SYSTEM_DOC = `אתה העוזר של אפליקציית תכנון טיולים בעברית, וצורפו אליך מסמכים.

מסמך הוא עובדה, לא הצעה. מה שמודפס בו גובר על כל הנחה שלך.

1. **סווג כל מסמך** ב-docs, שורה לכל מסמך שצורף, לפי המספר שנשלח אליו.
   title היא כותרת קצרה בעברית שתוצג למשתמש, לא שם הקובץ. אם במסמך יש
   תאריך — קשר אותו ליום המתאים במסלול ב-dayN.
2. **כרטיס טיסה או כרטיס עלייה למטוס** — kind = "flight", וקבע את leg לפי
   כיוון הטיסה מול היעד של הטיול: מהארץ אל היעד היא "out", וממנו חזרה היא
   "back". **אל תמלא כאן את פרטי הטיסה**; הם נקראים בקריאה נפרדת.
3. **כרטיס להופעה, למופע או לאתר** — הכנס אותו ללוח הזמנים של היום שבתאריך
   שבכרטיס, בשעה שמודפסת בו, עם שם האולם או האתר. החזר את לוח הזמנים
   **המלא** של אותו יום אחרי השילוב, כולל מה שכבר היה בו. אם האולם אינו על
   המפה של אותו יום, הוסף אותו ב-places יחד עם שאר נקודות היום. אם בכרטיס
   יש שעת כניסה או הוראה מחייבת ("להגיע 45 דקות לפני"), הוסף אותה כטיפ.
4. **אישור לינה** — עדכן hotelName ו-hotelArea בימים שהאישור מכסה.
5. **מידע כללי** בלי תאריך — סווג אותו כ-info, ואם יש בו משהו מעשי ליום
   מסוים הוסף אותו כטיפ. אל תמציא לו מקום ביומן.
6. החזר **אך ורק מה שכתוב במסמך**. אל תשלים שדות מהידע שלך.
7. אם התאריך שבמסמך אינו נופל באף יום של הטיול, אל תנחש יום. אמור זאת
   ב-warning, והחזר dayN = null.
8. אם המסמך אינו קריא — סרוק גרוע, חתוך, או לא מה שחשבת — אמור את זה
   ב-summary ואל תמלא שדות על בסיס ניחוש.
9. מחיר שמופיע במסמך: כתוב אותו ב-note של המסמך. **אל תרשום ממנו הוצאה** —
   רישום הוצאות נעשה בבקשה מפורשת.

${RULES}

${ASKING}

--- אם המסמך לא נקרא (kind = "unclear") ---

החזר dayChanges ריק, סווג את המסמך ב-docs לפי מה שכן הבנת, והסבר ב-summary.`;

/* ------------------------------------------------------------------ */
/*  הקשר הטיול                                                         */
/* ------------------------------------------------------------------ */

/** גרסה מצומצמת של המסמך: בלי נתיבים ונקודות מפה, שאינם ניתנים לעריכה כאן */
function compactTrip(doc: Record<string, unknown>): unknown {
  const meta = doc.meta as Record<string, unknown> | undefined;
  const days = Array.isArray(doc.days) ? doc.days : [];
  const flights = doc.flights as Record<string, unknown> | undefined;
  const legOf = (v: unknown) => {
    const l = v as Record<string, unknown> | undefined;
    if (!l) return null;
    return { flightNo: l.flightNo ?? "", date: l.date ?? "", dep: l.dep ?? "", from: l.from ?? "", to: l.to ?? "" };
  };
  return {
    title: meta?.title ?? "",
    subtitle: meta?.subtitle ?? "",
    countries: meta?.countries ?? [],
    // הטיסות הקיימות: בלעדיהן המודל אינו יכול לדעת אם כרטיס שצורף הוא
    // הלוך או חזור, ולא אם הוא מחליף רגל קיימת או מוסיף אחת חדשה
    flights: flights ? { out: legOf(flights.out), back: legOf(flights.back) } : null,
    passengers: passengersOf(doc),
    days: days.map((d: Record<string, unknown>) => {
      const hotel = d.hotel as Record<string, unknown> | undefined;
      const drive = d.drive as Record<string, unknown> | undefined;
      const points = Array.isArray(d.points) ? d.points : [];
      return {
        n: d.n,
        date: d.date,
        dow: d.dow,
        title: d.title,
        region: d.region,
        mode: d.mode,
        summary: d.summary,
        drive: { km: drive?.km ?? 0, hours: drive?.hours ?? 0, note: drive?.note ?? "" },
        hotel: hotel ? { name: hotel.name, area: hotel.area } : null,
        plan: d.plan ?? [],
        tips: d.tips ?? [],
        // שמות בלבד — נותן למודל הקשר גאוגרפי בלי להציף אותו בקואורדינטות
        mapPoints: points.map((p: Record<string, unknown>) => p.name),
      };
    }),
  };
}

function passengersOf(doc: Record<string, unknown>): string[] {
  const flights = doc.flights as Record<string, unknown> | undefined;
  const list = flights?.passengers;
  if (!Array.isArray(list)) return [];
  return list.map((p) => String((p as Record<string, unknown>).name ?? "")).filter(Boolean);
}

/** הרשימות שמהן המודל חייב לבחור כשהוא רושם הוצאה */
function expenseContext(ctx: Record<string, unknown> | undefined) {
  const arr = (v: unknown, fallback: string[]) =>
    Array.isArray(v) && v.length ? v.map(String) : fallback;
  return {
    today: String(ctx?.today ?? new Date().toISOString().slice(0, 10)),
    travellers: arr(ctx?.people, ["גל"]),
    categories: arr(ctx?.categories, ["אחר"]),
    currencies: arr(ctx?.currencies, ["$"]),
  };
}

/* ------------------------------------------------------------------ */
/*  המסמכים המצורפים                                                   */
/* ------------------------------------------------------------------ */

const PDF = "application/pdf";
const IMAGES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
const TEXTS = ["text/plain", "text/markdown", "text/csv"];

const MAX_FILES = 3;
/** base64 מנפח כשליש, והמגבלה של ה-API היא 32MB לבקשה כולה */
const MAX_B64_TOTAL = 20_000_000;
const MAX_TEXT_CHARS = 60_000;

/**
 * מאמת את המסמכים שהגיעו מהלקוח ובונה מהם בלוקים לבקשה.
 * מחזיר הודעת שגיאה במקום בלוקים כשמשהו אינו תקין — לעולם לא מעביר
 * הלאה קלט שלא נבדק.
 */
function buildAttachments(raw: unknown): { blocks: DocBlock[]; names: string[] } | string {
  if (raw === undefined || raw === null) return { blocks: [], names: [] };
  if (!Array.isArray(raw)) return "המסמכים חייבים להגיע כמערך";
  if (raw.length > MAX_FILES) return `אפשר לצרף עד ${MAX_FILES} מסמכים בבקשה אחת`;

  const blocks: DocBlock[] = [];
  const names: string[] = [];
  let total = 0;

  for (const item of raw) {
    if (typeof item !== "object" || item === null) return "מסמך שאינו אובייקט";
    const a = item as { name?: unknown; mediaType?: unknown; data?: unknown };
    const name = String(a.name ?? "מסמך").trim().slice(0, 200);
    const mediaType = String(a.mediaType ?? "").toLowerCase().split(";")[0].trim();
    const data = String(a.data ?? "");

    if (!data) return `המסמך "${name}" הגיע ריק`;
    total += data.length;
    if (total > MAX_B64_TOTAL) return "המסמכים כבדים מדי יחד. צרפו אחד בכל פעם.";

    if (mediaType === PDF) {
      blocks.push({ type: "document", source: { type: "base64", media_type: PDF, data } });
    } else if ((IMAGES as readonly string[]).includes(mediaType)) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: mediaType as (typeof IMAGES)[number], data },
      });
    } else if (TEXTS.includes(mediaType)) {
      // טקסט נשלח כמסמך טקסט ולא כ-base64 — כך המודל מקבל אותו כמסמך
      // שאפשר לצטט ממנו, ולא כמחרוזת באמצע הבקשה
      let text: string;
      try {
        text = Buffer.from(data, "base64").toString("utf8");
      } catch {
        return `המסמך "${name}" לא נקרא`;
      }
      if (!text.trim()) return `המסמך "${name}" ריק`;
      blocks.push({
        type: "document",
        source: { type: "text", media_type: "text/plain", data: text.slice(0, MAX_TEXT_CHARS) },
      });
    } else {
      return `אפשר לצרף PDF, תמונה או טקסט. "${name}" אינו אחד מאלה.`;
    }
    names.push(name);
  }

  return { blocks, names };
}

/** התשובות לשאלות של הסבב הקודם, כפי שהמשתמש ענה עליהן */
function answerLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 8)
    .map((item) => {
      const a = item as Record<string, unknown> | null;
      if (!a || typeof a !== "object") return "";
      const q = String(a.question ?? "").trim().slice(0, 300);
      const ans = String(a.answer ?? "").trim().slice(0, 300);
      return q && ans ? `- ${q} → ${ans}` : "";
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/*  התשובה ללקוח                                                       */
/* ------------------------------------------------------------------ */

/**
 * הלקוח מקבל מבנה אחד בלבד, בלי קשר למסלול שרץ בשרת. השדות שהמסלול
 * לא מילא חוזרים ריקים, ושינוי יום ממסלול המסמך מושלם ל-null בשדות
 * שהוא אינו נוגע בהם — ככה הלקוח לא צריך לדעת איזו סכמה ענתה לו.
 */
interface ClientDayChange {
  n: number;
  title: string | null;
  summary: string | null;
  mode: string | null;
  driveKm: number | null;
  driveHours: number | null;
  driveNote: string | null;
  hotelName: string | null;
  hotelArea: string | null;
  plan: { time: string; text: string }[] | null;
  tips: string[] | null;
  places: string[] | null;
}

function fromDocDay(c: z.infer<typeof DocDayChange>): ClientDayChange {
  return {
    n: c.n,
    title: null,
    summary: null,
    mode: null,
    driveKm: null,
    driveHours: null,
    driveNote: null,
    hotelName: c.hotelName,
    hotelArea: c.hotelArea,
    plan: c.plan,
    tips: c.tips,
    places: c.places,
  };
}

/* ------------------------------------------------------------------ */

export default async (req: Request) => {
  if (req.method !== "POST") return fail("שיטה לא נתמכת", 405);

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return fail(
      "העוזר אינו מוגדר. צריך להוסיף ANTHROPIC_API_KEY במשתני הסביבה של Netlify.",
      503
    );
  }

  // הגנה אופציונלית: אם הוגדר קוד, הוא נדרש. האתר עצמו פתוח, ובלי זה
  // כל מי שיש לו את הכתובת יכול להפעיל את המודל על חשבון המפתח.
  // trim: ערך שהודבק לממשק של Netlify נושא לא פעם רווח או שורה חדשה,
  // והשוואה מדויקת הייתה נועלת את העוזר בלי שום דרך להבין למה
  const gate = process.env.AI_ACCESS_CODE?.trim();

  let body: {
    doc?: unknown;
    instruction?: unknown;
    code?: unknown;
    docs?: unknown;
    answers?: unknown;
    round?: unknown;
    context?: { people?: unknown; categories?: unknown; currencies?: unknown; today?: unknown };
  } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("גוף הבקשה אינו JSON תקין", 400);
  }
  if (!body) return fail("גוף הבקשה ריק", 400);

  if (gate && String(body.code ?? "").trim() !== gate) {
    return fail("קוד גישה שגוי", 401);
  }

  const attachments = buildAttachments(body.docs);
  if (typeof attachments === "string") return fail(attachments, 415);

  const instruction = String(body.instruction ?? "").trim();
  // מסמך לבדו הוא בקשה שלמה: מעלים כרטיס, וזה כל מה שצריך לומר
  if (!instruction && !attachments.blocks.length) {
    return fail("לא נשלחה בקשה ולא צורף מסמך", 422);
  }
  if (instruction.length > 2000) return fail("הבקשה ארוכה מדי", 413);

  const doc = body.doc;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return fail("מסמך הטיול חסר", 422);
  }
  const tripDoc = doc as Record<string, unknown>;
  const days = tripDoc.days;
  if (!Array.isArray(days) || !days.length) return fail("אין ימים במסלול לערוך", 422);

  const answers = answerLines(body.answers);
  const round = Math.min(Math.max(Number(body.round) || 0, 0), 5);
  // סבב שלישי הוא האחרון. שאלה רודפת שאלה היא לא דיאלוג אלא לופ, ועדיף
  // להחיל את מה שהובן ולציין את החסר מאשר להמשיך לשאול
  const finalRound = round >= 2;
  const withDocs = attachments.blocks.length > 0;

  const client = new Anthropic({ apiKey });

  // התשובה מוזרמת ולא מוחזרת בבת אחת: קריאה למודל על מסלול שלם, ועוד
  // יותר מכך על PDF סרוק, חוצה בקלות את 30 השניות שפונקציה רגילה מקבלת,
  // וזה מה שהפיל את הקריאה הראשונה באוויר. הזרמה מעלה את התקרה ל-60
  // שניות ומחזיקה את החיבור פתוח.
  return streamJson(async () => {
    try {
      const parts: string[] = [
        "המסלול הנוכחי:\n```json\n" +
          JSON.stringify(compactTrip(tripDoc), null, 1) +
          "\n```",
      ];

      if (!withDocs) {
        parts.push(
          "הקשר לרישום הוצאות:\n```json\n" +
            JSON.stringify(expenseContext(body.context), null, 1) +
            "\n```"
        );
      } else {
        parts.push(
          "המסמכים שצירפתי, לפי הסדר שבו הם מופיעים למעלה:\n" +
            attachments.names.map((n, i) => `${i + 1}. ${n}`).join("\n")
        );
      }
      if (answers.length) {
        parts.push("שאלת, ואלה התשובות:\n" + answers.join("\n"));
      }
      parts.push(
        "הבקשה שלי:\n" +
          (instruction || "צירפתי מסמך. קרא אותו והכנס לטיול את מה שהוא אומר.")
      );
      if (finalRound && withDocs) {
        parts.push(
          "זה הסבב האחרון. אל תשאל שאלות נוספות — החל את מה שאפשר לקבוע " +
            "מהמסמך ומהתשובות, וכתוב ב-warning מה נשאר לא מוכרע."
        );
      }

      const content = [
        // המסמכים לפני הטקסט — זה הסדר שהתיעוד מחייב למסמכים
        ...attachments.blocks,
        { type: "text" as const, text: parts.join("\n\n") },
      ];

      const response = await client.beta.messages.parse({
        model: "claude-opus-5-5",
        // ערכת שינויים היא פלט קצר — התקציב הגדול רק האריך את ההמתנה
        max_tokens: 8000,
        // low ולא medium: המשימה תחומה (שדות טקסט של יום, או פרטים
        // שמודפסים על כרטיס), והמחיר של חשיבה ארוכה כאן הוא משתמש
        // שממתין מול מסך טעינה
        output_config: {
          effort: "low",
          format: zodOutputFormat(withDocs ? DocResult : TextResult),
        },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [
          // הפרומפט יציב בין בקשות — שומרים אותו במטמון כדי שכמה עריכות
          // ברצף, וגם סבבי השאלות של אותה בקשה, ישלמו עליו פעם אחת
          {
            type: "text",
            text: withDocs ? SYSTEM_DOC : SYSTEM_TEXT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content }],
      });

      // מסרב = אין תוכן. בלי הבדיקה הזו parsed_output הוא null וההודעה סתומה.
      if (response.stop_reason === "refusal") {
        throw new StreamError("המודל סירב לבקשה הזו. נסחו אותה אחרת.");
      }

      const parsed = response.parsed_output;
      if (!parsed) throw new StreamError("התשובה מהמודל לא נקראה. נסו שוב.");

      const usage = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
      };

      const empty = {
        questions: [] as z.infer<typeof Question>[],
        dayChanges: [] as unknown[],
        flights: [] as (FlightInfo & { leg: string })[],
        docs: [] as z.infer<typeof DocMeta>[],
        expenses: [] as z.infer<typeof Expense>[],
        metaSubtitle: null as string | null,
      };

      // סבב שאלות: אין מה לפתור ואין מה להחיל, רק לשאול
      if (parsed.kind === "question" && parsed.questions.length) {
        if (!finalRound) {
          return {
            ...empty,
            kind: parsed.kind,
            summary: parsed.summary,
            warning: parsed.warning,
            questions: parsed.questions.slice(0, 3),
            usage,
          };
        }
        // המודל ממשיך לשאול אחרי שנאמר לו שזה הסבב האחרון. מוטב לומר
        // למשתמש מה חסר מאשר לפתוח סבב רביעי.
        return {
          ...empty,
          kind: "unclear",
          warning: parsed.warning,
          summary:
            "לא הצלחתי להכריע: " +
            parsed.questions.map((q) => q.text).join(" · ") +
            " — אפשר לכתוב את זה בבקשה עצמה.",
          usage,
        };
      }

      const rawDays: ClientDayChange[] = withDocs
        ? (parsed as z.infer<typeof DocResult>).dayChanges.map(fromDocDay)
        : ((parsed as z.infer<typeof TextResult>).dayChanges as ClientDayChange[]);

      // שמות המקומות הופכים לנקודות כאן, לא במודל. תקציב קריאות משותף
      // לכל הימים, כדי שבקשה אחת לא תחזיק את השירות החיצוני דקה שלמה.
      const budget = { lookups: 6 };
      const dayChanges = [];
      /*
       * יום שלוח הזמנים שלו נכתב מחדש בלי רשימת מקומות חדשה הוא יום
       * שיראה אחרת בתכנון היומי ואחרת במבט העל. הכללים אוסרים את זה,
       * אבל מודל יכול להחמיץ כלל — ואז עדיף שהמשתמש יידע מאשר שיגלה
       * בעצמו יומיים אחר כך, מול עמודה שלא מסתדרת.
       */
      const stale: number[] = [];
      for (const change of rawDays) {
        if (!change.places) {
          if (change.plan) stale.push(change.n);
          dayChanges.push({ ...change, points: null, unresolved: [] });
          continue;
        }
        const { points, unresolved } = await resolvePlaces(change.places, tripDoc, budget);
        dayChanges.push({ ...change, points, unresolved });
      }

      const staleNote = stale.length
        ? `לוח הזמנים של ${stale.length === 1 ? "יום" : "הימים"} ${stale.join(", ")} ` +
          "התעדכן, אבל נקודות המפה של אותו יום נשארו כפי שהיו — ייתכן שמבט " +
          "העל ומסלול היום לא יתאימו לתכנון. אפשר לבקש ממני לעדכן גם את המפה."
        : "";

      if (!withDocs) {
        const text = parsed as z.infer<typeof TextResult>;
        const warning = [text.warning, staleNote].filter(Boolean).join(" ");
        return { ...empty, ...text, warning: warning || null, dayChanges, usage };
      }

      // פרטי הטיסה נקראים בקריאה נפרדת, עם סכמה קטנה משלה, ורק עבור
      // מסמך שסווג ככרטיס טיסה. ראה את ההסבר בראש הקובץ.
      const docResult = parsed as z.infer<typeof DocResult>;
      const flights: (FlightInfo & { leg: string })[] = [];
      const notes: string[] = [];
      const passengers = passengersOf(tripDoc);

      for (const meta of docResult.docs.slice(0, MAX_FILES)) {
        if (meta.kind !== "flight") continue;
        const block = attachments.blocks[Number(meta.index) - 1];
        if (!block) continue;
        if (flights.length >= 2) break;             // יותר משתי רגליים אין לטיול

        const leg = meta.leg === "back" ? "back" : "out";
        if (!meta.leg) {
          notes.push("לא היה ברור אם הכרטיס הוא הלוך או חזור — עודכנה רגל ההלוך.");
        }
        try {
          const info = await readFlight(client, block, leg === "back" ? "חזור" : "הלוך", passengers);
          flights.push({ ...info, leg });
          if (info.note) notes.push(info.note);
        } catch (err) {
          // כישלון בקריאת הטיסה אינו מפיל את שאר הבקשה: המסמך עדיין
          // נשמר, והמשתמש יודע שהפרטים לא נקראו
          console.error("ai: קריאת כרטיס הטיסה נכשלה", err);
          notes.push("פרטי הטיסה לא נקראו מהכרטיס. אפשר לנסות שוב מלשונית הטיסות.");
        }
      }

      const warning = [docResult.warning, ...notes].filter(Boolean).join(" ");

      return {
        ...empty,
        kind: docResult.kind,
        summary: docResult.summary,
        warning: warning || null,
        docs: docResult.docs,
        dayChanges,
        flights,
        usage,
      };
    } catch (err) {
      if (err instanceof StreamError) throw err;
      // שגיאות מפתח ומכסה הן המקרים שהמשתמש יכול לפעול לפיהם — מפרידים אותן
      if (err instanceof Anthropic.AuthenticationError) {
        throw new StreamError("מפתח ה-API שגוי או פג.");
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new StreamError("חריגה ממכסת הקריאות. נסו שוב בעוד דקה.");
      }
      if (err instanceof Anthropic.APIConnectionError) {
        throw new StreamError("אין חיבור לשירות. בדקו רשת ונסו שוב.");
      }
      // 400 הוא כמעט תמיד באג אצלנו ולא אצל המשתמש, ו"נסו שוב" היה שולח
      // אותו לנסות שוב לנצח. ההודעה המקורית מופיעה כדי שיהיה מה לדווח.
      if (err instanceof Anthropic.BadRequestError) {
        console.error("ai: הבקשה נדחתה", err);
        throw new StreamError(
          "השירות דחה את הבקשה — זו תקלה באפליקציה ולא אצלכם: " +
            String(err.apiMessage || "").slice(0, 200)
        );
      }
      console.error("ai: הקריאה נכשלה", err);
      throw new StreamError("העוזר נכשל. נסו שוב.");
    }
  });
};

export const config: Config = {
  path: "/api/ai",
};
