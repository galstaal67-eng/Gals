-- מעבר הטיול לטביליסי: הוספת הלארי הגאורגי (₾) כמטבע נתמך.
-- בלי המיגרציה הזו כל הוצאה שתירשם בלארי תידחה ע"י ה-CHECK של הטבלה,
-- וזה היה מתגלה רק בפעם הראשונה שמישהו מקליד הוצאה בטביליסי.

-- הערה על שמות האילוצים: הם נוצרו אוטומטית ב-001 ולכן נושאים את שם
-- הטבלה והעמודה. DROP ... IF EXISTS שומר על המיגרציה בטוחה להרצה חוזרת.

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_currency_check;
ALTER TABLE expenses ADD  CONSTRAINT expenses_currency_check
  CHECK (currency IN ('₾', '$', '€', '£', '₪'));

ALTER TABLE fx_rates DROP CONSTRAINT IF EXISTS fx_rates_currency_check;
ALTER TABLE fx_rates ADD  CONSTRAINT fx_rates_currency_check
  CHECK (currency IN ('₾', '$', '€', '£', '₪'));

-- שער פתיחה ללארי: ₾1 ≈ $0.386 ≈ 1.33 ₪ (נובמבר 2026).
-- זה אומדן התחלתי בלבד — אפשר לעדכן אותו מהאתר, בלשונית ההוצאות.
INSERT INTO fx_rates (currency, ils_per_unit) VALUES ('₾', 1.3300)
ON CONFLICT (currency) DO NOTHING;

-- תכנון העלויות: המפתחות ב-cost_overrides הם מיקומיים ("groupKey:index"),
-- והשורות של סקוטלנד אינן קיימות יותר — "flights:0" היה כרטיס ללופטהנזה
-- ועכשיו הוא כרטיס סאנדור. השארה שלהן תציג מספרים שגויים בשקט, ולכן מנקים.
-- ההוצאות עצמן (טבלת expenses) לא נגעו בהן.
DELETE FROM cost_overrides;
