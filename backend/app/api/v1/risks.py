import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.audit import record_audit
from app.core.rbac import Permission
from app.models.audit_year import AuditYear
from app.models.enums import AuditAction, AuditYearStatus, ProcessCategory
from app.models.process import Process
from app.models.process_selection import ProcessSelection
from app.models.risk import Risk, RiskSelection
from app.schemas.risk import (
    RiskBankCreate,
    RiskBankOut,
    RiskSelectionCreate,
    RiskSelectionOut,
    RiskSelectionUpdate,
)

router = APIRouter(tags=["risks"])

# Rating fields only apply to non-ITGC processes (SPEC §סיכונים).
RATING_FIELDS = (
    "complexity",
    "frequency",
    "inherent_probability",
    "financial_damage",
    "reputation",
    "regulation",
    "inherent_rating",
    "residual_rating",
)


def _visible_bank(user: CurrentUser):
    return or_(Risk.is_global.is_(True), Risk.tenant_id == user.tenant_id)


# ------------------------------------------------------------------- bank

@router.get("/risks/bank", response_model=list[RiskBankOut])
async def list_bank(
    user: CurrentUser = Depends(require(Permission.RISK_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Risk)
            .where(_visible_bank(user), Risk.deleted_at.is_(None))
            .order_by(Risk.name_he)
        )
    ).scalars().all()
    return rows


@router.post("/risks/bank", response_model=RiskBankOut, status_code=status.HTTP_201_CREATED)
async def create_bank_risk(
    body: RiskBankCreate,
    user: CurrentUser = Depends(require(Permission.RISK_BANK_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    risk = Risk(
        tenant_id=user.tenant_id,
        code=body.code,
        name_he=body.name_he,
        description_he=body.description_he,
        description_en=body.description_en,
        classification=body.classification,
        is_global=False,
    )
    db.add(risk)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="risk",
        entity_id=risk.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"name_he": body.name_he},
    )
    await db.commit()
    await db.refresh(risk)
    return risk


# ------------------------------------------------------------- instances

async def _open_selection(
    db: AsyncSession, user: CurrentUser, psel_id: uuid.UUID
) -> tuple[ProcessSelection, bool]:
    """Return the process selection and whether its bank process is ITGC."""
    psel = (
        await db.execute(
            select(ProcessSelection).where(
                ProcessSelection.id == psel_id,
                ProcessSelection.tenant_id == user.tenant_id,
                ProcessSelection.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not psel:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "process selection not found")

    year = (
        await db.execute(select(AuditYear).where(AuditYear.id == psel.audit_year_id))
    ).scalar_one_or_none()
    if not year or year.status != AuditYearStatus.OPEN:
        raise HTTPException(status.HTTP_409_CONFLICT, "audit year is locked")

    category = (
        await db.execute(select(Process.category).where(Process.id == psel.process_id))
    ).scalar_one_or_none()
    return psel, category == ProcessCategory.ITGC


@router.get(
    "/process-selections/{psel_id}/risks", response_model=list[RiskSelectionOut]
)
async def list_risk_selections(
    psel_id: uuid.UUID,
    step_id: uuid.UUID | None = None,
    user: CurrentUser = Depends(require(Permission.RISK_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(RiskSelection).where(
        RiskSelection.process_selection_id == psel_id,
        RiskSelection.tenant_id == user.tenant_id,
        RiskSelection.deleted_at.is_(None),
    )
    if step_id is not None:
        stmt = stmt.where(RiskSelection.process_step_id == step_id)
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.post(
    "/process-selections/{psel_id}/risks",
    response_model=RiskSelectionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_risk_selection(
    psel_id: uuid.UUID,
    body: RiskSelectionCreate,
    user: CurrentUser = Depends(require(Permission.RISK_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    psel, is_itgc = await _open_selection(db, user, psel_id)

    risk = (
        await db.execute(
            select(Risk).where(Risk.id == body.risk_id, _visible_bank(user))
        )
    ).scalar_one_or_none()
    if not risk:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "risk not found in bank")

    data = body.model_dump()
    if is_itgc:
        # rating fields are not applicable to ITGC — drop them.
        for f in RATING_FIELDS:
            data[f] = None

    sel = RiskSelection(
        tenant_id=user.tenant_id,
        process_selection_id=psel_id,
        subsidiary_id=psel.subsidiary_id,
        audit_year_id=psel.audit_year_id,
        **data,
    )
    db.add(sel)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="risk_selection",
        entity_id=sel.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"risk_id": str(body.risk_id)},
    )
    await db.commit()
    await db.refresh(sel)
    return sel


@router.patch("/risk-selections/{sel_id}", response_model=RiskSelectionOut)
async def update_risk_selection(
    sel_id: uuid.UUID,
    body: RiskSelectionUpdate,
    user: CurrentUser = Depends(require(Permission.RISK_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    sel = (
        await db.execute(
            select(RiskSelection).where(
                RiskSelection.id == sel_id,
                RiskSelection.tenant_id == user.tenant_id,
                RiskSelection.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not sel:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "risk selection not found")
    _, is_itgc = await _open_selection(db, user, sel.process_selection_id)

    changes = body.model_dump(exclude_unset=True)
    if is_itgc:
        changes = {k: v for k, v in changes.items() if k not in RATING_FIELDS}
    for key, value in changes.items():
        setattr(sel, key, value)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="risk_selection",
        entity_id=sel.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={k: (v.value if hasattr(v, "value") else v) for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(sel)
    return sel


@router.delete("/risk-selections/{sel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_risk_selection(
    sel_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.RISK_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    sel = (
        await db.execute(
            select(RiskSelection).where(
                RiskSelection.id == sel_id,
                RiskSelection.tenant_id == user.tenant_id,
                RiskSelection.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not sel:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "risk selection not found")
    await _open_selection(db, user, sel.process_selection_id)
    sel.deleted_at = datetime.now(UTC)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.DELETE,
        entity_type="risk_selection",
        entity_id=sel.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
    )
    await db.commit()
