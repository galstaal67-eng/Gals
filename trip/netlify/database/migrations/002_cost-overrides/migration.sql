-- תכנון העלויות עובר למצב המשותף.
-- עד כאן העריכות של שורות התכנון ("החלף אומדן במחיר האמיתי שהזמנתי")
-- נשמרו ב-localStorage בלבד, כלומר לא עברו בין המכשירים של בני הזוג.
-- מרגע שמזמינים בפועל זה הנתון שהכי חשוב שיהיה משותף.

CREATE TABLE IF NOT EXISTS cost_overrides (
  -- "groupKey:index", למשל "hotels:3" — מפתח השורה בלשונית תכנון העלויות
  item_key    TEXT PRIMARY KEY CHECK (item_key ~ '^[a-z_]+:[0-9]+$'),
  -- אחד משניהם יכול להיות NULL: המשתמש עורך "מ־" בלי "עד" ולהפך
  low_amount  NUMERIC(12, 2) CHECK (low_amount  >= 0),
  high_amount NUMERIC(12, 2) CHECK (high_amount >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- שורה שאין בה אף ערך היא רעש; מוחקים אותה במקום לשמור
  CONSTRAINT cost_overrides_not_empty
    CHECK (low_amount IS NOT NULL OR high_amount IS NOT NULL)
);
