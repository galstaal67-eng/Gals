"""Seed fully-populated demo clients under the demo tenant.

Idempotent per-client (skips a client that already exists). Run after the
tenant bootstrap (entrypoint does both):

    python -m app.scripts.seed_demo

Builds complete end-to-end chains so every screen shows real data and the full
workflow is visible:
  client → contacts → audit year → materiality → subsidiaries (+ qualitative
  answers) → process selections → risk selections (full ratings) → controls
  (all 4 statuses) → tests (all 12 statuses, fully filled) → evidence,
  plus notifications and outbox emails.
"""

import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal, set_tenant
from app.models.audit_year import AuditYear
from app.models.client import Client
from app.models.contact import Contact
from app.models.control import Control
from app.models.control_test import ControlTest, Evidence
from app.models.email_message import EmailMessage
from app.models.enums import (
    AuditYearStatus,
    AuthProvider,
    ClientSubrole,
    ControlEffectiveness,
    ControlFrequency,
    ControlPurpose,
    ControlStatus,
    ControlType,
    DeficiencySeverity,
    MaterialityParameterType,
    NotificationChannel,
    ProcessCategory,
    QualitativeQuestion,
    RiskClassification,
    RiskComplexity,
    RiskFrequency,
    RiskProbability,
    RiskRating,
    ScopeResult,
    TestRound,
    TestStatus,
    UserRole,
)
from app.models.materiality import MaterialityParameter
from app.models.notification import Notification
from app.models.process import Process
from app.models.process_selection import ProcessSelection
from app.models.risk import Risk, RiskSelection
from app.models.subsidiary import Subsidiary, SubsidiaryQualitativeAnswer
from app.models.tenant import Tenant
from app.models.user import User

DEMO_SUBDOMAIN = "demo"
DEMO_PASSWORD = "Demo12345!"
NOW = datetime(2025, 6, 1, tzinfo=timezone.utc)

QQ = QualitativeQuestion
TS = TestStatus
CS = ControlStatus

_hash_counter = 0


def _evidence(tid, test_id, filename, *, size=51200, is_sample=False, notes=None):
    global _hash_counter
    _hash_counter += 1
    digest = f"{_hash_counter:064x}"  # unique 64-char hex (sha256-shaped)
    return Evidence(
        tenant_id=tid, test_id=test_id, filename=filename, file_hash=digest,
        file_size=size, is_sample=is_sample, notes=notes,
    )


def _test_kwargs(status: TestStatus) -> dict:
    """Fully-populated test fields appropriate to a given status."""
    base = dict(
        test_round=TestRound.ROUND_A,
        required_evidence=["מסמך מדיניות הבקרה", "צילום מסך מהמערכת", "דגימת רשומות"],
        test_method="בחירת מדגם של 25 פריטים ובדיקת ביצוע הבקרה בפועל.",
        notes="נבדק במסגרת סבב א'.",
    )
    ok, bad = ControlEffectiveness.EFFECTIVE, ControlEffectiveness.INEFFECTIVE
    if status in (TS.REVIEWED_APPROVED, TS.INTERNALLY_CLOSED):
        base.update(
            results="הבקרה בוצעה כנדרש בכל הפריטים שנבדקו.",
            effectiveness=ok, company_response="אין הערות.",
            completed_at=NOW,
        )
    elif status == TS.DEFICIENCY_OPEN:
        base.update(
            results="נמצאו פערים בביצוע הבקרה.", effectiveness=bad,
            severity=DeficiencySeverity.MATERIAL_DEFICIENCY,
            deficiencies_found="ב-3 מתוך 25 הפריטים לא נמצאה ראיה לביצוע הבקרה.",
            company_response="החברה בוחנת את הממצא.",
        )
    elif status == TS.DEFICIENCY_COMPENSATED:
        base.update(
            results="קיים ליקוי אך אותרה בקרה מפצה אפקטיבית.", effectiveness=bad,
            severity=DeficiencySeverity.DEFICIENCY,
            deficiencies_found="חוסר בתיעוד אישור מנהל על הפעולה.",
            compensating_control="קיים לוג מערכת אוטומטי המתעד את הפעולה ומאושר חודשית.",
            company_response="הוטמעה בקרה מפצה.",
        )
    elif status == TS.DEFICIENCY_CLOSED:
        base.update(
            results="הליקוי תוקן ונסגר לאחר בדיקה חוזרת.", effectiveness=ok,
            severity=DeficiencySeverity.DEFICIENCY,
            deficiencies_found="חוסר בתיעוד שתוקן.",
            company_response="התהליך תוקן והוטמע מחדש.",
            completed_at=NOW,
        )
    elif status == TS.NOT_RELEVANT:
        base.update(
            test_round=TestRound.NOT_REQUIRED,
            effectiveness=ControlEffectiveness.NOT_RELEVANT,
            results="הבקרה אינה רלוונטית לשנת הביקורת.",
        )
    elif status == TS.ROUND_B_PENDING:
        base.update(test_round=TestRound.ROUND_B, notes="ממתין לביצוע סבב ב'.")
    elif status == TS.NEEDS_ATTENTION:
        base.update(notes="נדרשת התייחסות היועץ לפני המשך הבדיקה.")
    elif status == TS.COMPANY_COMPLETION:
        base.update(due_date=date(2025, 9, 30), notes="הועבר לחברה להשלמת ראיות.")
    elif status == TS.ADDITIONAL_EVIDENCE:
        base.update(due_date=date(2025, 10, 15), notes="התבקשו ראיות נוספות מהחברה.")
    elif status == TS.PENDING_RECEIPT:
        base.update(due_date=date(2025, 8, 31), notes="ממתין לקבלת ראיות מהחברה.")
    elif status == TS.CONSULTANT_HANDLING:
        base.update(notes="בטיפול היועץ.")
    return base


