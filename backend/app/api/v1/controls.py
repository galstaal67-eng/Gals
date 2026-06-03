import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.audit import record_audit
from app.core.rbac import Permission
from app.core.state_machine import can_transition
from app.models.audit_year import AuditYear
from app.models.control import Control, ControlBank
from app.models.enums import AuditAction, AuditYearStatus, ControlStatus, UserRole
from app.models.risk import RiskSelection
from app.schemas.control import (
    ControlBankCreate,
    ControlBankOut,
    ControlCreate,
    ControlOut,
    ControlTransition,
    ControlUpdate,
)

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


# ------------------------------------------------------------------ bank

@router.get("/controls/bank", response_model=list[ControlBankOut])
async def list_bank(
    user: CurrentUser = Depends(require(Permission.CONTROL_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(ControlBank)
            .where(_visible_bank(user), ControlBank.deleted_at.is_(None))
            .order_by(ControlBank.name_he)
        )
    ).scalars().all()
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
