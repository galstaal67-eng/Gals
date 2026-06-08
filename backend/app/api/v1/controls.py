import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.audit import record_audit
from app.core.email import queue_email, render_validation_request
from app.core.rbac import Permission
from app.core.state_machine import can_transition
from app.models.audit_year import AuditYear
from app.models.contact import Contact
from app.models.control import Control, ControlBank
from app.models.control_test import ControlTest
from app.models.enums import AuditAction, AuditYearStatus, ControlStatus, UserRole
from app.models.process import Process
from app.models.process_selection import ProcessSelection
from app.models.risk import Risk, RiskSelection
from app.models.subsidiary import Subsidiary
from app.models.user import User
from app.schemas.control import (
    ControlBankCreate,
    ControlBankOut,
    ControlCreate,
    ControlImportRequest,
    ControlOut,
    ControlTransition,
    ControlUpdate,
)
from app.schemas.email_message import EmailMessageOut, RequestValidationIn
from app.scripts.seed_catalog import sync_catalog

router = APIRouter(tags=["controls"])


def _visible_bank(user: CurrentUser):
    return or_(ControlBank.is_global.is_(True), ControlBank.tenant_id == user.tenant_id)


async def _ensure_year_open(db: AsyncSession, user: CurrentUser, year_id: uuid.UUID) -> None:
    year = (
        await db.execute(
            select(AuditYear).where(
                AuditYear.id == year_id, AuditYear.tenant_id == user.tenant_id
            )
        )
    ).scalar_one_or_none()
    if not year:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "audit year not found")
    if year.status != AuditYearStatus.OPEN:
        raise HTTPException(status.HTTP_409_CONFLICT, "audit year is locked")