# statuses that warrant attached evidence
_WITH_EVIDENCE = {
    TS.REVIEWED_APPROVED, TS.INTERNALLY_CLOSED, TS.DEFICIENCY_OPEN,
    TS.DEFICIENCY_COMPENSATED, TS.DEFICIENCY_CLOSED, TS.ADDITIONAL_EVIDENCE,
}


async def _build_control(
    db, tid, *, year, sub, rsel, psel, admin_id, spec
):
    """spec: dict with control fields + cstatus + tstatus."""
    validated = spec["cstatus"] == CS.VALIDATED
    ctrl = Control(
        tenant_id=tid, audit_year_id=year.id, subsidiary_id=sub.id,
        risk_selection_id=rsel.id, process_selection_id=psel.id,
        control_name=spec["name"],
        desired_description=spec.get("desired"),
        actual_description=spec.get("actual"),
        system_name=spec.get("system"),
        existing_code=spec.get("code"),
        purpose=spec["purpose"], control_type=spec["ctype"],
        frequency=spec["freq"], is_key_control=spec.get("key", False),
        owner_contact_id=spec.get("owner"),
        operator_contact_id=spec.get("operator"),
        status=spec["cstatus"],
        validated_at=NOW if validated else None,
        validated_by=admin_id if validated else None,
    )
    db.add(ctrl)
    await db.flush()

    tstatus = spec.get("tstatus")
    if tstatus is None:
        return ctrl, None
    test = ControlTest(
        tenant_id=tid, control_id=ctrl.id, audit_year_id=year.id,
        subsidiary_id=sub.id, status=tstatus, **_test_kwargs(tstatus),
    )
    db.add(test)
    await db.flush()
    if tstatus in _WITH_EVIDENCE:
        db.add(_evidence(tid, test.id, "evidence_main.pdf", notes="ראיה עיקרית"))
        if tstatus in (TS.REVIEWED_APPROVED, TS.DEFICIENCY_OPEN):
            db.add(_evidence(tid, test.id, "sample_data.xlsx", is_sample=True,
                             notes="קובץ מדגם"))
    return ctrl, test


