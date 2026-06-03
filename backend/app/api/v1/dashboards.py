import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.rbac import Permission
from app.models.control import Control
from app.models.control_test import ControlTest
from app.schemas.dashboard import DashboardOut

router = APIRouter(prefix="/dashboards", tags=["dashboards"])


async def _build_dashboard(
    db: AsyncSession, user: CurrentUser, audit_year_id: uuid.UUID | None
) -> DashboardOut:
    cfilters = [Control.tenant_id == user.tenant_id, Control.deleted_at.is_(None)]
    tfilters = [ControlTest.tenant_id == user.tenant_id, ControlTest.deleted_at.is_(None)]
    if audit_year_id:
        cfilters.append(Control.audit_year_id == audit_year_id)
        tfilters.append(ControlTest.audit_year_id == audit_year_id)

    # controls by status
    controls_by_status: dict[str, int] = {}
    for st, cnt in (
        await db.execute(
            select(Control.status, func.count()).where(*cfilters).group_by(Control.status)
        )
    ).all():
        controls_by_status[st.value] = cnt

    key = (
        await db.execute(
            select(func.count()).where(*cfilters, Control.is_key_control.is_(True))
        )
    ).scalar_one()
    total_controls = sum(controls_by_status.values())

    # tests by status
    tests_by_status: dict[str, int] = {}
    for st, cnt in (
        await db.execute(
            select(ControlTest.status, func.count()).where(*tfilters).group_by(ControlTest.status)
        )
    ).all():
        tests_by_status[st.value] = cnt
    total_tests = sum(tests_by_status.values())

    # deficiencies by severity (where severity set)
    deficiencies: dict[str, int] = {}
    for sev, cnt in (
        await db.execute(
            select(ControlTest.severity, func.count())
            .where(*tfilters, ControlTest.severity.is_not(None))
            .group_by(ControlTest.severity)
        )
    ).all():
        deficiencies[sev.value] = cnt

    return DashboardOut(
        audit_year_id=str(audit_year_id) if audit_year_id else None,
        controls_total=total_controls,
        controls_by_status=controls_by_status,
        key_controls=key,
        non_key_controls=total_controls - key,
        tests_total=total_tests,
        tests_by_status=tests_by_status,
        deficiencies_by_severity=deficiencies,
    )


@router.get("/consultant", response_model=DashboardOut)
async def consultant_dashboard(
    audit_year_id: uuid.UUID | None = None,
    user: CurrentUser = Depends(require(Permission.CONTROL_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_dashboard(db, user, audit_year_id)


@router.get("/client", response_model=DashboardOut)
async def client_dashboard(
    audit_year_id: uuid.UUID | None = None,
    user: CurrentUser = Depends(require(Permission.TEST_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_dashboard(db, user, audit_year_id)


@router.get("/auditor", response_model=DashboardOut)
async def auditor_dashboard(
    audit_year_id: uuid.UUID | None = None,
    user: CurrentUser = Depends(require(Permission.CONTROL_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await _build_dashboard(db, user, audit_year_id)
