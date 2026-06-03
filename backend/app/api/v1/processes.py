import csv
import io
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.audit import record_audit
from app.core.rbac import Permission
from app.models.audit_year import AuditYear
from app.models.enums import AuditAction, AuditYearStatus, ProcessCategory
from app.models.process import Process, SubActivity
from app.models.process_selection import ProcessSelection
from app.models.subsidiary import Subsidiary
from app.schemas.process import (
    ProcessBankCreate,
    ProcessBankOut,
    ProcessSelectionCreate,
    ProcessSelectionOut,
    ProcessSelectionUpdate,
    SubActivityCreate,
    SubActivityOut,
)

router = APIRouter(tags=["processes"])


def _visible_bank(user: CurrentUser):
    """Bank rows visible to a tenant: global catalog + tenant overrides (Q6)."""
    return or_(Process.is_global.is_(True), Process.tenant_id == user.tenant_id)


async def _get_bank_process(db: AsyncSession, user: CurrentUser, pid: uuid.UUID) -> Process:
    proc = (
        await db.execute(
            select(Process).where(
                Process.id == pid, _visible_bank(user), Process.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if not proc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "process not found in bank")
    return proc


# --------------------------------------------------------------- bank (catalog)

@router.get("/processes/bank", response_model=list[ProcessBankOut])
async def list_bank(
    category: ProcessCategory | None = None,
    user: CurrentUser = Depends(require(Permission.PROCESS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Process).where(_visible_bank(user), Process.deleted_at.is_(None))
    if category:
        stmt = stmt.where(Process.category == category)
    return (await db.execute(stmt.order_by(Process.name_he))).scalars().all()


@router.post("/processes/bank", response_model=ProcessBankOut, status_code=status.HTTP_201_CREATED)
async def create_bank_process(
    body: ProcessBankCreate,
    user: CurrentUser = Depends(require(Permission.PROCESS_BANK_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    """Inject a single process into the tenant's bank (when not in the catalog)."""
    proc = Process(
        tenant_id=user.tenant_id,
        code=body.code,
        name_he=body.name_he,
        name_en=body.name_en,
        category=body.category,
        is_global=False,
    )
    db.add(proc)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="process",
        entity_id=proc.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"name_he": body.name_he, "category": body.category.value},
    )
    await db.commit()
    await db.refresh(proc)
    return proc


@router.post("/processes/bank/import-csv", response_model=dict)
async def import_bank_csv(
    file: UploadFile,
    user: CurrentUser = Depends(require(Permission.PROCESS_BANK_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    """Import processes + sub-activities from CSV.

    Columns: category, name_he, name_en, code, sub_activities (';'-separated).
    """
    raw = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))
    created_processes = 0
    created_subs = 0
    for row in reader:
        name_he = (row.get("name_he") or "").strip()
        category = (row.get("category") or "").strip().lower()
        if not name_he or category not in (c.value for c in ProcessCategory):
            continue
        proc = Process(
            tenant_id=user.tenant_id,
            code=(row.get("code") or "").strip() or None,
            name_he=name_he,
            name_en=(row.get("name_en") or "").strip() or None,
            category=ProcessCategory(category),
            is_global=False,
        )
        db.add(proc)
        await db.flush()
        created_processes += 1
        for sub in (row.get("sub_activities") or "").split(";"):
            sub = sub.strip()
            if sub:
                db.add(
                    SubActivity(
                        tenant_id=user.tenant_id, process_id=proc.id, name_he=sub, is_global=False
                    )
                )
                created_subs += 1
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="process_bank_import",
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"processes": created_processes, "sub_activities": created_subs},
    )
    await db.commit()
    return {"processes": created_processes, "sub_activities": created_subs}


@router.get("/processes/bank/{pid}/sub-activities", response_model=list[SubActivityOut])
async def list_sub_activities(
    pid: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.PROCESS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    await _get_bank_process(db, user, pid)
    rows = (
        await db.execute(
            select(SubActivity).where(
                SubActivity.process_id == pid, SubActivity.deleted_at.is_(None)
            )
        )
    ).scalars().all()
    return rows


@router.post(
    "/processes/bank/{pid}/sub-activities",
    response_model=SubActivityOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_sub_activity(
    pid: uuid.UUID,
    body: SubActivityCreate,
    user: CurrentUser = Depends(require(Permission.PROCESS_BANK_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    await _get_bank_process(db, user, pid)
    sub = SubActivity(
        tenant_id=user.tenant_id,
        process_id=pid,
        name_he=body.name_he,
        name_en=body.name_en,
        is_global=False,
    )
    db.add(sub)
    await db.flush()
    await db.commit()
    await db.refresh(sub)
    return sub


# ----------------------------------------------------- instances (selections)

async def _open_subsidiary(
    db: AsyncSession, user: CurrentUser, year_id: uuid.UUID, sub_id: uuid.UUID
) -> Subsidiary:
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
    return sub


@router.get(
    "/audit-years/{year_id}/subsidiaries/{sub_id}/process-selections",
    response_model=list[ProcessSelectionOut],
)
async def list_selections(
    year_id: uuid.UUID,
    sub_id: uuid.UUID,
    category: ProcessCategory | None = None,
    user: CurrentUser = Depends(require(Permission.PROCESS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(ProcessSelection)
        .where(
            ProcessSelection.audit_year_id == year_id,
            ProcessSelection.subsidiary_id == sub_id,
            ProcessSelection.tenant_id == user.tenant_id,
            ProcessSelection.deleted_at.is_(None),
        )
    )
    if category:
        stmt = stmt.join(Process, Process.id == ProcessSelection.process_id).where(
            Process.category == category
        )
    return (await db.execute(stmt)).scalars().all()


@router.post(
    "/audit-years/{year_id}/subsidiaries/{sub_id}/process-selections",
    response_model=ProcessSelectionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_selection(
    year_id: uuid.UUID,
    sub_id: uuid.UUID,
    body: ProcessSelectionCreate,
    user: CurrentUser = Depends(require(Permission.PROCESS_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    await _open_subsidiary(db, user, year_id, sub_id)
    proc = await _get_bank_process(db, user, body.process_id)
    if body.itgc_layer is not None and proc.category != ProcessCategory.ITGC:
        raise HTTPException(422, "itgc_layer only for ITGC")

    sel = ProcessSelection(
        tenant_id=user.tenant_id,
        audit_year_id=year_id,
        subsidiary_id=sub_id,
        process_id=body.process_id,
        sub_activity_id=body.sub_activity_id,
        itgc_layer=body.itgc_layer,
        is_material=body.is_material,
    )
    db.add(sel)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="process_selection",
        entity_id=sel.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"process_id": str(body.process_id)},
    )
    await db.commit()
    await db.refresh(sel)
    return sel


@router.patch("/process-selections/{sel_id}", response_model=ProcessSelectionOut)
async def update_selection(
    sel_id: uuid.UUID,
    body: ProcessSelectionUpdate,
    user: CurrentUser = Depends(require(Permission.PROCESS_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    sel = (
        await db.execute(
            select(ProcessSelection).where(
                ProcessSelection.id == sel_id,
                ProcessSelection.tenant_id == user.tenant_id,
                ProcessSelection.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not sel:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "selection not found")
    await _open_subsidiary(db, user, sel.audit_year_id, sel.subsidiary_id)
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(sel, key, value)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="process_selection",
        entity_id=sel.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={k: (v.value if hasattr(v, "value") else v) for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(sel)
    return sel


@router.delete("/process-selections/{sel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_selection(
    sel_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.PROCESS_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    sel = (
        await db.execute(
            select(ProcessSelection).where(
                ProcessSelection.id == sel_id,
                ProcessSelection.tenant_id == user.tenant_id,
                ProcessSelection.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not sel:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "selection not found")
    await _open_subsidiary(db, user, sel.audit_year_id, sel.subsidiary_id)
    sel.deleted_at = datetime.now(UTC)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.DELETE,
        entity_type="process_selection",
        entity_id=sel.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
    )
    await db.commit()
