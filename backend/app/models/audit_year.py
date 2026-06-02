import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, new_uuid
from app.db.types import GUID
from app.models.enums import AuditYearStatus


class AuditYear(Base, TimestampMixin, SoftDeleteMixin):
    """שנת ביקורת ללקוח."""

    __tablename__ = "audit_years"
    __table_args__ = (UniqueConstraint("client_id", "year", name="uq_audit_year_client_year"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=False, index=True
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("clients.id"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[AuditYearStatus] = mapped_column(
        SAEnum(AuditYearStatus, name="audit_year_status"),
        default=AuditYearStatus.OPEN,
        nullable=False,
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
