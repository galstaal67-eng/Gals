-- מעבר מאתר של טיול אחד לאפליקציית טיולים.
--
-- עד כאן expenses, travellers ו-cost_overrides היו גלובליים, כי היה בדיוק
-- טיול אחד. ברגע שיש שניים, הוצאה שנרשמה בטביליסי הייתה מופיעה גם בטיול הבא
-- ונכנסת לקיזוז שלו. לכן שלושתם מקבלים trip_id, והרשומות הקיימות משויכות
-- לטביליסי — שום דבר לא נמחק ושום דבר לא זז.

CREATE TABLE IF NOT EXISTS trips (
  id          TEXT PRIMARY KEY,
  -- המסמך המלא של הטיול, באותו מבנה שהאפליקציה מרנדרת ממנו.
  -- JSONB ולא עמודות: המבנה מתפתח (ימים, טיפים, תכנון עלויות), ושמירה
  -- כמסמך אחד נותנת כתיבה אטומית ומונעת מיגרציה על כל שינוי במסלול.
  doc         JSONB        NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS trips_active_idx
  ON trips (updated_at DESC) WHERE deleted_at IS NULL;

-- הטיול הקיים נרשם לפני השיוך, כדי שה-FK שלמטה יהיה תקף.
-- doc ריק כאן בכוונה: האפליקציה דוחפת את המסמך המלא בסנכרון הראשון,
-- וזרע הקוד (data.js) הוא ממילא מקור האמת עד אז.
INSERT INTO trips (id, doc) VALUES ('tbilisi-2026', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------- שיוך

ALTER TABLE expenses       ADD COLUMN IF NOT EXISTS trip_id TEXT;
ALTER TABLE cost_overrides ADD COLUMN IF NOT EXISTS trip_id TEXT;
ALTER TABLE travellers     ADD COLUMN IF NOT EXISTS trip_id TEXT;

UPDATE expenses       SET trip_id = 'tbilisi-2026' WHERE trip_id IS NULL;
UPDATE cost_overrides SET trip_id = 'tbilisi-2026' WHERE trip_id IS NULL;
UPDATE travellers     SET trip_id = 'tbilisi-2026' WHERE trip_id IS NULL;

ALTER TABLE expenses       ALTER COLUMN trip_id SET NOT NULL;
ALTER TABLE cost_overrides ALTER COLUMN trip_id SET NOT NULL;
ALTER TABLE travellers     ALTER COLUMN trip_id SET NOT NULL;

-- מחיקת טיול גוררת את מה ששייך לו. הוצאות הן ההקשר של הטיול ואין להן
-- משמעות בלעדיו, ולכן CASCADE ולא RESTRICT.
ALTER TABLE expenses       DROP CONSTRAINT IF EXISTS expenses_trip_fk;
ALTER TABLE expenses       ADD  CONSTRAINT expenses_trip_fk
  FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE cost_overrides DROP CONSTRAINT IF EXISTS cost_overrides_trip_fk;
ALTER TABLE cost_overrides ADD  CONSTRAINT cost_overrides_trip_fk
  FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

ALTER TABLE travellers     DROP CONSTRAINT IF EXISTS travellers_trip_fk;
ALTER TABLE travellers     ADD  CONSTRAINT travellers_trip_fk
  FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE;

-- --------------------------------------------------------- מפתחות ראשיים
-- שתי הטבלאות האלה היו ממופתחות בערך שאינו ייחודי יותר בין טיולים:
-- אותו שם מטייל ואותו "flights:0" קיימים בכל טיול. המפתח נעשה מורכב.

ALTER TABLE travellers     DROP CONSTRAINT IF EXISTS travellers_pkey;
ALTER TABLE travellers     ADD  PRIMARY KEY (trip_id, name);

ALTER TABLE cost_overrides DROP CONSTRAINT IF EXISTS cost_overrides_pkey;
ALTER TABLE cost_overrides ADD  PRIMARY KEY (trip_id, item_key);

-- האינדקס של ההוצאות הפעילות כולל עכשיו את הטיול — כל שאילתה מסננת לפיו
DROP INDEX IF EXISTS expenses_active_idx;
CREATE INDEX IF NOT EXISTS expenses_active_idx
  ON expenses (trip_id, spent_on) WHERE deleted_at IS NULL;

-- שערי ההמרה נשארים גלובליים בכוונה: שער דולר-שקל אינו תכונה של טיול.
