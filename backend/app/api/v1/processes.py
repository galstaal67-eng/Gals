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
from app.models.control import Control
from app.models.control_test import ControlTest
from app.models.enums import AuditAction, AuditYearStatus, ProcessCategory
from app.models.process import Process, SubActivity
from app.models.process_selection import ProcessSelection, ProcessStep
from app.models.risk import RiskSelection
from app.models.subsidiary import Subsidiary
from app.schemas.process import (
    ProcessBankCreate,
    ProcessBankOut,
    ProcessFlowOut,
    ProcessSelectionCreate,
    ProcessSelectionOut,
    ProcessSelectionUpdate,
    ProcessStepCreate,
    ProcessStepOut,
    ProcessStepReorder,
    ProcessStepUpdate,
    StepFlowOut,
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
            select(SubActivity)
            .where(SubActivity.process_id == pid, SubActivity.deleted_at.is_(None))
            .order_by(SubActivity.order_index, SubActivity.created_at)
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
    existing = (
        await db.execute(
            select(SubActivity.order_index).where(
                SubActivity.process_id == pid, SubActivity.deleted_at.is_(None)
            )
        )
    ).scalars().all()
    sub = SubActivity(
        tenant_id=user.tenant_id,
        process_id=pid,
        name_he=body.name_he,
        name_en=body.name_en,
        order_index=(max(existing) + 1) if existing else 0,
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

    # Seed the flow diagram from the catalog's flow steps (sub_activities).
    await _seed_steps_from_catalog(db, user, sel, body.process_id)

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


async def _seed_steps_from_catalog(
    db: AsyncSession, user: CurrentUser, sel: ProcessSelection, process_id: uuid.UUID
) -> None:
    """Copy the bank process flow steps (sub_activities) into instance steps."""
    subs = (
        await db.execute(
            select(SubActivity)
            .where(SubActivity.process_id == process_id, SubActivity.deleted_at.is_(None))
            .order_by(SubActivity.order_index, SubActivity.created_at, SubActivity.id)
        )
    ).scalars().all()
    for i, sub in enumerate(subs):
        db.add(
            ProcessStep(
                tenant_id=user.tenant_id,
                audit_year_id=sel.audit_year_id,
                subsidiary_id=sel.subsidiary_id,
                process_selection_id=sel.id,
                name_he=sub.name_he,
                order_index=i,
                source_sub_activity_id=sub.id,
            )
        )


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


# ----------------------------------------------------- flow-diagram steps

async def _get_selection(
    db: AsyncSession, user: CurrentUser, psel_id: uuid.UUID
) -> ProcessSelection:
    sel = (
        await db.execute(
            select(ProcessSelection).where(
                ProcessSelection.id == psel_id,
                ProcessSelection.tenant_id == user.tenant_id,
                ProcessSelection.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not sel:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "process selection not found")
    return sel


async def _get_step(db: AsyncSession, user: CurrentUser, step_id: uuid.UUID) -> ProcessStep:
    step = (
        await db.execute(
            select(ProcessStep).where(
                ProcessStep.id == step_id,
                ProcessStep.tenant_id == user.tenant_id,
                ProcessStep.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not step:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "step not found")
    return step


@router.get("/process-selections/{psel_id}/steps", response_model=list[ProcessStepOut])
async def list_steps(
    psel_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.PROCESS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    await _get_selection(db, user, psel_id)
    rows = (
        await db.execute(
            select(ProcessStep)
            .where(
                ProcessStep.process_selection_id == psel_id,
                ProcessStep.deleted_at.is_(None),
            )
            .order_by(ProcessStep.order_index, ProcessStep.created_at)
        )
    ).scalars().all()
    return rows


@router.post(
    "/process-selections/{psel_id}/steps",
    response_model=ProcessStepOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_step(
    psel_id: uuid.UUID,
    body: ProcessStepCreate,
    user: CurrentUser = Depends(require(Permission.PROCESS_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    sel = await _get_selection(db, user, psel_id)
    await _open_subsidiary(db, user, sel.audit_year_id, sel.subsidiary_id)
    order = body.order_index
    if order is None:
        existing = (
            await db.execute(
                select(ProcessStep.order_index).where(
                    ProcessStep.process_selection_id == psel_id,
                    ProcessStep.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        order = (max(existing) + 1) if existing else 0
    step = ProcessStep(
        tenant_id=user.tenant_id,
        audit_year_id=sel.audit_year_id,
        subsidiary_id=sel.subsidiary_id,
        process_selection_id=psel_id,
        name_he=body.name_he,
        order_index=order,
    )
    db.add(step)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="process_step",
        entity_id=step.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"name_he": body.name_he},
    )
    await db.commit()
    await db.refresh(step)
    return step


@router.patch("/process-steps/{step_id}", response_model=ProcessStepOut)
async def update_step(
    step_id: uuid.UUID,
    body: ProcessStepUpdate,
    user: CurrentUser = Depends(require(Permission.PROCESS_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    step = await _get_step(db, user, step_id)
    await _open_subsidiary(db, user, step.audit_year_id, step.subsidiary_id)
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(step, key, value)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="process_step",
        entity_id=step.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after=changes,
    )
    await db.commit()
    await db.refresh(step)
    return step


@router.post("/process-selections/{psel_id}/steps/reorder", response_model=list[ProcessStepOut])
async def reorder_steps(
    psel_id: uuid.UUID,
    body: ProcessStepReorder,
    user: CurrentUser = Depends(require(Permission.PROCESS_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    sel = await _get_selection(db, user, psel_id)
    await _open_subsidiary(db, user, sel.audit_year_id, sel.subsidiary_id)
    steps = (
        await db.execute(
            select(ProcessStep).where(
                ProcessStep.process_selection_id == psel_id,
                ProcessStep.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    by_id = {s.id: s for s in steps}
    for i, sid in enumerate(body.step_ids):
        if sid in by_id:
            by_id[sid].order_index = i
    await db.flush()
    await db.commit()
    return sorted(steps, key=lambda s: s.order_index)


@router.delete("/process-steps/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_step(
    step_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.PROCESS_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    step = await _get_step(db, user, step_id)
    await _open_subsidiary(db, user, step.audit_year_id, step.subsidiary_id)
    # Detach risks from the deleted step (keep them, just unassigned).
    detach = (
        await db.execute(
            select(RiskSelection).where(
                RiskSelection.process_step_id == step_id,
                RiskSelection.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    for r in detach:
        r.process_step_id = None
    step.deleted_at = datetime.now(UTC)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.DELETE,
        entity_type="process_step",
        entity_id=step.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
    )
    await db.commit()


# Test-status buckets for the flow diagram.
_PASSED = {"reviewed_approved", "internally_closed", "deficiency_closed", "not_relevant"}
_FAILED = {"deficiency_open"}
_PENDING = {"pending_receipt", "round_b_pending"}


def _step_status(controls: int, passed: int, failed: int, total: int) -> str:
    if controls == 0:
        return "empty"
    if failed > 0:
        return "failed"
    if total > 0 and passed == total:
        return "passed"
    return "in_progress"


@router.get("/process-selections/{psel_id}/flow", response_model=ProcessFlowOut)
async def process_flow(
    psel_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.PROCESS_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    """Aggregate each step's risks/controls/tests into a status for the diagram."""
    await _get_selection(db, user, psel_id)
    steps = (
        await db.execute(
            select(ProcessStep)
            .where(
                ProcessStep.process_selection_id == psel_id,
                ProcessStep.deleted_at.is_(None),
            )
            .order_by(ProcessStep.order_index, ProcessStep.created_at)
        )
    ).scalars().all()

    # risks per step
    risks = (
        await db.execute(
            select(RiskSelection).where(
                RiskSelection.process_selection_id == psel_id,
                RiskSelection.tenant_id == user.tenant_id,
                RiskSelection.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    risk_to_step = {r.id: r.process_step_id for r in risks}
    risks_per_step: dict[uuid.UUID, int] = {}
    for r in risks:
        if r.process_step_id:
            risks_per_step[r.process_step_id] = risks_per_step.get(r.process_step_id, 0) + 1

    # controls per risk-selection
    controls = (
        await db.execute(
            select(Control).where(
                Control.risk_selection_id.in_(list(risk_to_step.keys()) or [None]),
                Control.tenant_id == user.tenant_id,
                Control.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    control_to_step: dict[uuid.UUID, uuid.UUID | None] = {}
    controls_per_step: dict[uuid.UUID, int] = {}
    for c in controls:
        sid = risk_to_step.get(c.risk_selection_id)
        control_to_step[c.id] = sid
        if sid:
            controls_per_step[sid] = controls_per_step.get(sid, 0) + 1

    # tests per control
    tests = (
        await db.execute(
            select(ControlTest).where(
                ControlTest.control_id.in_(list(control_to_step.keys()) or [None]),
                ControlTest.tenant_id == user.tenant_id,
                ControlTest.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    agg: dict[uuid.UUID, dict[str, int]] = {}
    for tst in tests:
        sid = control_to_step.get(tst.control_id)
        if not sid:
            continue
        a = agg.setdefault(sid, {"total": 0, "passed": 0, "failed": 0, "pending": 0})
        a["total"] += 1
        s = tst.status.value if hasattr(tst.status, "value") else tst.status
        if s in _PASSED:
            a["passed"] += 1
        elif s in _FAILED:
            a["failed"] += 1
        elif s in _PENDING:
            a["pending"] += 1

    out = []
    for step in steps:
        a = agg.get(step.id, {"total": 0, "passed": 0, "failed": 0, "pending": 0})
        ctrl = controls_per_step.get(step.id, 0)
        in_progress = a["total"] - a["passed"] - a["failed"] - a["pending"]
        out.append(
            StepFlowOut(
                id=step.id,
                name_he=step.name_he,
                order_index=step.order_index,
                risk_count=risks_per_step.get(step.id, 0),
                control_count=ctrl,
                test_count=a["total"],
                tests_passed=a["passed"],
                tests_failed=a["failed"],
                tests_pending=a["pending"],
                tests_in_progress=in_progress,
                status=_step_status(ctrl, a["passed"], a["failed"], a["total"]),
            )
        )
    return ProcessFlowOut(process_selection_id=psel_id, steps=out)