async def build_client(db, tid, admin_id, spec: dict) -> bool:
    """Build a full chain for one client. Returns False if it already existed."""
    existing = (
        await db.execute(
            select(Client).where(Client.tenant_id == tid, Client.name == spec["name"])
        )
    ).scalar_one_or_none()
    if existing:
        print(f"  client '{spec['name']}' already exists; skipping.")
        return False

    client = Client(tenant_id=tid, name=spec["name"], **spec["fields"])
    db.add(client)
    await db.flush()

    # contacts
    contacts = {}
    for key, c in spec["contacts"].items():
        obj = Contact(tenant_id=tid, client_id=client.id, **c)
        db.add(obj)
        contacts[key] = obj
    await db.flush()

    # audit year
    year = AuditYear(
        tenant_id=tid, client_id=client.id, year=spec["year"],
        status=AuditYearStatus.OPEN,
    )
    db.add(year)
    await db.flush()

    # materiality
    for slot, (ptype, value, pct) in enumerate(spec["materiality"], start=1):
        db.add(MaterialityParameter(
            tenant_id=tid, audit_year_id=year.id, slot=slot, parameter_type=ptype,
            value=Decimal(value), percentage=Decimal(pct),
            computed_threshold=Decimal(value) * Decimal(pct),
        ))

    # subsidiaries (first is the "main" significant one everything hangs on)
    subs = []
    for s in spec["subsidiaries"]:
        approved = s.get("scope_approved", False)
        sub = Subsidiary(
            tenant_id=tid, client_id=client.id, audit_year_id=year.id,
            name=s["name"], qualitative_result=s["result"],
            in_scope_previous_year=s.get("prev", False),
            is_significant=s.get("significant", False),
            scope_approved=approved,
            scope_approved_by=admin_id if approved else None,
            scope_approved_at=NOW if approved else None,
        )
        db.add(sub)
        await db.flush()
        for q, a in s["answers"].items():
            db.add(SubsidiaryQualitativeAnswer(
                tenant_id=tid, subsidiary_id=sub.id, question_key=q, answer=a))
        subs.append(sub)
    main_sub = subs[0]

    # processes + selections (under main subsidiary)
    procs, psels = {}, {}
    for key, p in spec["processes"].items():
        proc = Process(
            tenant_id=tid, code=p["code"], name_he=p["name_he"],
            name_en=p.get("name_en"), category=p["category"],
        )
        db.add(proc)
        await db.flush()
        sel = ProcessSelection(
            tenant_id=tid, audit_year_id=year.id, subsidiary_id=main_sub.id,
            process_id=proc.id, is_in_scope=True, is_material=True,
        )
        db.add(sel)
        await db.flush()
        procs[key] = proc
        psels[key] = sel

    # risks + selections + controls + tests
    for r in spec["risks"]:
        risk = Risk(
            tenant_id=tid, code=r["code"], name_he=r["name_he"],
            description_he=r.get("desc"), classification=r["classification"],
        )
        db.add(risk)
        await db.flush()
        rsel = RiskSelection(
            tenant_id=tid, process_selection_id=psels[r["process"]].id,
            subsidiary_id=main_sub.id, audit_year_id=year.id, risk_id=risk.id,
            classification=r["classification"], description=r.get("desc"),
            **r.get("ratings", {}),
        )
        db.add(rsel)
        await db.flush()
        for cspec in r["controls"]:
            # resolve contact keys to ids
            cspec = dict(cspec)
            if cspec.get("owner"):
                cspec["owner"] = contacts[cspec["owner"]].id
            if cspec.get("operator"):
                cspec["operator"] = contacts[cspec["operator"]].id
            await _build_control(
                db, tid, year=year, sub=main_sub, rsel=rsel,
                psel=psels[r["process"]], admin_id=admin_id, spec=cspec,
            )

    # notifications (to admin) + outbox emails
    for n in spec.get("notifications", []):
        db.add(Notification(
            tenant_id=tid, recipient_user_id=admin_id, channel=NotificationChannel.IN_APP,
            event_type=n["event"], title=n["title"], body=n.get("body"),
            entity_type="control", read_at=NOW if n.get("read") else None,
        ))
    for em in spec.get("emails", []):
        db.add(EmailMessage(
            tenant_id=tid, to_email=contacts[em["to"]].email,
            subject=em["subject"], body=em["body"], status=em.get("status", "queued"),
            direction="outbound", related_entity_type="control_test",
            reviewed=em.get("reviewed", False),
        ))

    await db.commit()
    print(f"  built client '{spec['name']}' ({client.id}).")
    return True


