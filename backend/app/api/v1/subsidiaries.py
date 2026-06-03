import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.audit import record_audit
from app.core.rbac import Permission
from app.models.audit_year import AuditYear
from app.models.enums import AuditAction, AuditYearStatus, ScopeResult
from app.models.subsidiary import Subsidiary, SubsidiaryQualitativeAnswer
from app.schemas.subsidiary import (
    QualitativeAnswerOut,
    QualitativeAnswersUpdate,
    ScopeDecision,
    SubsidiaryCreate,
    SubsidiaryOut,
    SubsidiaryUpdate,
)

router = APIRouter(tags=["subsidiaries"])

# A subsidiary is qualitatively significant when MORE THAN 3 of the 5 answers
# are "yes" (SPEC §חברות בנות). Tunable in one place.
QUALITATIVE_YES_THRESHOLD = 4


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


async def _get_sub(db: AsyncSession, tenant_id: uuid.UUID, sub_id: uuid.UUID) -> Subsidiary:
    sub = (
        await db.execute(
            select(Subsidiary).where(
                Subsidiary.id == sub_id,
                Subsidiary.tenant_id == tenant_id,
                Subsidiary.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not sub:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "subsidiary not found")
    return sub


def _ensure_open(year: AuditYear) -> None:
    if year.status != AuditYearStatus.OPEN:
        raise HTTPException(status.HTTP_409_CONFLICT, "audit year is locked")


@router.get("/audit-years/{year_id}/subsidiaries", response_model=list[SubsidiaryOut])
async def list_subsidiaries(
    year_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.SUBSIDIARY_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    await _get_year(db, user.tenant_id, year_id)
    rows = (
        await db.execute(
            select(Subsidiary).where(
                Subsidiary.audit_year_id == year_id,
                Subsidiary.tenant_id == user.tenant_id,
                Subsidiary.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    return rows


@router.get("/audit-years/{year_id}/subsidiaries/in-scope", response_model=list[SubsidiaryOut])
async def list_in_scope(
    year_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.SUBSIDIARY_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    """'חברות בסקופ' — approved-significant subsidiaries for the year."""
    await _get_year(db, user.tenant_id, year_id)
    rows = (
        await db.execute(
            select(Subsidiary).where(
                Subsidiary.audit_year_id == year_id,
                Subsidiary.tenant_id == user.tenant_id,
                Subsidiary.is_significant.is_(True),
                Subsidiary.scope_approved.is_(True),
                Subsidiary.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    return rows


@router.post(
    "/audit-years/{year_id}/subsidiaries",
    response_model=SubsidiaryOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_subsidiary(
    year_id: uuid.UUID,
    body: SubsidiaryCreate,
    user: CurrentUser = Depends(require(Permission.SUBSIDIARY_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    year = await _get_year(db, user.tenant_id, year_id)
    _ensure_open(year)
    sub = Subsidiary(
        tenant_id=user.tenant_id,
        client_id=year.client_id,
        audit_year_id=year_id,
        name=body.name,
        in_scope_previous_year=body.in_scope_previous_year,
    )
    db.add(sub)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="subsidiary",
        entity_id=sub.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"name": body.name},
    )
    await db.commit()
    await db.refresh(sub)
    return sub


@router.patch("/subsidiaries/{sub_id}", response_model=SubsidiaryOut)
async def update_subsidiary(
    sub_id: uuid.UUID,
    body: SubsidiaryUpdate,
    user: CurrentUser = Depends(require(Permission.SUBSIDIARY_EDIT)),
    db: AsyncSession = Depends(get_db),
):
    sub = await _get_sub(db, user.tenant_id, sub_id)
    _ensure_open(await _get_year(db, user.tenant_id, sub.audit_year_id))
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(sub, key, value)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="subsidiary",
        entity_id=sub.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={k: (v.value if hasattr(v, "value") else v) for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(sub)
    return sub


@router.get(
    "/subsidiaries/{sub_id}/qualitative-answers", response_model=list[QualitativeAnswerOut]
)
async def get_qualitative(
    sub_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.SUBSIDIARY_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    await _get_sub(db, user.tenant_id, sub_id)
    rows = (
        await db.execute(
            select(SubsidiaryQualitativeAnswer).where(
                SubsidiaryQualitativeAnswer.subsidiary_id == sub_id
            )
        )
    ).scalars().all()
    return rows


@router.put(
    "/subsidiaries/{sub_id}/qualitative-answers", response_model=SubsidiaryOut
)
async def set_qualitative(
    sub_id: uuid.UUID,
    body: QualitativeAnswersUpdate,
    user: CurrentUser = Depends(require(Permission.SUBSIDIARY_EDIT)),
    db: AsyncSession = Depends(get_db),
):
    """Upsert the 5 qualitative answers and recompute the qualitative result."""
    sub = await _get_sub(db, user.tenant_id, sub_id)
    _ensure_open(await _get_year(db, user.tenant_id, sub.audit_year_id))

    existing = {
        a.question_key: a
        for a in (
            await db.execute(
                select(SubsidiaryQualitativeAnswer).where(
                    SubsidiaryQualitativeAnswer.subsidiary_id == sub_id
                )
            )
        ).scalars().all()
    }
    for item in body.answers:
        if item.question_key in existing:
            existing[item.question_key].answer = item.answer
        else:
            db.add(
                SubsidiaryQualitativeAnswer(
                    tenant_id=user.tenant_id,
                    subsidiary_id=sub_id,
                    question_key=item.question_key,
                    answer=item.answer,
                )
            )
            existing[item.question_key] = None  # placeholder for count below

    # recompute from the full set
    await db.flush()
    yes_count = (
        await db.execute(
            select(SubsidiaryQualitativeAnswer).where(
                SubsidiaryQualitativeAnswer.subsidiary_id == sub_id,
                SubsidiaryQualitativeAnswer.answer.is_(True),
            )
        )
    ).scalars().all()
    sub.qualitative_result = (
        ScopeResult.PASS if len(yes_count) >= QUALITATIVE_YES_THRESHOLD else ScopeResult.FAIL
    )
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="subsidiary",
        entity_id=sub.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"qualitative_result": sub.qualitative_result.value, "yes": len(yes_count)},
    )
    await db.commit()
    await db.refresh(sub)
    return sub


@router.post("/subsidiaries/{sub_id}/scope-decision", response_model=SubsidiaryOut)
async def scope_decision(
    sub_id: uuid.UUID,
    body: ScopeDecision,
    user: CurrentUser = Depends(require(Permission.SUBSIDIARY_SCOPE)),
    db: AsyncSession = Depends(get_db),
):
    """Manager decides scope inclusion and optionally approves the תיחום."""
    sub = await _get_sub(db, user.tenant_id, sub_id)
    _ensure_open(await _get_year(db, user.tenant_id, sub.audit_year_id))
    sub.is_significant = body.is_significant
    if body.approve:
        sub.scope_approved = True
        sub.scope_approved_by = user.id
        sub.scope_approved_at = datetime.now(UTC)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.APPROVE,
        entity_type="subsidiary",
        entity_id=sub.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"is_significant": body.is_significant, "approved": body.approve},
    )
    await db.commit()
    await db.refresh(sub)
    return sub