async def _ensure_test_row(db: AsyncSession, user: CurrentUser, ctrl: Control) -> None:
    """A validated control surfaces a test row in the tests tab (SPEC §טסטים)."""
    existing = (
        await db.execute(
            select(ControlTest.id).where(
                ControlTest.control_id == ctrl.id, ControlTest.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if existing:
        return
    db.add(
        ControlTest(
            tenant_id=user.tenant_id,
            control_id=ctrl.id,
            audit_year_id=ctrl.audit_year_id,
            subsidiary_id=ctrl.subsidiary_id,
        )
    )


async def _get_control(db: AsyncSession, user: CurrentUser, cid: uuid.UUID) -> Control:
    ctrl = (
        await db.execute(
            select(Control).where(
                Control.id == cid,
                Control.tenant_id == user.tenant_id,
                Control.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not ctrl:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "control not found")
    return ctrl


# ------------------------------------------------------------------ catalog sync

@router.post("/catalog/sync", response_model=dict)
async def sync_global_catalog(
    user: CurrentUser = Depends(require(Permission.CONTROL_BANK_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    """Populate/refresh the global RCM catalog (processes/risks/control_bank)
    from the bundled data file — lets an admin seed a running instance without
    redeploying. Idempotent sync (add/update/soft-delete)."""
    counts = await sync_catalog(db)
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="catalog_sync",
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={k: v for k, v in counts.items() if v},
    )
    await db.commit()
    return counts


# ------------------------------------------------------------------ bank

@router.get("/controls/bank", response_model=list[ControlBankOut])
async def list_bank(
    process_id: uuid.UUID | None = None,
    user: CurrentUser = Depends(require(Permission.CONTROL_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ControlBank).where(_visible_bank(user), ControlBank.deleted_at.is_(None))
    if process_id is not None:
        stmt = stmt.where(ControlBank.process_id == process_id)
    rows = (await db.execute(stmt.order_by(ControlBank.code, ControlBank.name_he))).scalars().all()
    return rows


@router.post("/controls/bank", response_model=ControlBankOut, status_code=status.HTTP_201_CREATED)
async def create_bank_control(
    body: ControlBankCreate,
    user: CurrentUser = Depends(require(Permission.CONTROL_BANK_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    item = ControlBank(
        tenant_id=user.tenant_id,
        code=body.code,
        name_he=body.name_he,
        desired_description=body.desired_description,
        is_global=False,
    )
    db.add(item)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="control_bank",
        entity_id=item.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"name_he": body.name_he},
    )
    await db.commit()
    await db.refresh(item)
    return item


# ------------------------------------------------------------- instances

@router.get("/risk-selections/{rsel_id}/controls", response_model=list[ControlOut])
async def list_controls(
    rsel_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.CONTROL_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Control).where(
                Control.risk_selection_id == rsel_id,
                Control.tenant_id == user.tenant_id,
                Control.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    return rows


@router.post(
    "/risk-selections/{rsel_id}/controls",
    response_model=ControlOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_control(
    rsel_id: uuid.UUID,
    body: ControlCreate,
    user: CurrentUser = Depends(require(Permission.CONTROL_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    rsel = (
        await db.execute(
            select(RiskSelection).where(
                RiskSelection.id == rsel_id,
                RiskSelection.tenant_id == user.tenant_id,
                RiskSelection.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not rsel:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "risk selection not found")
    await _ensure_year_open(db, user, rsel.audit_year_id)

    ctrl = Control(
        tenant_id=user.tenant_id,
        audit_year_id=rsel.audit_year_id,
        subsidiary_id=rsel.subsidiary_id,
        risk_selection_id=rsel.id,
        process_selection_id=rsel.process_selection_id,
        status=ControlStatus.DRAFT,
        **body.model_dump(),
    )
    db.add(ctrl)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="control",
        entity_id=ctrl.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"control_name": body.control_name},
    )
    await db.commit()
    await db.refresh(ctrl)
    return ctrl


@router.post(
    "/audit-years/{year_id}/subsidiaries/{sub_id}/import-control",
    response_model=ControlOut,
    status_code=status.HTTP_201_CREATED,
)
async def import_control_from_catalog(
    year_id: uuid.UUID,
    sub_id: uuid.UUID,
    body: ControlImportRequest,
    user: CurrentUser = Depends(require(Permission.CONTROL_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    """ייבוא בקרה מהקטלוג אל חברה־בת בשנת ביקורת.

    בונה את כל השרשרת כשהיא חסרה — בחירת תהליך ← בחירת סיכון ← מופע בקרה —
    ומעתיק את ברירות המחדל מהקטלוג (סוג/תדירות/מטרה/בקרת מפתח) לבקרה החדשה.
    """
    await _ensure_year_open(db, user, year_id)
    sub = (
        await db.execute(
            select(Subsidiary).where(
                Subsidiary.id == sub_id,
                Subsidiary.audit_year_id == year_id,
                Subsidiary.tenant_id == user.tenant_id,
                Subsidiary.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not sub:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "subsidiary not found")

    bank = (
        await db.execute(
            select(ControlBank).where(
                ControlBank.id == body.control_bank_id,
                _visible_bank(user),
                ControlBank.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not bank:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "control not found in catalog")
    if bank.process_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "catalog control has no process")

    # Ensure the bank process is itself visible (global or tenant) — guards against
    # importing a control whose process belongs to another tenant.
    proc = (
        await db.execute(
            select(Process).where(
                Process.id == bank.process_id,
                or_(Process.is_global.is_(True), Process.tenant_id == user.tenant_id),
                Process.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not proc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "process not found in bank")

    # 1) process selection — find or create.
    psel = (
        await db.execute(
            select(ProcessSelection).where(
                ProcessSelection.audit_year_id == year_id,
                ProcessSelection.subsidiary_id == sub_id,
                ProcessSelection.process_id == bank.process_id,
                ProcessSelection.tenant_id == user.tenant_id,
                ProcessSelection.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not psel:
        psel = ProcessSelection(
            tenant_id=user.tenant_id,
            audit_year_id=year_id,
            subsidiary_id=sub_id,
            process_id=bank.process_id,
        )
        db.add(psel)
        await db.flush()

    # 2) risk (find global/tenant, else create tenant copy) + risk selection.
    risk_name = bank.risk_description or bank.name_he
    risk = (
        await db.execute(
            select(Risk).where(
                Risk.name_he == risk_name,
                or_(Risk.is_global.is_(True), Risk.tenant_id == user.tenant_id),
                Risk.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if not risk:
        risk = Risk(tenant_id=user.tenant_id, name_he=risk_name, is_global=False)
        db.add(risk)
        await db.flush()

    rsel = (
        await db.execute(
            select(RiskSelection).where(
                RiskSelection.process_selection_id == psel.id,
                RiskSelection.risk_id == risk.id,
                RiskSelection.tenant_id == user.tenant_id,
                RiskSelection.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not rsel:
        rsel = RiskSelection(
            tenant_id=user.tenant_id,
            process_selection_id=psel.id,
            subsidiary_id=sub_id,
            audit_year_id=year_id,
            risk_id=risk.id,
        )
        db.add(rsel)
        await db.flush()

    # 3) control instance — copy catalog defaults.
    ctrl = Control(
        tenant_id=user.tenant_id,
        audit_year_id=year_id,
        subsidiary_id=sub_id,
        risk_selection_id=rsel.id,
        process_selection_id=psel.id,
        control_bank_id=bank.id,
        existing_code=bank.code,
        control_name=bank.name_he,
        desired_description=bank.desired_description,
        purpose=bank.default_purpose,
        control_type=bank.default_type,
        frequency=bank.default_frequency,
        is_key_control=bank.is_key_default,
        status=ControlStatus.DRAFT,
    )
    db.add(ctrl)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="control",
        entity_id=ctrl.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"imported_from_bank": str(bank.id), "control_name": bank.name_he},
    )
    await db.commit()
    await db.refresh(ctrl)
    return ctrl


@router.patch("/controls/{cid}", response_model=ControlOut)
async def update_control(
    cid: uuid.UUID,
    body: ControlUpdate,
    user: CurrentUser = Depends(require(Permission.CONTROL_EDIT)),
    db: AsyncSession = Depends(get_db),
):
    ctrl = await _get_control(db, user, cid)
    await _ensure_year_open(db, user, ctrl.audit_year_id)
    changes = body.model_dump(exclude_unset=True)

    # Validated controls are locked except for manager+ (SPEC).
    manager_roles = (UserRole.ADMIN, UserRole.MANAGER)
    if ctrl.status == ControlStatus.VALIDATED and user.role not in manager_roles:
        raise HTTPException(status.HTTP_409_CONFLICT, "validated control is locked")

    # In needs_validation only the actual description may change; doing so sends
    # the control back to needs_fix (SPEC).
    if ctrl.status == ControlStatus.NEEDS_VALIDATION:
        if set(changes) - {"actual_description"}:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "only actual_description editable pending validation"
            )
        if "actual_description" in changes:
            ctrl.status = ControlStatus.NEEDS_FIX

    for key, value in changes.items():
        setattr(ctrl, key, value)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="control",
        entity_id=ctrl.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={k: (v.value if hasattr(v, "value") else v) for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(ctrl)
    return ctrl


@router.post("/controls/{cid}/transition", response_model=ControlOut)
async def transition_control(
    cid: uuid.UUID,
    body: ControlTransition,
    user: CurrentUser = Depends(require(Permission.CONTROL_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    ctrl = await _get_control(db, user, cid)
    await _ensure_year_open(db, user, ctrl.audit_year_id)

    if not can_transition(ctrl.status, body.target_state, user.role):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"illegal transition {ctrl.status.value} -> {body.target_state.value}",
        )

    before = ctrl.status
    ctrl.status = body.target_state
    if body.target_state == ControlStatus.VALIDATED:
        ctrl.validated_at = datetime.now(UTC)
        ctrl.validated_by = user.id
        await _ensure_test_row(db, user, ctrl)
    elif body.target_state == ControlStatus.DRAFT:
        ctrl.validated_at = None
        ctrl.validated_by = None

    await db.flush()
    await record_audit(
        db,
        action=AuditAction.APPROVE
        if body.target_state == ControlStatus.VALIDATED
        else AuditAction.UPDATE,
        entity_type="control",
        entity_id=ctrl.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        before={"status": before.value},
        after={"status": body.target_state.value, "reason": body.reason},
    )
    await db.commit()
    await db.refresh(ctrl)
    return ctrl


@router.delete("/controls/{cid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_control(
    cid: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.CONTROL_EDIT)),
    db: AsyncSession = Depends(get_db),
):
    ctrl = await _get_control(db, user, cid)
    await _ensure_year_open(db, user, ctrl.audit_year_id)
    ctrl.deleted_at = datetime.now(UTC)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.DELETE,
        entity_type="control",
        entity_id=ctrl.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
    )
    await db.commit()


async def _owner_email(
    db: AsyncSession, user: CurrentUser, contact_id: uuid.UUID | None
) -> Contact:
    if contact_id is None:
        raise HTTPException(422, "control has no owner contact to email")
    contact = (
        await db.execute(
            select(Contact).where(
                Contact.id == contact_id, Contact.tenant_id == user.tenant_id
            )
        )
    ).scalar_one_or_none()
    if not contact or not contact.email:
        raise HTTPException(422, "owner contact has no email")
    return contact


@router.post("/controls/{cid}/request-validation", response_model=EmailMessageOut)
async def request_validation(
    cid: uuid.UUID,
    body: RequestValidationIn,
    user: CurrentUser = Depends(require(Permission.CONTROL_EDIT)),
    db: AsyncSession = Depends(get_db),
):
    """Move a control to needs_validation and queue the תיקוף email to the owner."""
    ctrl = await _get_control(db, user, cid)
    await _ensure_year_open(db, user, ctrl.audit_year_id)
    if not can_transition(ctrl.status, ControlStatus.NEEDS_VALIDATION, user.role):
        raise HTTPException(status.HTTP_409_CONFLICT, "control cannot move to needs_validation")

    contact = await _owner_email(db, user, ctrl.owner_contact_id)
    year = (
        await db.execute(select(AuditYear).where(AuditYear.id == ctrl.audit_year_id))
    ).scalar_one()
    sender = await db.get(User, user.id)

    rendered = render_validation_request(
        client_name=contact.full_name,
        audit_year=year.year,
        consultant_name=sender.full_name if sender else "",
        controls=[
            {
                "system": ctrl.system_name,
                "control_name": ctrl.control_name,
                "code": ctrl.existing_code or ctrl.new_code,
                "frequency": ctrl.frequency.value if ctrl.frequency else None,
            }
        ],
    )
    msg = await queue_email(
        db,
        tenant_id=user.tenant_id,
        to_email=contact.email,
        cc_email=body.cc_email,
        rendered=rendered,
        related_entity_type="control",
        related_entity_id=ctrl.id,
        sent_by_user_id=user.id,
    )
    ctrl.status = ControlStatus.NEEDS_VALIDATION
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="control",
        entity_id=ctrl.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"status": "needs_validation", "email_queued": str(msg.id)},
    )
    await db.commit()
    await db.refresh(msg)
    return msg