# --------------------------------------------------------------------------- #
#  Full ratings used for business (non-ITGC) risks
# --------------------------------------------------------------------------- #
def _ratings(complexity, freq, prob, fin, rep, reg, inh, res):
    return dict(
        complexity=complexity, frequency=freq, inherent_probability=prob,
        financial_damage=fin, reputation=rep, regulation=reg,
        inherent_rating=inh, residual_rating=res,
    )


def _client_alpha(c) -> dict:
    """Industrial hi-tech client — showcases ALL control + test statuses."""
    return {
        "name": 'אלפא תעשיות בע"מ',
        "fields": dict(
            activity_description="פיתוח וייצור רכיבים אלקטרוניים, מכירה בארץ ובעולם.",
            industry="hitech", address="רחוב הברזל 12, תל אביב",
            is_public=True, regulations=["SOX", "ISOX"],
        ),
        "contacts": {
            "cfo": dict(full_name="שרה כהן", role_title="סמנכ\"לית כספים (CFO)",
                        email="sarah@alpha.example", phone="03-1234567"),
            "controller": dict(full_name="דוד לוי", role_title="חשב",
                               email="david@alpha.example", phone="03-1234568"),
            "it": dict(full_name="מיכל אברהם", role_title="מנהלת מערכות מידע",
                       email="michal@alpha.example", phone="03-1234569"),
            "audit": dict(full_name="יוסי מזרחי", role_title="מבקר פנים",
                          email="yossi@alpha.example", phone="03-1234570"),
        },
        "year": 2025,
        "materiality": [
            (MaterialityParameterType.NET_INCOME, 50_000_000, "0.05"),
            (MaterialityParameterType.SALES, 200_000_000, "0.01"),
            (MaterialityParameterType.ASSETS, 300_000_000, "0.005"),
        ],
        "subsidiaries": [
            {"name": "אלפא ישראל", "result": ScopeResult.PASS, "significant": True,
             "scope_approved": True, "prev": True, "answers": {
                 QQ.SEPARATE_LOCATION: True, QQ.SEPARATE_MANAGEMENT: True,
                 QQ.SEPARATE_SYSTEMS: True, QQ.UNIQUE_REPORTING_RISK: True,
                 QQ.FRAUD_OR_ERROR: False}},
            {"name": "אלפא אירופה", "result": ScopeResult.FAIL, "significant": False,
             "scope_approved": True, "answers": {
                 QQ.SEPARATE_LOCATION: True, QQ.SEPARATE_MANAGEMENT: False,
                 QQ.SEPARATE_SYSTEMS: False, QQ.UNIQUE_REPORTING_RISK: False,
                 QQ.FRAUD_OR_ERROR: False}},
        ],
        "processes": {
            "pur": dict(code="P-01", name_he="רכש ותשלומים",
                        name_en="Purchasing & Payments", category=ProcessCategory.BUSINESS),
            "rev": dict(code="P-02", name_he="הכנסות וגבייה",
                        name_en="Revenue & Collection", category=ProcessCategory.BUSINESS),
            "itgc": dict(code="ITGC-01", name_he="ניהול גישות",
                         name_en="Access Management", category=ProcessCategory.ITGC),
        },
        "risks": [
            {"code": "R-01", "name_he": "תשלום כפול לספק", "process": "pur",
             "classification": RiskClassification.FINANCIAL,
             "desc": "תשלום של אותה חשבונית פעמיים עקב כשל בקרה.",
             "ratings": _ratings(RiskComplexity.HIGH, RiskFrequency.MULTIPLE_MONTHLY,
                                  RiskProbability.MEDIUM, 4, 2, 3,
                                  RiskRating.HIGH, RiskRating.MEDIUM),
             "controls": [
                 dict(name="התאמת חשבונית להזמנת רכש וקבלה (3-way match)",
                      desired="כל תשלום מותנה בהתאמת חשבונית/הזמנה/תעודת קבלה.",
                      actual="מבוצע ב-ERP אוטומטית עם חסימת תשלום בחריגה.",
                      system="SAP", code="PUR-01",
                      purpose=ControlPurpose.PREVENTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.MONTHLY, key=True,
                      owner="cfo", operator="controller",
                      cstatus=CS.VALIDATED, tstatus=TS.REVIEWED_APPROVED),
                 dict(name="אישור תשלומים מעל סף סמכות",
                      desired="תשלומים מעל 50 אלף ₪ דורשים אישור CFO.",
                      system="SAP", code="PUR-02",
                      purpose=ControlPurpose.PREVENTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.MONTHLY, key=True,
                      owner="cfo", operator="controller",
                      cstatus=CS.VALIDATED, tstatus=TS.DEFICIENCY_OPEN),
                 dict(name="התאמת יתרות ספקים",
                      desired="התאמה רבעונית של כרטסות ספקים.",
                      purpose=ControlPurpose.DETECTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.QUARTERLY,
                      owner="controller", operator="controller",
                      cstatus=CS.VALIDATED, tstatus=TS.DEFICIENCY_COMPENSATED),
             ]},
            {"code": "R-02", "name_he": "הכרה שגויה בהכנסה", "process": "rev",
             "classification": RiskClassification.FINANCIAL,
             "desc": "הכרה בהכנסה לפני התקיימות תנאי ההכרה.",
             "ratings": _ratings(RiskComplexity.MEDIUM_HIGH, RiskFrequency.MULTIPLE_MONTHLY,
                                  RiskProbability.HIGH, 5, 3, 4,
                                  RiskRating.VERY_HIGH, RiskRating.HIGH),
             "controls": [
                 dict(name="סקירת הכרה בהכנסה ע\"י בקר",
                      desired="בקר סוקר חוזים והכרה בהכנסה מדי חודש.",
                      actual="מבוצע חודשית עם תיעוד בקובץ סקירה.",
                      purpose=ControlPurpose.DETECTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.MONTHLY, key=True,
                      owner="cfo", operator="controller",
                      cstatus=CS.VALIDATED, tstatus=TS.INTERNALLY_CLOSED),
                 dict(name="התאמת חשבוניות ללקוחות",
                      desired="התאמה חודשית בין חשבוניות לרישום הנהלת חשבונות.",
                      purpose=ControlPurpose.DETECTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.MONTHLY,
                      owner="controller", operator="controller",
                      cstatus=CS.VALIDATED, tstatus=TS.DEFICIENCY_CLOSED),
                 dict(name="בקרת זיכויים ללקוחות",
                      desired="זיכוי מעל סף דורש אישור נוסף.",
                      purpose=ControlPurpose.PREVENTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.MONTHLY,
                      owner="cfo", operator="controller",
                      cstatus=CS.NEEDS_VALIDATION, tstatus=None),
             ]},
            {"code": "R-04", "name_he": "גבייה לא נאותה וחובות אבודים", "process": "rev",
             "classification": RiskClassification.OPERATIONAL,
             "desc": "אי-גבייה וחשיפה לחובות אבודים.",
             "ratings": _ratings(RiskComplexity.MEDIUM, RiskFrequency.MULTIPLE_YEARLY,
                                  RiskProbability.MEDIUM, 3, 2, 2,
                                  RiskRating.MEDIUM, RiskRating.LOW),
             "controls": [
                 dict(name="מעקב חובות פתוחים וגיול",
                      desired="סקירת דוח גיול חודשית והתחקות אחר חובות.",
                      purpose=ControlPurpose.DETECTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.MONTHLY,
                      owner="controller", operator="controller",
                      cstatus=CS.VALIDATED, tstatus=TS.COMPANY_COMPLETION),
                 dict(name="הפרשה לחובות מסופקים",
                      desired="חישוב והפרשה שנתית לחומ\"ס לפי מדיניות.",
                      purpose=ControlPurpose.DIRECTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.ANNUAL,
                      owner="cfo", operator="controller",
                      cstatus=CS.VALIDATED, tstatus=TS.ADDITIONAL_EVIDENCE),
             ]},
            {"code": "R-03", "name_he": "גישה לא מורשית למערכות", "process": "itgc",
             "classification": RiskClassification.OPERATIONAL,
             "desc": "הרשאות עודפות / משתמשים שעזבו עם גישה פעילה.",
             "controls": [
                 dict(name="סקירת הרשאות משתמשים רבעונית",
                      desired="סקירה רבעונית של הרשאות במערכת ה-ERP.",
                      system="SAP", code="ITGC-01",
                      purpose=ControlPurpose.PREVENTIVE, ctype=ControlType.AUTOMATIC,
                      freq=ControlFrequency.QUARTERLY, key=True,
                      owner="it", operator="it",
                      cstatus=CS.VALIDATED, tstatus=TS.PENDING_RECEIPT),
                 dict(name="מדיניות סיסמאות ונעילת חשבון",
                      desired="אכיפת מורכבות סיסמה ונעילה לאחר 5 כשלונות.",
                      purpose=ControlPurpose.PREVENTIVE, ctype=ControlType.AUTOMATIC,
                      freq=ControlFrequency.ONGOING,
                      owner="it", operator="it",
                      cstatus=CS.VALIDATED, tstatus=TS.CONSULTANT_HANDLING),
                 dict(name="הסרת גישה לעובדים שעזבו",
                      desired="ביטול גישה ביום סיום ההעסקה.",
                      purpose=ControlPurpose.PREVENTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.ONGOING,
                      owner="it", operator="it",
                      cstatus=CS.VALIDATED, tstatus=TS.NEEDS_ATTENTION),
                 dict(name="בקרת שינויי תוכנה (Change Management)",
                      desired="כל שינוי לפרודקשן דורש אישור ובדיקה.",
                      purpose=ControlPurpose.DETECTIVE, ctype=ControlType.HYBRID,
                      freq=ControlFrequency.ONGOING,
                      owner="it", operator="it",
                      cstatus=CS.VALIDATED, tstatus=TS.ROUND_B_PENDING),
                 dict(name="גיבוי ושחזור נתונים",
                      desired="גיבוי יומי ובדיקת שחזור תקופתית.",
                      purpose=ControlPurpose.DIRECTIVE, ctype=ControlType.AUTOMATIC,
                      freq=ControlFrequency.ONGOING,
                      owner="it", operator="it",
                      cstatus=CS.VALIDATED, tstatus=TS.NOT_RELEVANT),
                 dict(name="הפרדת סביבות פיתוח/ייצור",
                      desired="הפרדה מלאה בין סביבת פיתוח לייצור.",
                      purpose=ControlPurpose.PREVENTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.ONGOING,
                      owner="it", operator="it",
                      cstatus=CS.DRAFT, tstatus=None),
                 dict(name="ניטור לוגים ואירועי אבטחה",
                      desired="ריכוז לוגים וסקירת אירועים חריגים.",
                      purpose=ControlPurpose.DETECTIVE, ctype=ControlType.AUTOMATIC,
                      freq=ControlFrequency.ONGOING,
                      owner="it", operator="it",
                      cstatus=CS.NEEDS_FIX, tstatus=None),
             ]},
        ],
        "notifications": [
            dict(event="control_needs_validation", title="בקרה ממתינה לתיקוף",
                 body="הבקרה 'בקרת זיכויים ללקוחות' ממתינה לתיקוף.", read=False),
            dict(event="deficiency_opened", title="נפתח ליקוי מהותי",
                 body="נפתח ליקוי מהותי בבקרת אישור תשלומים מעל סף.", read=False),
            dict(event="test_approved", title="טסט אושר",
                 body="הטסט עבור '3-way match' אושר.", read=True),
        ],
        "emails": [
            dict(to="controller", subject="בקשה לתיקוף בקרה — בקרת זיכויים",
                 body="שלום, נא לתקף את הבקרה 'בקרת זיכויים ללקוחות'.",
                 status="queued", reviewed=False),
            dict(to="it", subject="בקשת ראיות — סקירת הרשאות רבעונית",
                 body="שלום, נא להעביר את דוח ההרשאות לרבעון האחרון.",
                 status="sent", reviewed=True),
        ],
    }


