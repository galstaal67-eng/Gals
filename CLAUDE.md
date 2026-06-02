# CLAUDE.md — הנחיות עבודה למאגר SOX

## מקורות אמת
- `SPEC.md` — החוזה הטכני (מודל נתונים, מכונות מצב, API). מקור אמת לפיתוח.
- `DECISIONS.md` — יומן ההחלטות (14 הכרעות). כל שינוי בהחלטה מעדכן את שניהם.

## עקרונות מחייבים (דרישות SOX)
- **Audit log append-only** — אין UPDATE/DELETE על `audit_log`. כל פעולת
  CREATE/UPDATE/DELETE/APPROVE/REJECT/LOGIN ומעבר state יוצרים רשומה.
- **Soft-delete בלבד** — שדה `deleted_at`, אין מחיקה פיזית. retention 7 שנים.
- **Multi-tenancy** — RLS ב-PostgreSQL לפי `tenant_id` מה-JWT. אין שאילתה
  שחוצה tenants (למעט מידע גלובלי `is_global=true`).
- **קבצים** — החלפה בלבד (`replaced_by_id`), לא מחיקה. hash SHA-256.

## קונבנציות קוד
- מזהים, שמות טבלאות/עמודות, enums — **באנגלית**. שמות ישויות בעברית רק ב-UI/i18n.
- Python 3.12, FastAPI, SQLAlchemy 2.0 async, Pydantic v2.
- כל endpoint תחת `/api/v1`, דורש JWT, multi-tenancy נאכפת ב-middleware/deps.
- RBAC: 5 תפקידים (admin/manager/consultant/client/auditor) + תת-תפקיד לקוח
  (control_owner/control_operator). ראה `core/rbac.py`.

## Definition of Done (לכל slice)
קוד + טסטים (80%+ unit) + audit log + בדיקת הרשאות (RBAC) + i18n keys +
עדכון `SPEC.md`/`DECISIONS.md` במידת הצורך.

## enum סטטוסי טסט — 12 (מוסמך, ראה SPEC §3)
`pending_receipt, consultant_handling, company_completion, additional_evidence,
reviewed_approved, internally_closed, needs_attention, deficiency_open,
deficiency_compensated, deficiency_closed, round_b_pending, not_relevant`
> `severity` (חומרת ליקוי) הוא שדה נפרד — אינו סטטוס.

## פאזות
1 (MVP: לקוחות+משתמשים+Auth) → 2 (שנות ביקורת/תהליכים/סיכונים) → 3 (בקרות/תיקופים)
→ 4 (טסטים/דוחות) → 5 (דשבורדים/התראות) → 6 (AI/אינטגרציות).

## git
- ברנץ' פיתוח: `claude/nice-davinci-y1C0n`.
- אין לפתוח PR ללא בקשה מפורשת.
