import csv
import io
import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.rbac import Permission
from app.models.control import Control
from app.models.control_test import ControlTest

router = APIRouter(prefix="/reports", tags=["reports"])


def _csv_response(headers: list[str], rows: list[list[str]], filename: str) -> Response:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    return Response(
        content=buf.getvalue().encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/controls-matrix")
async def controls_matrix(
    audit_year_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.REPORT_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    """דוח מטריצת בקרות — CSV (PDF/XLSX rendering to be layered on top)."""
    rows = (
        await db.execute(
            select(Control).where(
                Control.audit_year_id == audit_year_id,
                Control.tenant_id == user.tenant_id,
                Control.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    data = [
        [
            str(c.id),
            c.control_name,
            c.system_name or "",
            c.existing_code or "",
            "key" if c.is_key_control else "",
            c.status.value,
        ]
        for c in rows
    ]
    return _csv_response(
        ["id", "control_name", "system", "code", "key", "status"], data, "controls_matrix.csv"
    )


@router.get("/test-status")
async def test_status_report(
    audit_year_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.REPORT_EXPORT)),
    db: AsyncSession = Depends(get_db),
):
    """דוח סטטוס טסטים/ממצאים — CSV."""
    rows = (
        await db.execute(
            select(ControlTest).where(
                ControlTest.audit_year_id == audit_year_id,
                ControlTest.tenant_id == user.tenant_id,
                ControlTest.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    data = [
        [
            str(t.id),
            str(t.control_id),
            t.status.value,
            t.severity.value if t.severity else "",
            t.effectiveness.value if t.effectiveness else "",
            t.test_round.value if t.test_round else "",
        ]
        for t in rows
    ]
    return _csv_response(
        ["id", "control_id", "status", "severity", "effectiveness", "round"],
        data,
        "test_status.csv",
    )
