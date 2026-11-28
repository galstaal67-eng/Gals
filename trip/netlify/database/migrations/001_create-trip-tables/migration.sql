-- הסכמה של אתר הטיול: הוצאות, מטיילים ושערי המרה.
-- שלושת אלה הם המצב המשותף שצריך להיראות זהה בכל הטלפונים.
-- תכנון העלויות, סימוני הציוד וערכת הצבעים נשארים מקומיים בכל מכשיר.

CREATE TABLE IF NOT EXISTS expenses (
  id          UUID PRIMARY KEY,
  spent_on    DATE          NOT NULL,
  amount      NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency    TEXT          NOT NULL CHECK (currency IN ('£', '€', '$', '₪')),
  category    TEXT          NOT NULL,
  payer       TEXT          NOT NULL,
  note        TEXT          NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- מחיקה רכה: הקשה מוטעית בטלפון לא מאבדת רשומה לתמיד
  deleted_at  TIMESTAMPTZ
);

-- כל השאילתות מסננות מחוקים וממיינות לפי תאריך
CREATE INDEX IF NOT EXISTS expenses_active_idx
  ON expenses (spent_on) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS travellers (
  name         TEXT PRIMARY KEY,
  couple_group INT  NOT NULL CHECK (couple_group BETWEEN 1 AND 9),
  sort_order   INT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fx_rates (
  currency     TEXT PRIMARY KEY CHECK (currency IN ('£', '€', '$', '₪')),
  ils_per_unit NUMERIC(10, 4) NOT NULL CHECK (ils_per_unit > 0),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ערכי פתיחה, כדי שהאתר לא ייפתח ריק בפעם הראשונה.
-- ON CONFLICT DO NOTHING שומר על המיגרציה בטוחה להרצה חוזרת.
INSERT INTO travellers (name, couple_group, sort_order) VALUES
  ('גל',   1, 1),
  ('נועה', 1, 2),
  ('חזי',  2, 3),
  ('שרון', 2, 4)
ON CONFLICT (name) DO NOTHING;

INSERT INTO fx_rates (currency, ils_per_unit) VALUES
  ('£', 4.6500),
  ('€', 4.0000),
  ('$', 3.4500),
  ('₪', 1.0000)
ON CONFLICT (currency) DO NOTHING;
