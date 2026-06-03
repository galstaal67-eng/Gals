import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.audit import record_audit
from app.core.rbac import Permission
from app.models.audit_year import AuditYear
from app.models.client import Client
from app.models.enums import AuditAction, AuditYearStatus
from app.models.materiality import MaterialityParameter
from app.schemas.audit_year import AuditYearCreate, AuditYearOut
from app.schemas.materiality import (
    MaterialityParameterCreate,
    MaterialityParameterOut,
    MaterialityParameterUpdate,
)

router = APIRouter(tags=["audit-years"])


async def _get_year(db: AsyncSession, tenant_id: uuid.UUID, year_id: uuid.UUID) -> AuditYear:
    year = (
        await db.execute(
            select(AuditYear).where(
                AuditYear.id == year_id,
                AuditYear.tenant_id == tenant_id,
                AuditYear.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not year:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "audit year not found")
    return year


def _ensure_open(year: AuditYear) -> None:
    if year.status != AuditYearStatus.OPEN:
        raise HTTPException(status.HTTP_409_CONFLICT, "audit year is locked")


# ---------------------------------------------------------------- audit years

@router.get("/clients/{client_id}/audit-years", response_model=list[AuditYearOut])
async def list_audit_years(
    client_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.AUDIT_YEAR_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(AuditYear)
            .where(
                AuditYear.client_id == client_id,
                AuditYear.tenant_id == user.tenant_id,
                AuditYear.deleted_at.is_(None),
            )
            .order_by(AuditYear.year.desc())
        )
    ).scalars().all()
    return rows


@router.post(
    "/clients/{client_id}/audit-years",
    response_model=AuditYearOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_audit_year(
    client_id: uuid.UUID,
    body: AuditYearCreate,
    user: CurrentUser = Depends(require(Permission.AUDIT_YEAR_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    client = (
        await db.execute(
            select(Client).where(
                Client.id == client_id,
                Client.tenant_id == user.tenant_id,
                Client.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not client:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")

    dupe = (
        await db.execute(
            select(AuditYear.id).where(
                AuditYear.client_id == client_id,
                AuditYear.year == body.year,
                AuditYear.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if dupe:
        raise HTTPException(status.HTTP_409_CONFLICT, "audit year already exists")

    year = AuditYear(tenant_id=user.tenant_id, client_id=client_id, year=body.year)
    db.add(year)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="audit_year",
        entity_id=year.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"year": body.year},
    )
    await db.commit()
    await db.refresh(year)
    return year


@router.post("/audit-years/{year_id}/lock", response_model=AuditYearOut)
async def lock_audit_year(
    year_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.AUDIT_YEAR_LOCK)),
    db: AsyncSession = Depends(get_db),
):
    year = await _get_year(db, user.tenant_id, year_id)
    year.status = AuditYearStatus.LOCKED
    year.locked_at = datetime.now(UTC)
    year.locked_by = user.id
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="audit_year",
        entity_id=year.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"status": "locked"},
    )
    await db.commit()
    await db.refresh(year)
    return year


@router.post("/audit-years/{year_id}/clone-from-previous", response_model=AuditYearOut)
async def clone_from_previous(
    year_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.AUDIT_YEAR_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    """Copy year-level materiality parameters from the most recent prior year."""
    year = await _get_year(db, user.tenant_id, year_id)
    _ensure_open(year)

    prev = (
        await db.execute(
            select(AuditYear)
            .where(
                AuditYear.client_id == year.client_id,
                AuditYear.tenant_id == user.tenant_id,
                AuditYear.year < year.year,
                AuditYear.deleted_at.is_(None),
            )
            .order_by(AuditYear.year.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not prev:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no previous year to clone from")

    prev_params = (
        await db.execute(
            select(MaterialityParameter).where(
                MaterialityParameter.audit_year_id == prev.id,
                MaterialityParameter.subsidiary_id.is_(None),
            )
        )
    ).scalars().all()
    for p in prev_params:
        db.add(
            MaterialityParameter(
                tenant_id=user.tenant_id,
                audit_year_id=year.id,
                subsidiary_id=None,
                slot=p.slot,
                parameter_type=p.parameter_type,
                value=p.value,
                percentage=p.percentage,
                computed_threshold=p.computed_threshold,
            )
        )
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="audit_year",
        entity_id=year.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"cloned_from": prev.year, "params": len(prev_params)},
    )
    await db.commit()
    await db.refresh(year)
    return year


# -------------------------------------------------------- materiality params

@router.get(
    "/audit-years/{year_id}/materiality-parameters",
    response_model=list[MaterialityParameterOut],
)
async def list_materiality(
    year_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.AUDIT_YEAR_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    await _get_year(db, user.tenant_id, year_id)
    rows = (
        await db.execute(
            select(MaterialityParameter)
            .where(MaterialityParameter.audit_year_id == year_id)
            .order_by(MaterialityParameter.slot)
        )
    ).scalars().all()
    return rows


@router.post(
    "/audit-years/{year_id}/materiality-parameters",
    response_model=MaterialityParameterOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_materiality(
    year_id: uuid.UUID,
    body: MaterialityParameterCreate,
    user: CurrentUser = Depends(require(Permission.AUDIT_YEAR_EDIT)),
    db: AsyncSession = Depends(get_db),
):
    year = await _get_year(db, user.tenant_id, year_id)
    _ensure_open(year)

    # A parameter_type may not repeat at the same level within a year (SPEC).
    clash = (
        await db.execute(
            select(MaterialityParameter.id).where(
                MaterialityParameter.audit_year_id == year_id,
                MaterialityParameter.subsidiary_id.is_(body.subsidiary_id),
                MaterialityParameter.parameter_type == body.parameter_type,
            )
        )
    ).scalar_one_or_none()
    if clash:
        raise HTTPException(status.HTTP_409_CONFLICT, "parameter type already used for this year")

    computed = Decimal(body.value) * Decimal(body.percentage)
    param = MaterialityParameter(
        tenant_id=user.tenant_id,
        audit_year_id=year_id,
        subsidiary_id=body.subsidiary_id,
        slot=body.slot,
        parameter_type=body.parameter_type,
        value=body.value,
        percentage=body.percentage,
        computed_threshold=computed,
    )
    db.add(param)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="materiality_parameter",
        entity_id=param.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"slot": body.slot, "parameter_type": body.parameter_type.value},
    )
    await db.commit()
    await db.refresh(param)
    return param


@router.patch(
    "/materiality-parameters/{param_id}", response_model=MaterialityParameterOut
)
async def update_materiality(
    param_id: uuid.UUID,
    body: MaterialityParameterUpdate,
    user: CurrentUser = Depends(require(Permission.AUDIT_YEAR_EDIT)),
    db: AsyncSession = Depends(get_db),
):
    param = (
        await db.execute(
            select(MaterialityParameter).where(
                MaterialityParameter.id == param_id,
                MaterialityParameter.tenant_id == user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not param:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "parameter not found")

    year = await _get_year(db, user.tenant_id, param.audit_year_id)
    _ensure_open(year)

    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(param, key, value)
    # recompute threshold = value * percentage
    param.computed_threshold = Decimal(param.value) * Decimal(param.percentage)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="materiality_parameter",
        entity_id=param.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={k: str(v) for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(param)
    return param
