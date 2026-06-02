# SOX System

מערכת לניהול ותיעוד תהליך ה-SOX (Multi-tenant). ראה `SPEC.md` לחוזה הטכני
ו-`DECISIONS.md` ליומן ההחלטות.

## Stack

- **Backend:** Python 3.12 · FastAPI · SQLAlchemy 2.0 (async) · Alembic
- **DB:** PostgreSQL 16 + Row-Level Security (multi-tenant)
- **Auth:** JWT · Entra ID (יועצים) · Local + 2FA (לקוחות/רו"ח)
- **Cloud:** Azure (Blob Storage, Entra ID, Microsoft Graph)
- **Frontend:** React + TypeScript (נפרד, יתווסף בהמשך)

## Phase 1 scope (MVP)

מודול מידע כללי (לקוחות) + ניהול משתמשים/הרשאות + Auth, עם התשתיות
הרוחביות מהיום הראשון: Audit Log (append-only), RLS multi-tenant, RBAC,
i18n (he/en).

## פיתוח מקומי

```bash
# 1. הקמת PostgreSQL מקומי
docker compose up -d db

# 2. סביבה
cp .env.example .env
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 3. מיגרציות
alembic upgrade head

# 4. הרצה
uvicorn app.main:app --reload --app-dir backend

# 5. טסטים
pytest
```

ה-API ב-`http://localhost:8000`, תיעוד OpenAPI ב-`/docs`.

## מבנה

```
backend/app/
  api/v1/      — REST endpoints (/api/v1)
  core/        — security (JWT), rbac, audit
  db/          — session, base, RLS
  models/      — SQLAlchemy models
  schemas/     — Pydantic schemas
  i18n/        — תרגומים he/en
backend/tests/ — pytest
```
