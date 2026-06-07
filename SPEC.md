# SPEC — מודל נתונים, מכונות מצב ו-API (מערכת SOX)

> מסמך החוזה הטכני לפיתוח. מבוסס על נספח א' של מסמך האפיון, **מתוקן** בהתאם
> ל-`DECISIONS.md` (v1.0). כל המזהים בשכבת הקוד באנגלית; שמות הישויות בעברית
> רק ב-UI/i18n. כל שינוי כאן מחייב עדכון `DECISIONS.md`.
>
> **סטטוס:** הצעה טכנית — לאימות ואישור אדריכל המערכת לפני יישום.

---

## 0. סטאק טכנולוגי (מתוך DECISIONS)

| שכבה | בחירה |
|------|--------|
| ענן | Azure |
| DB | PostgreSQL + Row-Level Security (RLS) |
| Backend | Python (FastAPI) + REST API |
| Frontend | React + TypeScript, RTL + i18n (he/en) |
| זהות | Entra ID (יועצים) · Local + 2FA (לקוחות/רו"ח) |
| מייל | Microsoft Graph + Subscriptions |
| אחסון | Azure Blob Storage (SHA-256, ללא מחיקה פיזית) |
| AI (שלב ב') | Anthropic Claude מאחורי שכבת הפשטה |

---

## 1. מודל נתונים — טבלאות עיקריות

> כל טבלה מחזיקה `tenant_id` למעט מידע גלובלי (`processes`/`risks` עם
> `is_global=true`). Multi-tenancy נאכפת ב-RLS לפי `tenant_id` מ-JWT.
> כל הטבלאות כוללות `deleted_at` ל-soft-delete (אין מחיקה פיזית — דרישת SOX).

### tenants
`id` (PK), `name`, `subdomain`, `status` (active/suspended), `ad_tenant_id`, `created_at`, `deleted_at`

### users
`id` (PK), `tenant_id` (FK), `email`, `full_name`, `role` (admin/manager/consultant/client/auditor), `client_subrole` (control_owner/control_operator), `auth_provider` (entra/local), `is_active`, `mfa_enabled`, `last_login_at`

> **C3:** `auth_provider` נוסף — `entra` ליועצים פנימיים, `local` (עם 2FA)
> ללקוחות ורו"ח מבקר.

### user_assignments
`id` (PK), `user_id` (FK), `client_id` (FK→clients), `subsidiary_id` (FK nullable), `process_type` (business/itgc)

### clients
`id` (PK), `tenant_id` (FK), `name`, `industry`, `address`, `ticker`, `is_public` (bool), `regulations` (jsonb: SOX/ISOX/CSOX), `status`

> **C1:** `materiality_threshold` הוסר מ-`clients` — עבר ל-`materiality_parameters`.

### audit_years
`id` (PK), `client_id` (FK), `year` (int, YYYY), `status` (open/locked/archived), `opened_at`, `locked_at`, `locked_by`

### materiality_parameters  *(חדש — C1)*
`id` (PK), `tenant_id` (FK), `audit_year_id` (FK), `subsidiary_id` (FK nullable), `slot` (1/2/3), `parameter_type` (sales/net_income/assets/operating_income/equity/pretax_income/cash/operating_expenses), `value` (numeric), `percentage` (numeric), `computed_threshold` (numeric, read-only = value × percentage), `created_at`

> מחזיק 1..N רשומות לכל שנת ביקורת/חברה. `subsidiary_id=NULL` = הגדרת הלקוח
> ברמת שנת הביקורת; מאוכלס לחברה בת בעת בחינת הסף הכמותי.

### subsidiaries
`id` (PK), `client_id` (FK), `audit_year_id` (FK), `name`, `quantitative_result` (pass/fail), `qualitative_result` (pass/fail), `in_scope_previous_year` (bool), `is_significant` (bool), `scope_approved` (bool), `scope_approved_by`, `scope_approved_at`

> **C1:** `materiality_threshold` הוסר. תוצאות הבחינה הכמותית/איכותית נשמרות
> כאן; ערכי הפרמטרים ב-`materiality_parameters`.

### subsidiary_qualitative_answers
`id` (PK), `subsidiary_id` (FK), `audit_year_id` (FK), `question_key` (separate_location/separate_management/separate_systems/unique_reporting_risk/fraud_or_error), `answer` (bool)

> 5 שאלות איכותיות. אם ≥4 תשובות "כן" → המלצה איכותית = "כן".

### processes
`id` (PK), `tenant_id` (FK nullable למידע גלובלי), `code`, `name_he`, `name_en`, `category` (business/itgc), `itgc_layer` (network/application/database/app_server/db_server — רק ל-itgc), `is_global` (bool — בנק מול per-client)

### sub_activities
`id` (PK), `process_id` (FK), `name_he`, `name_en`, `is_global` (bool)

> "תת פעילות" המשויכת לתהליך. ניתנת להזרקה ידנית ונשמרת לבנק.

### risks
`id` (PK), `process_id` (FK), `code`, `description_he`, `description_en`, `classification` (financial/operational), `complexity` (medium/medium_high/high), `frequency`, `inherent_probability` (low/medium/high/very_high), `financial_damage` (1-5), `reputation` (1-5), `regulation` (1-5), `inherent_rating` (low/medium/high/very_high), `residual_rating` (low/medium/high/very_high), `is_global` (bool)

> שדות הדירוג (complexity..residual_rating) רלוונטיים רק כשהתהליך **אינו** ITGC.

### control_bank
בנק/קטלוג בקרות לבחירה — שורות גלובליות (`is_global=true`, `tenant_id=NULL`)
נזרעות מקטלוג ה-RCM (ראה DECISIONS C9) ומשמרות את מאפייני הבקרה לבחירה.
`id` (PK), `tenant_id` (FK, nullable), `code`, `name_he`, `desired_description`,
`is_global` (bool), `process_id` (FK processes, nullable), `step`,
`risk_description`, `owner_hint`, `default_purpose`, `default_type`,
`default_frequency`, `is_key_default` (bool). בעת ייבוא בקרה מהקטלוג מועתקים
שדות ה-`default_*` אל מופע ה-`controls`.

### controls
`id` (PK), `tenant_id` (FK), `risk_id` (FK), `subsidiary_id` (FK), `audit_year_id` (FK), `code`, `previous_code`, `system_name`, `control_name`, `desired_description`, `actual_description`, `purpose` (preventive/directive/detective/compensating), `control_type` (manual/automatic/hybrid), `frequency` (ongoing/automatic/weekly/monthly/quarterly/semiannual/annual/ad_hoc), `owner_user_id`, `operator_user_id`, `is_key_control` (bool), `status` (draft/in_validation/needs_validation/needs_fix/validated)

### control_tests
`id` (PK), `tenant_id` (FK), `control_id` (FK), `audit_year_id` (FK), `test_round` (round_a/round_b/both/not_required), `required_evidence` (jsonb), `test_method`, `results`, `notes`, `status` (ראה §3 — enum 12 סטטוסים), `severity` (deficiency/material_deficiency/material_weakness, nullable), `effectiveness` (effective/ineffective/not_relevant, nullable), `compensating_control`, `company_response`, `assigned_to_user_id`, `due_date`, `no_due_date` (bool), `ready_to_send` (bool), `completed_at`

> **C2:** `status` עם 12 ערכים (§3). `severity` = "חומרת ליקוי" (שדה נפרד,
> אינו סטטוס).

### evidences
`id` (PK), `test_id` (FK), `filename`, `file_hash` (sha256), `file_size`, `storage_path`, `is_sample` (bool), `notes`, `uploaded_by_user_id`, `uploaded_at`, `source` (manual/email), `email_message_id`, `replaced_by_id` (FK nullable — החלפה, לא מחיקה)

### findings
`id` (PK), `tenant_id` (FK), `control_id` (FK), `test_id` (FK nullable), `source` (consultant/auditor), `severity` (critical/high/medium/low), `description`, `identified_by_user_id`, `identified_at`, `status` (open/in_remediation/closed/canceled), `remediation_due_date`, `closed_at`

### approvals
`id` (PK), `entity_type` (control/test/finding/year_close/subsidiary_scope), `entity_id`, `approver_user_id`, `decision` (approved/rejected), `reason`, `created_at`

### notifications
`id` (PK), `recipient_user_id` (FK), `event_type`, `entity_type`, `entity_id`, `channel` (email/in_app/sms), `read_at`, `created_at`

### audit_log  *(APPEND-ONLY)*
`id` (PK), `tenant_id`, `user_id`, `action` (CREATE/UPDATE/DELETE/APPROVE/REJECT/LOGIN), `entity_type`, `entity_id`, `before_jsonb`, `after_jsonb`, `ip`, `user_agent`, `created_at`

> ללא UPDATE/DELETE. כל מעבר מצב יוצר רשומה.

### email_threads
`id` (PK), `tenant_id` (FK), `test_id` (FK nullable), `control_id` (FK nullable), `client_id` (FK), `bucket` (validation/tests/auditor), `subject`, `message_id`, `in_reply_to`, `is_reviewed` (bool), `last_activity_at`

> `bucket` מייצג את שלושת השדות בטאב "לטיפול היועצים": מענה תיקוף /
> טסטים-ראיות / התייחסות המבקרים.

---

## 2. הערות Multi-tenancy ו-RLS

- כל טבלה (למעט גלובלי) עם `tenant_id`; RLS policy ב-PostgreSQL מסנן לפי
  `tenant_id` מתוך ה-JWT.
- `processes`/`risks`/`sub_activities` עם `is_global=true` = בנק גלובלי
  (Q6), עם אפשרות override per-tenant (רשומה מקבילה עם `tenant_id` ו-`is_global=false`).
- soft-delete בלבד (`deleted_at`); retention 7 שנים (Q5, R1).

---

## 3. enum סטטוסי טסט (C2)

```
1.  pending_receipt        טרם התקבל (ברירת מחדל)
2.  consultant_handling    לטיפול היועץ
3.  company_completion     בהשלמת החברה
4.  additional_evidence    ראיות נוספות לבחינה
5.  reviewed_approved      בקרה נבדקה ואושרה
6.  internally_closed      בקרה פנימית סגורה
7.  needs_attention        דורש טיפול
8.  deficiency_open        ליקוי פתוח
9.  deficiency_compensated ליקוי עם בקרה מפצה
10. deficiency_closed      ליקוי סגור
11. round_b_pending        ייבדק בסבב ב'
12. not_relevant           לא רלוונטי
```

`severity` (חומרת ליקוי, שדה נפרד): `deficiency` / `material_deficiency` / `material_weakness`.

---

## 4. מכונות מצב (State Machines)

> כל מעבר מצב יוצר רשומת `audit_log`. מעברים לא חוקיים נדחים על ידי השרת.

### בקרה (Control)
```
draft → in_validation (consultant: "נדרש תיקוף")
in_validation → needs_validation (מייל ללקוח)
needs_validation → validated (לקוח/יועץ מאשר)
needs_validation → needs_fix (לקוח הציע שינוי / נערך תא)
needs_fix → in_validation (יועץ עדכן ושלח שוב)
validated → (נעילה; שינוי רק manager+)
```

### טסט בקרה (Control Test) — 12 סטטוסים
```
pending_receipt → consultant_handling   (הלקוח השיב למייל / העלה ראיות)
consultant_handling → reviewed_approved (יועץ: ראיות תקינות → לרו"ח)
consultant_handling → company_completion | deficiency_open
                                         (ראיות חסרות/חשד לממצא)
company_completion → additional_evidence (לקוח השלים, יש ראיות חדשות)
additional_evidence → reviewed_approved | deficiency_open
reviewed_approved → consultant_handling  (רו"ח דורש השלמה)
reviewed_approved → internally_closed    (רו"ח אישר)
deficiency_open → deficiency_compensated | deficiency_closed
                                         (לאחר השלמת בקרה מפצה)
needs_attention ←→ (מנהל תיק מסמן לטיפול ידני)
round_b_pending  (נדחה לסבב ב')
not_relevant     (סטטוס סופי ניטרלי)
```

> מעברי `needs_attention`/`round_b_pending`/`not_relevant` ניתנים להגעה ידנית
> ע"י יועץ ומעלה בהתאם לשיקול דעת. הטריגרים האוטומטיים (איפוס `ready_to_send`
> בעת מעבר ל-`company_completion`/`deficiency_open`) מוגדרים בשכבת השירות.

### ממצא (Finding)
```
open → in_remediation (client)
in_remediation → closed (consultant approves)
open → canceled (manager only, with reason)
```

---

## 5. API Endpoints (REST) — Skeleton

> כל הקריאות תחת `/api/v1`, דורשות JWT. multi-tenancy נאכפת ב-middleware
> לפי `tenant_id` מה-token.

```
POST   /auth/login                          התחברות (החזרת JWT)
POST   /auth/refresh                         חידוש token
POST   /auth/mfa/verify                      אימות 2FA (local users)
GET    /auth/sso/entra                       התחלת SSO מול Entra ID

GET    /clients                              רשימת לקוחות (מסונן לפי הרשאות)
POST   /clients                              יצירת לקוח (admin/manager)
GET    /clients/{id}                         שליפת לקוח
GET    /clients/{id}/audit-years
POST   /clients/{id}/audit-years
POST   /audit-years/{id}/clone-from-previous העתקת נתונים משנה קודמת
POST   /audit-years/{id}/lock                נעילת שנה (manager+admin)

GET    /audit-years/{id}/materiality-parameters
POST   /audit-years/{id}/materiality-parameters   יצירת פרמטר מהותיות (C1)
PATCH  /materiality-parameters/{id}

GET    /subsidiaries?client_id&audit_year_id
POST   /subsidiaries
PATCH  /subsidiaries/{id}
POST   /subsidiaries/{id}/qualitative-answers
POST   /subsidiaries/{id}/scope-decision      קביעת כניסה לסקופ (manager)

GET    /processes?subsidiary_id               (כולל בנק גלובלי + override)
POST   /processes
POST   /processes/import-csv                  יבוא לבנק תהליכים
GET    /risks?process_id
POST   /risks

GET    /controls?subsidiary_id&audit_year_id
POST   /controls
PATCH  /controls/{id}
POST   /controls/{id}/transition              מעבר state (body: target_state, reason)
POST   /controls/{id}/request-validation      שליחת מייל תיקוף ללקוח

GET    /tests?audit_year_id&assigned_to=me
PATCH  /tests/{id}
POST   /tests/{id}/evidences                  multipart upload
POST   /tests/{id}/evidences/{eid}/replace    החלפת קובץ (ללא מחיקה)
POST   /tests/{id}/transition                 מעבר בין 12 הסטטוסים
POST   /tests/{id}/send-evidence-request      שליחת מייל בקשת ראיות ללקוח

GET    /findings?status=open
POST   /findings
PATCH  /findings/{id}

GET    /dashboards/consultant                 KPIs לפי תפקיד
GET    /dashboards/client
GET    /dashboards/auditor

GET    /audit-log?entity=control&id={id}
GET    /reports/sox-matrix?client_id&audit_year_id&format=xlsx|pdf
GET    /reports/export-full?client_id&subsidiary_ids[]   ייצוא ZIP

POST   /email/inbound                         webhook קליטת מייל (Microsoft Graph)
GET    /email/threads?bucket=validation|tests|auditor
POST   /email/threads/{id}/reply
PATCH  /email/threads/{id}/mark-reviewed
```

---

## 6. פערים שיושבו מול האפיון המקורי

| מזהה | פער במקור | תיקון |
|------|-----------|--------|
| C1 | `materiality_threshold` בודד | טבלת `materiality_parameters` (1..N) |
| C2 | enum סטטוסים חלקי (~6) | 12 סטטוסים מלאים (§3) |
| C3 | זהות לא מוגדרת | `auth_provider` (entra/local) |
| C6 | הפניות צולבות שבורות במקור ("4.15.5.1.5.15") | הוסרו; המסמך מאורגן לפי ישויות |

---

## 7. שלבי פיתוח (מתוך האפיון, vertical slices)

| Phase | תוכן |
|-------|------|
| 1 | תשתית + MVP: מידע כללי + ניהול משתמשים/הרשאות + Auth (כולל audit log, RLS, RBAC, i18n מהיום הראשון) |
| 2 | מודולי ליבה: שנות ביקורת, תהליכים, סיכונים |
| 3 | בקרות ותיקופים |
| 4 | טסטים ודוחות |
| 5 | דשבורדים והתראות |
| 6 | תכונות מתקדמות (AI, אינטגרציות) |

**Definition of Done לכל slice:** קוד + טסטים (80%+ unit) + audit log +
בדיקת הרשאות + i18n keys + עדכון `SPEC.md`/`DECISIONS.md` במידת הצורך.
