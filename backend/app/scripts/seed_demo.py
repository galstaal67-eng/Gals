"""Seed one fully-populated demo client under the demo tenant.

Idempotent: if the demo client already exists it does nothing. Run after the
tenant bootstrap (entrypoint does both):

    python -m app.scripts.seed_demo

Creates a realistic end-to-end tree so the UI shows real data:
client → contacts → audit year → materiality → subsidiaries (+ qualitative
answers) → process selections → risk selections (full ratings) → controls
(owner/operator, statuses) → tests (statuses, severity, evidence).
"""

import asyncio
from decimal import Decimal

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal, set_tenant
from app.models.audit_year import AuditYear
from app.models.client import Client
from app.models.contact import Contact
from app.models.control import Control
from app.models.control_test import ControlTest, Evidence
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
from app.models.process import Process
from app.models.process_selection import ProcessSelection
from app.models.risk import Risk, RiskSelection
from app.models.subsidiary import Subsidiary, SubsidiaryQualitativeAnswer
from app.models.tenant import Tenant
from app.models.user import User

DEMO_SUBDOMAIN = "demo"
DEMO_CLIENT_NAME = 'אלפא תעשיות בע"מ'
DEMO_PASSWORD = "Demo12345!"


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

        existing = (
            await db.execute(
                select(Client).where(
                    Client.tenant_id == tid, Client.name == DEMO_CLIENT_NAME
                )
            )
        ).scalar_one_or_none()
        if existing:
            print(f"Demo client already exists ({existing.id}); nothing to do.")
            return

        # ---- extra demo users (consultant + client owner) ----
        for email, name, role, subrole in [
            ("consultant@demo.com", "יועץ דמו", UserRole.CONSULTANT, None),
            ("client@demo.com", "לקוח דמו", UserRole.CLIENT, ClientSubrole.CONTROL_OWNER),
        ]:
            already = (
                await db.execute(
                    select(User).where(User.tenant_id == tid, User.email == email)
                )
            ).scalar_one_or_none()
            if not already:
                db.add(
                    User(
                        tenant_id=tid,
                        email=email,
                        full_name=name,
                        role=role,
                        client_subrole=subrole,
                        auth_provider=AuthProvider.LOCAL,
                        hashed_password=hash_password(DEMO_PASSWORD),
                    )
                )

        # ---- client ----
        client = Client(
            tenant_id=tid,
            name=DEMO_CLIENT_NAME,
            activity_description="פיתוח וייצור רכיבים אלקטרוניים, מכירה בארץ ובעולם.",
            industry="hitech",
            address="רחוב הברזל 12, תל אביב",
            is_public=True,
            regulations=["SOX", "ISOX"],
        )
        db.add(client)
        await db.flush()

        # ---- contacts ----
        contacts = {
            "cfo": Contact(
                tenant_id=tid, client_id=client.id, full_name="שרה כהן",
                role_title="סמנכ\"לית כספים (CFO)", email="sarah@alpha.example",
                phone="03-1234567",
            ),
            "controller": Contact(
                tenant_id=tid, client_id=client.id, full_name="דוד לוי",
                role_title="חשב (Controller)", email="david@alpha.example",
                phone="03-1234568",
            ),
            "it": Contact(
                tenant_id=tid, client_id=client.id, full_name="מיכל אברהם",
                role_title="מנהלת מערכות מידע", email="michal@alpha.example",
                phone="03-1234569",
            ),
            "audit": Contact(
                tenant_id=tid, client_id=client.id, full_name="יוסי מזרחי",
                role_title="מבקר פנים", email="yossi@alpha.example",
                phone="03-1234570",
            ),
        }
        db.add_all(contacts.values())
        await db.flush()

        # ---- audit year ----
        year = AuditYear(
            tenant_id=tid, client_id=client.id, year=2025, status=AuditYearStatus.OPEN
        )
        db.add(year)
        await db.flush()

        # ---- materiality (3 slots; threshold = value * percentage) ----
        for slot, ptype, value, pct in [
            (1, MaterialityParameterType.NET_INCOME, 50_000_000, Decimal("0.05")),
            (2, MaterialityParameterType.SALES, 200_000_000, Decimal("0.01")),
            (3, MaterialityParameterType.ASSETS, 300_000_000, Decimal("0.005")),
        ]:
            db.add(
                MaterialityParameter(
                    tenant_id=tid, audit_year_id=year.id, slot=slot,
                    parameter_type=ptype, value=Decimal(value), percentage=pct,
                    computed_threshold=Decimal(value) * pct,
                )
            )

        # ---- subsidiaries ----
        sub_main = Subsidiary(
            tenant_id=tid, client_id=client.id, audit_year_id=year.id,
            name="אלפא ישראל", qualitative_result=ScopeResult.PASS,
            in_scope_previous_year=True, is_significant=True, scope_approved=True,
        )
        sub_eu = Subsidiary(
            tenant_id=tid, client_id=client.id, audit_year_id=year.id,
            name="אלפא אירופה", qualitative_result=ScopeResult.FAIL,
            is_significant=False, scope_approved=True,
        )
        db.add_all([sub_main, sub_eu])
        await db.flush()

        # qualitative answers: main = 4 yes (significant), eu = 1 yes
        main_answers = {
            QualitativeQuestion.SEPARATE_LOCATION: True,
            QualitativeQuestion.SEPARATE_MANAGEMENT: True,
            QualitativeQuestion.SEPARATE_SYSTEMS: True,
            QualitativeQuestion.UNIQUE_REPORTING_RISK: True,
            QualitativeQuestion.FRAUD_OR_ERROR: False,
        }
        eu_answers = {
            QualitativeQuestion.SEPARATE_LOCATION: True,
            QualitativeQuestion.SEPARATE_MANAGEMENT: False,
            QualitativeQuestion.SEPARATE_SYSTEMS: False,
            QualitativeQuestion.UNIQUE_REPORTING_RISK: False,
            QualitativeQuestion.FRAUD_OR_ERROR: False,
        }
        for sub, answers in [(sub_main, main_answers), (sub_eu, eu_answers)]:
            for q, a in answers.items():
                db.add(
                    SubsidiaryQualitativeAnswer(
                        tenant_id=tid, subsidiary_id=sub.id, question_key=q, answer=a
                    )
                )

        # ---- process bank (tenant-scoped) ----
        proc_purchasing = Process(
            tenant_id=tid, code="P-01", name_he="רכש ותשלומים",
            name_en="Purchasing & Payments", category=ProcessCategory.BUSINESS,
        )
        proc_revenue = Process(
            tenant_id=tid, code="P-02", name_he="הכנסות וגבייה",
            name_en="Revenue & Collection", category=ProcessCategory.BUSINESS,
        )
        proc_access = Process(
            tenant_id=tid, code="ITGC-01", name_he="ניהול גישות",
            name_en="Access Management", category=ProcessCategory.ITGC,
        )
        db.add_all([proc_purchasing, proc_revenue, proc_access])
        await db.flush()

        # ---- process selections (under the significant subsidiary) ----
        psel = {}
        for key, proc, material in [
            ("purchasing", proc_purchasing, True),
            ("revenue", proc_revenue, True),
            ("access", proc_access, True),
        ]:
            sel = ProcessSelection(
                tenant_id=tid, audit_year_id=year.id, subsidiary_id=sub_main.id,
                process_id=proc.id, is_in_scope=True, is_material=material,
            )
            db.add(sel)
            psel[key] = sel
        await db.flush()

        # ---- risk bank + selections ----
        risk_double_pay = Risk(
            tenant_id=tid, code="R-01", name_he="תשלום כפול לספק",
            description_he="תשלום של אותה חשבונית פעמיים עקב כשל בקרה.",
            classification=RiskClassification.FINANCIAL,
        )
        risk_revenue = Risk(
            tenant_id=tid, code="R-02", name_he="הכרה שגויה בהכנסה",
            description_he="הכרה בהכנסה לפני התקיימות תנאי ההכרה.",
            classification=RiskClassification.FINANCIAL,
        )
        risk_access = Risk(
            tenant_id=tid, code="R-03", name_he="גישה לא מורשית למערכות",
            description_he="הרשאות עודפות / משתמשים שעזבו עם גישה פעילה.",
            classification=RiskClassification.OPERATIONAL,
        )
        db.add_all([risk_double_pay, risk_revenue, risk_access])
        await db.flush()

        rsel_pay = RiskSelection(
            tenant_id=tid, process_selection_id=psel["purchasing"].id,
            subsidiary_id=sub_main.id, audit_year_id=year.id, risk_id=risk_double_pay.id,
            classification=RiskClassification.FINANCIAL, complexity=RiskComplexity.HIGH,
            frequency=RiskFrequency.MULTIPLE_MONTHLY,
            inherent_probability=RiskProbability.MEDIUM,
            financial_damage=4, reputation=2, regulation=3,
            inherent_rating=RiskRating.HIGH, residual_rating=RiskRating.MEDIUM,
            description="סיכון מהותי לתשלומי יתר; ממותן ע\"י התאמת 3 מסמכים.",
        )
        rsel_rev = RiskSelection(
            tenant_id=tid, process_selection_id=psel["revenue"].id,
            subsidiary_id=sub_main.id, audit_year_id=year.id, risk_id=risk_revenue.id,
            classification=RiskClassification.FINANCIAL,
            complexity=RiskComplexity.MEDIUM_HIGH,
            frequency=RiskFrequency.MULTIPLE_MONTHLY,
            inherent_probability=RiskProbability.HIGH,
            financial_damage=5, reputation=3, regulation=4,
            inherent_rating=RiskRating.VERY_HIGH, residual_rating=RiskRating.HIGH,
            description="חשיפה לדיווח כספי שגוי; בקרה מגלה חודשית.",
        )
        # ITGC risk — rating fields left empty per ITGC convention
        rsel_acc = RiskSelection(
            tenant_id=tid, process_selection_id=psel["access"].id,
            subsidiary_id=sub_main.id, audit_year_id=year.id, risk_id=risk_access.id,
            classification=RiskClassification.OPERATIONAL,
            description="בקרת ITGC — סקירת הרשאות תקופתית.",
        )
        db.add_all([rsel_pay, rsel_rev, rsel_acc])
        await db.flush()

        # ---- controls ----
        ctrl_3way = Control(
            tenant_id=tid, audit_year_id=year.id, subsidiary_id=sub_main.id,
            risk_selection_id=rsel_pay.id, process_selection_id=psel["purchasing"].id,
            control_name="התאמת חשבונית להזמנת רכש וקבלה (3-way match)",
            desired_description="כל תשלום מותנה בהתאמת חשבונית/הזמנה/תעודת קבלה.",
            purpose=ControlPurpose.PREVENTIVE, control_type=ControlType.MANUAL,
            frequency=ControlFrequency.MONTHLY, is_key_control=True,
            owner_contact_id=contacts["cfo"].id,
            operator_contact_id=contacts["controller"].id,
            status=ControlStatus.VALIDATED,
        )
        ctrl_rev = Control(
            tenant_id=tid, audit_year_id=year.id, subsidiary_id=sub_main.id,
            risk_selection_id=rsel_rev.id, process_selection_id=psel["revenue"].id,
            control_name="סקירת הכרה בהכנסה ע\"י בקר",
            desired_description="בקר סוקר חוזים והכרה בהכנסה מדי חודש.",
            purpose=ControlPurpose.DETECTIVE, control_type=ControlType.MANUAL,
            frequency=ControlFrequency.MONTHLY, is_key_control=True,
            owner_contact_id=contacts["cfo"].id,
            operator_contact_id=contacts["controller"].id,
            status=ControlStatus.NEEDS_VALIDATION,
        )
        ctrl_acc = Control(
            tenant_id=tid, audit_year_id=year.id, subsidiary_id=sub_main.id,
            risk_selection_id=rsel_acc.id, process_selection_id=psel["access"].id,
            control_name="סקירת הרשאות משתמשים רבעונית",
            desired_description="סקירה רבעונית של הרשאות במערכת ה-ERP.",
            purpose=ControlPurpose.PREVENTIVE, control_type=ControlType.AUTOMATIC,
            frequency=ControlFrequency.QUARTERLY, is_key_control=True,
            owner_contact_id=contacts["it"].id,
            operator_contact_id=contacts["it"].id,
            status=ControlStatus.VALIDATED,
        )
        db.add_all([ctrl_3way, ctrl_rev, ctrl_acc])
        await db.flush()

        # ---- tests (only for validated controls) ----
        test_3way = ControlTest(
            tenant_id=tid, control_id=ctrl_3way.id, audit_year_id=year.id,
            subsidiary_id=sub_main.id, test_round=TestRound.ROUND_A,
            required_evidence=["דגימת 25 חשבוניות", "צילום מסך התאמה ב-ERP"],
            test_method="בחירת מדגם של 25 תשלומים ובדיקת קיום 3-way match.",
            results="כל הפריטים נמצאו תקינים.",
            status=TestStatus.REVIEWED_APPROVED,
            effectiveness=ControlEffectiveness.EFFECTIVE,
        )
        test_access = ControlTest(
            tenant_id=tid, control_id=ctrl_acc.id, audit_year_id=year.id,
            subsidiary_id=sub_main.id, test_round=TestRound.ROUND_A,
            required_evidence=["דוח הרשאות רבעוני", "אישור מנהל"],
            test_method="בדיקת ביצוע סקירת ההרשאות בכל רבעון.",
            status=TestStatus.DEFICIENCY_OPEN,
            severity=DeficiencySeverity.MATERIAL_DEFICIENCY,
            deficiencies_found="ברבעון Q2 לא בוצעה סקירת הרשאות.",
            compensating_control="לוג ניטור גישות חודשי קיים.",
        )
        db.add_all([test_3way, test_access])
        await db.flush()

        # ---- evidence (replace-not-delete model; SHA-256 hashes) ----
        db.add_all(
            [
                Evidence(
                    tenant_id=tid, test_id=test_3way.id,
                    filename="invoices_sample_Q1.xlsx",
                    file_hash="a" * 64, file_size=20480, is_sample=True,
                    notes="מדגם חשבוניות רבעון 1",
                ),
                Evidence(
                    tenant_id=tid, test_id=test_3way.id,
                    filename="erp_match_screenshot.png",
                    file_hash="b" * 64, file_size=51200, is_sample=False,
                ),
                Evidence(
                    tenant_id=tid, test_id=test_access.id,
                    filename="access_review_Q1.pdf",
                    file_hash="c" * 64, file_size=102400, is_sample=False,
                ),
            ]
        )

        await db.commit()
        print(
            f"Seeded demo client '{DEMO_CLIENT_NAME}' ({client.id}) "
            f"with contacts, audit year 2025, materiality, 2 subsidiaries, "
            f"3 processes/risks/controls and 2 tests."
        )


if __name__ == "__main__":
    asyncio.run(seed())
