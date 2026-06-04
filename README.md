# SOX System

מערכת לניהול ותיעוד תהליך ה-SOX (Multi-tenant). ראה `SPEC.md` לחוזה הטכני
ו-`DECISIONS.md` ליומן ההחלטות. להטמעה ב-Azure ראה `docs/AZURE_DEPLOYMENT.md`.

## 🚀 הרצת דמו בפקודה אחת (Docker)

הדרך המהירה לראות את המערכת (UI + API) רצה מקומית — דורש Docker Desktop:

```bash
docker compose up --build
```

זה מקים PostgreSQL, מריץ מיגרציות, זורע tenant דמו, ומפעיל backend + frontend:

| שירות | כתובת | פרטים |
|-------|-------|--------|
| **ממשק (UI)** | http://localhost:8080 | התחברות לדמו |
| **API + Swagger** | http://localhost:8000/docs | תיעוד אינטראקטיבי |

**פרטי התחברות לדמו:**
- מזהה ארגון (subdomain): `demo`
- דוא"ל: `admin@demo.local`
- סיסמה: `Demo12345!`

לעצירה: `docker compose down` (להוספת `-v` כדי למחוק גם את ה-DB).

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

## Frontend (React + TypeScript)

```bash
cd frontend
cp .env.example .env
npm install
npm run dev        # http://localhost:5173 (מ-proxy ל-/api → backend)
npm run build      # typecheck + production build
```

תמיכת RTL/LTR ו-i18n (he/en) מובנית, מתחלפת בכפתור שפה בסרגל הניווט.

## מבנה

```
backend/app/
  api/v1/      — REST endpoints (/api/v1): auth, mfa, tenants, users, clients, contacts
  core/        — security (JWT/TOTP), rbac, audit, entra (SSO)
  db/          — session, base, RLS, portable types
  models/      — SQLAlchemy models
  schemas/     — Pydantic schemas
  i18n/        — תרגומים he/en
backend/tests/ — pytest (38 טסטים)

frontend/src/
  api/         — client (fetch+JWT), auth, clients, users
  auth/        — AuthContext
  components/  — Layout, ProtectedRoute
  pages/       — Login (כולל MFA + SSO), Clients, Users
  i18n/        — he/en + ניהול כיוון RTL/LTR
```
