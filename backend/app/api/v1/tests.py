import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.audit import record_audit
from app.core.email import queue_email, render_evidence_request
from app.core.notifications import notify
from app.core.rbac import Permission
from app.core.state_machine import can_test_transition
from app.core.storage import save_evidence
from app.models.audit_year import AuditYear
from app.models.contact import Contact
from app.models.control import Control
from app.models.control_test import ControlTest, Evidence
from app.models.enums import AuditAction, AuditYearStatus, TestStatus, UserRole
from app.models.user import User
from app.schemas.control_test import (
    EvidenceCreate,
    EvidenceOut,
    TestOut,
    TestTransition,
    TestUpdate,
)
from app.schemas.email_message import EmailMessageOut, RequestEvidenceIn

router = APIRouter(tags=["tests"])

# Transitions that bounce the test back to the company reset the send flag (SPEC).
_RESET_READY = {TestStatus.COMPANY_COMPLETION, TestStatus.DEFICIENCY_OPEN}
_TERMINAL = {TestStatus.INTERNALLY_CLOSED, TestStatus.DEFICIENCY_CLOSED, TestStatus.NOT_RELEVANT}


async def _get_test(db: AsyncSession, user: CurrentUser, tid: uuid.UUID) -> ControlTest:
    t = (
        await db.execute(
            select(ControlTest).where(
                ControlTest.id == tid,
                ControlTest.tenant_id == user.tenant_id,
                ControlTest.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "test not found")
    return t


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


@router.get("/controls/{cid}/tests", response_model=list[TestOut])
async def list_tests_for_control(
    cid: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.TEST_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(ControlTest).where(
                ControlTest.control_id == cid,
                ControlTest.tenant_id == user.tenant_id,
                ControlTest.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    return rows


@router.get("/audit-years/{year_id}/tests", response_model=list[TestOut])
async def list_tests_for_year(
    year_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.TEST_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(ControlTest).where(
                ControlTest.audit_year_id == year_id,
                ControlTest.tenant_id == user.tenant_id,
                ControlTest.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    return rows


@router.get("/tests/{tid}", response_model=TestOut)
async def get_test(
    tid: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.TEST_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await _get_test(db, user, tid)


@router.patch("/tests/{tid}", response_model=TestOut)
async def update_test(
    tid: uuid.UUID,
    body: TestUpdate,
    user: CurrentUser = Depends(require(Permission.TEST_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    test = await _get_test(db, user, tid)
    await _ensure_year_open(db, user, test.audit_year_id)
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(test, key, value)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="control_test",
        entity_id=test.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={k: (v.value if hasattr(v, "value") else str(v)) for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(test)
    return test


@router.post("/tests/{tid}/ready", response_model=TestOut)
async def mark_ready(
    tid: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.TEST_UPLOAD_EVIDENCE)),
    db: AsyncSession = Depends(get_db),
):
    """'טסט מוכן לשליחה' — client marks the test ready for the consultant unit."""
    test = await _get_test(db, user, tid)
    await _ensure_year_open(db, user, test.audit_year_id)
    test.ready_to_send = True
    if test.status == TestStatus.PENDING_RECEIPT:
        test.status = TestStatus.CONSULTANT_HANDLING
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="control_test",
        entity_id=test.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"ready_to_send": True, "status": test.status.value},
    )
    await db.commit()
    await db.refresh(test)
    return test


@router.post("/tests/{tid}/transition", response_model=TestOut)
async def transition_test(
    tid: uuid.UUID,
    body: TestTransition,
    user: CurrentUser = Depends(require(Permission.TEST_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    test = await _get_test(db, user, tid)
    await _ensure_year_open(db, user, test.audit_year_id)

    if not can_test_transition(test.status, body.target_state, user.role):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"illegal transition {test.status.value} -> {body.target_state.value}",
        )

    before = test.status
    test.status = body.target_state
    if body.target_state in _RESET_READY:
        test.ready_to_send = False
    if body.target_state in _TERMINAL:
        test.completed_at = datetime.now(UTC)

    # Bounced back to the company → notify the assignee there is work to do.
    if body.target_state in _RESET_READY and test.assigned_to_user_id:
        await notify(
            db,
            tenant_id=user.tenant_id,
            recipient_user_id=test.assigned_to_user_id,
            event_type="test_returned",
            title="טסט הוחזר לטיפולך",
            body=body.reason,
            entity_type="control_test",
            entity_id=test.id,
        )

    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="control_test",
        entity_id=test.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        before={"status": before.value},
        after={"status": body.target_state.value, "reason": body.reason},
    )
    await db.commit()
    await db.refresh(test)
    return test


# ------------------------------------------------------------------ evidence

@router.get("/tests/{tid}/evidences", response_model=list[EvidenceOut])
async def list_evidences(
    tid: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.TEST_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    await _get_test(db, user, tid)
    rows = (
        await db.execute(
            select(Evidence).where(
                Evidence.test_id == tid,
                Evidence.tenant_id == user.tenant_id,
                Evidence.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    return rows


@router.post(
    "/tests/{tid}/evidences", response_model=EvidenceOut, status_code=status.HTTP_201_CREATED
)
async def add_evidence(
    tid: uuid.UUID,
    body: EvidenceCreate,
    user: CurrentUser = Depends(require(Permission.TEST_UPLOAD_EVIDENCE)),
    db: AsyncSession = Depends(get_db),
):
    """Register an evidence file (metadata + sha256). Blob upload is wired separately."""
    test = await _get_test(db, user, tid)
    await _ensure_year_open(db, user, test.audit_year_id)
    ev = Evidence(
        tenant_id=user.tenant_id,
        test_id=tid,
        uploaded_by_user_id=user.id,
        source="manual",
        **body.model_dump(),
    )
    db.add(ev)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="evidence",
        entity_id=ev.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"filename": body.filename, "hash": body.file_hash},
    )
    await db.commit()
    await db.refresh(ev)
    return ev


@router.post(
    "/tests/{tid}/evidences/{eid}/replace",
    response_model=EvidenceOut,
    status_code=status.HTTP_201_CREATED,
)
async def replace_evidence(
    tid: uuid.UUID,
    eid: uuid.UUID,
    body: EvidenceCreate,
    user: CurrentUser = Depends(require(Permission.TEST_UPLOAD_EVIDENCE)),
    db: AsyncSession = Depends(get_db),
):
    """Replace (not delete) an evidence file — SOX requires keeping the original."""
    test = await _get_test(db, user, tid)
    await _ensure_year_open(db, user, test.audit_year_id)
    old = (
        await db.execute(
            select(Evidence).where(
                Evidence.id == eid,
                Evidence.test_id == tid,
                Evidence.tenant_id == user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not old:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "evidence not found")

    new = Evidence(
        tenant_id=user.tenant_id,
        test_id=tid,
        uploaded_by_user_id=user.id,
        source="manual",
        **body.model_dump(),
    )
    db.add(new)
    await db.flush()
    old.replaced_by_id = new.id  # keep the original, link forward
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="evidence",
        entity_id=old.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"replaced_by_id": str(new.id)},
    )
    await db.commit()
    await db.refresh(new)
    return new


@router.post("/tests/{tid}/request-evidence", response_model=EmailMessageOut)
async def request_evidence(
    tid: uuid.UUID,
    body: RequestEvidenceIn,
    user: CurrentUser = Depends(require(Permission.TEST_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    """Queue the evidence-request email to the control owner and set the due date."""
    test = await _get_test(db, user, tid)
    await _ensure_year_open(db, user, test.audit_year_id)
    ctrl = (
        await db.execute(select(Control).where(Control.id == test.control_id))
    ).scalar_one_or_none()
    if not ctrl or ctrl.owner_contact_id is None:
        raise HTTPException(422, "control has no owner contact to email")
    contact = (
        await db.execute(
            select(Contact).where(
                Contact.id == ctrl.owner_contact_id, Contact.tenant_id == user.tenant_id
            )
        )
    ).scalar_one_or_none()
    if not contact or not contact.email:
        raise HTTPException(422, "owner contact has no email")

    year = (
        await db.execute(select(AuditYear).where(AuditYear.id == test.audit_year_id))
    ).scalar_one()
    sender = await db.get(User, user.id)

    if body.due_date is not None:
        test.due_date = body.due_date

    rendered = render_evidence_request(
        client_name=contact.full_name,
        audit_year=year.year,
        consultant_name=sender.full_name if sender else "",
        due_date=str(body.due_date) if body.due_date else None,
        controls=[
            {
                "system": ctrl.system_name,
                "control_name": ctrl.control_name,
                "code": ctrl.existing_code or ctrl.new_code,
                "required_evidence": ", ".join(test.required_evidence or []),
            }
        ],
    )
    msg = await queue_email(
        db,
        tenant_id=user.tenant_id,
        to_email=contact.email,
        cc_email=body.cc_email,
        rendered=rendered,
        related_entity_type="control_test",
        related_entity_id=test.id,
        sent_by_user_id=user.id,
    )
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="control_test",
        entity_id=test.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"email_queued": str(msg.id), "due_date": str(test.due_date)},
    )
    await db.commit()
    await db.refresh(msg)
    return msg


@router.post(
    "/tests/{tid}/evidences/upload",
    response_model=EvidenceOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_evidence(
    tid: uuid.UUID,
    file: UploadFile = File(...),
    is_sample: bool = Form(False),
    notes: str | None = Form(None),
    user: CurrentUser = Depends(require(Permission.TEST_UPLOAD_EVIDENCE)),
    db: AsyncSession = Depends(get_db),
):
    """Upload a real evidence file: stores bytes, computes SHA-256, records it."""
    test = await _get_test(db, user, tid)
    await _ensure_year_open(db, user, test.audit_year_id)
    content = await file.read()
    stored = save_evidence(
        tenant_id=user.tenant_id, filename=file.filename or "evidence", content=content
    )
    # only consultant+ may flag a file as a sample
    sample = is_sample and user.role in (UserRole.ADMIN, UserRole.MANAGER, UserRole.CONSULTANT)
    ev = Evidence(
        tenant_id=user.tenant_id,
        test_id=tid,
        filename=file.filename or "evidence",
        file_hash=stored.file_hash,
        file_size=stored.file_size,
        storage_path=stored.storage_path,
        is_sample=sample,
        notes=notes,
        uploaded_by_user_id=user.id,
        source="manual",
    )
    db.add(ev)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="evidence",
        entity_id=ev.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"filename": ev.filename, "hash": ev.file_hash},
    )
    await db.commit()
    await db.refresh(ev)
    return ev