def _client_north(c) -> dict:
    """Financial / banking client — a second full chain with a different profile."""
    return {
        "name": 'בנק הצפון בע"מ',
        "fields": dict(
            activity_description="בנקאות קמעונאית ומסחרית, אשראי ופעילות נוסטרו.",
            industry="banking", address="שדרות רוטשילד 1, תל אביב",
            is_public=True, regulations=["SOX"],
        ),
        "contacts": {
            "cfo": dict(full_name="רונית בר", role_title="סמנכ\"לית כספים",
                        email="ronit@northbank.example", phone="03-7654321"),
            "risk": dict(full_name="אבי נחום", role_title="מנהל סיכונים",
                         email="avi@northbank.example", phone="03-7654322"),
            "ops": dict(full_name="גלית שרון", role_title="מנהלת תפעול אשראי",
                        email="galit@northbank.example", phone="03-7654323"),
            "it": dict(full_name="עומר דגן", role_title="מנהל אבטחת מידע",
                       email="omer@northbank.example", phone="03-7654324"),
        },
        "year": 2025,
        "materiality": [
            (MaterialityParameterType.PRETAX_INCOME, 800_000_000, "0.05"),
            (MaterialityParameterType.EQUITY, 5_000_000_000, "0.01"),
            (MaterialityParameterType.ASSETS, 60_000_000_000, "0.005"),
        ],
        "subsidiaries": [
            {"name": "בנק הצפון — מטה", "result": ScopeResult.PASS, "significant": True,
             "scope_approved": True, "prev": True, "answers": {
                 QQ.SEPARATE_LOCATION: True, QQ.SEPARATE_MANAGEMENT: True,
                 QQ.SEPARATE_SYSTEMS: True, QQ.UNIQUE_REPORTING_RISK: True,
                 QQ.FRAUD_OR_ERROR: True}},
            {"name": "חברת כרטיסי אשראי בת", "result": ScopeResult.FAIL,
             "significant": False, "scope_approved": True, "answers": {
                 QQ.SEPARATE_LOCATION: False, QQ.SEPARATE_MANAGEMENT: True,
                 QQ.SEPARATE_SYSTEMS: False, QQ.UNIQUE_REPORTING_RISK: False,
                 QQ.FRAUD_OR_ERROR: False}},
        ],
        "processes": {
            "credit": dict(code="P-10", name_he="אשראי והלוואות",
                           name_en="Credit & Loans", category=ProcessCategory.BUSINESS),
            "nostro": dict(code="P-11", name_he="נוסטרו והשקעות",
                           name_en="Nostro & Investments", category=ProcessCategory.BUSINESS),
            "itgc": dict(code="ITGC-10", name_he="ניהול גישות ושינויים",
                         name_en="Access & Change Mgmt", category=ProcessCategory.ITGC),
        },
        "risks": [
            {"code": "BR-01", "name_he": "אישור אשראי בחריגה מסמכות", "process": "credit",
             "classification": RiskClassification.FINANCIAL,
             "desc": "מתן אשראי מעבר לסמכות המאשר.",
             "ratings": _ratings(RiskComplexity.HIGH, RiskFrequency.DAILY,
                                  RiskProbability.HIGH, 5, 4, 5,
                                  RiskRating.VERY_HIGH, RiskRating.MEDIUM),
             "controls": [
                 dict(name="בקרת מסגרות וסמכויות אשראי",
                      desired="כל אשראי נבדק מול מטריצת סמכויות לפני אישור.",
                      actual="נאכף במערכת האשראי עם חסימה אוטומטית.",
                      system="Core Banking", code="CR-01",
                      purpose=ControlPurpose.PREVENTIVE, ctype=ControlType.AUTOMATIC,
                      freq=ControlFrequency.ONGOING, key=True,
                      owner="risk", operator="ops",
                      cstatus=CS.VALIDATED, tstatus=TS.REVIEWED_APPROVED),
                 dict(name="סקירת חריגות אשראי שבועית",
                      desired="סקירת דוח חריגות אשראי ע\"י מנהל סיכונים.",
                      purpose=ControlPurpose.DETECTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.MONTHLY, key=True,
                      owner="risk", operator="ops",
                      cstatus=CS.VALIDATED, tstatus=TS.DEFICIENCY_OPEN),
             ]},
            {"code": "BR-02", "name_he": "טעות בשערוך תיק נוסטרו", "process": "nostro",
             "classification": RiskClassification.FINANCIAL,
             "desc": "שערוך שגוי של ניירות ערך בתיק.",
             "ratings": _ratings(RiskComplexity.MEDIUM_HIGH, RiskFrequency.DAILY,
                                  RiskProbability.MEDIUM, 4, 3, 4,
                                  RiskRating.HIGH, RiskRating.MEDIUM),
             "controls": [
                 dict(name="התאמת נוסטרו יומית",
                      desired="התאמה יומית בין רישומי הבנק לבנק מתכתב.",
                      actual="מבוצע יומית עם דוח פערים.",
                      system="Treasury", code="NO-01",
                      purpose=ControlPurpose.DETECTIVE, ctype=ControlType.AUTOMATIC,
                      freq=ControlFrequency.ONGOING, key=True,
                      owner="cfo", operator="ops",
                      cstatus=CS.VALIDATED, tstatus=TS.INTERNALLY_CLOSED),
                 dict(name="אישור עסקאות מעל סף",
                      desired="עסקאות מעל סף דורשות אישור דאבל.",
                      purpose=ControlPurpose.PREVENTIVE, ctype=ControlType.MANUAL,
                      freq=ControlFrequency.ONGOING,
                      owner="cfo", operator="ops",
                      cstatus=CS.NEEDS_VALIDATION, tstatus=None),
             ]},
            {"code": "BR-03", "name_he": "גישה לא מורשית למערכות הליבה", "process": "itgc",
             "classification": RiskClassification.OPERATIONAL,
             "desc": "הרשאות עודפות במערכות הליבה הבנקאיות.",
             "controls": [
                 dict(name="סקירת הרשאות במערכת הליבה",
                      desired="סקירה רבעונית של הרשאות גישה למערכת הליבה.",
                      system="Core Banking", code="ITGC-10",
                      purpose=ControlPurpose.PREVENTIVE, ctype=ControlType.AUTOMATIC,
                      freq=ControlFrequency.QUARTERLY, key=True,
                      owner="it", operator="it",
                      cstatus=CS.VALIDATED, tstatus=TS.COMPANY_COMPLETION),
                 dict(name="בקרת שינויים למערכות הליבה",
                      desired="כל שינוי דורש אישור, בדיקה והפרדת תפקידים.",
                      purpose=ControlPurpose.DETECTIVE, ctype=ControlType.HYBRID,
                      freq=ControlFrequency.ONGOING, key=True,
                      owner="it", operator="it",
                      cstatus=CS.VALIDATED, tstatus=TS.DEFICIENCY_CLOSED),
             ]},
        ],
        "notifications": [
            dict(event="deficiency_opened", title="ליקוי מהותי באשראי",
                 body="נפתח ליקוי בסקירת חריגות אשראי.", read=False),
            dict(event="scope_approved", title="סקופ אושר",
                 body="סקופ חברת הבת 'מטה' אושר.", read=True),
        ],
        "emails": [
            dict(to="ops", subject="בקשת ראיות — סקירת הרשאות מערכת הליבה",
                 body="נא להעביר את דוח ההרשאות הרבעוני של מערכת הליבה.",
                 status="queued", reviewed=False),
        ],
    }


async def seed() -> None:
    async with SessionLocal() as db:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.subdomain == DEMO_SUBDOMAIN))
        ).scalar_one_or_none()
        if not tenant:
            print(f"Demo tenant '{DEMO_SUBDOMAIN}' not found — run bootstrap first.")
            return
        await set_tenant(db, str(tenant.id))
        tid = tenant.id

        admin = (
            await db.execute(
                select(User).where(User.tenant_id == tid, User.role == UserRole.ADMIN)
            )
        ).scalars().first()
        if not admin:
            print("No admin user found — run bootstrap first.")
            return

        # extra demo users (idempotent)
        for email, name, role, subrole in [
            ("consultant@demo.com", "יועץ דמו", UserRole.CONSULTANT, None),
            ("client@demo.com", "לקוח דמו", UserRole.CLIENT, ClientSubrole.CONTROL_OWNER),
        ]:
            exists = (
                await db.execute(
                    select(User).where(User.tenant_id == tid, User.email == email)
                )
            ).scalar_one_or_none()
            if not exists:
                db.add(User(
                    tenant_id=tid, email=email, full_name=name, role=role,
                    client_subrole=subrole, auth_provider=AuthProvider.LOCAL,
                    hashed_password=hash_password(DEMO_PASSWORD),
                ))
        await db.commit()

        print("Seeding demo clients...")
        for builder in (_client_alpha, _client_north):
            await build_client(db, tid, admin.id, builder(None))
        print("Done.")


if __name__ == "__main__":
    asyncio.run(seed())
