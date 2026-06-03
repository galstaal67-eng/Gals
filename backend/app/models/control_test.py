import uuid
from datetime import datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, new_uuid
from app.db.types import GUID, JSONType
from app.models.enums import (
    ControlEffectiveness,
    DeficiencySeverity,
    TestRound,
    TestStatus,
)


class ControlTest(Base, TimestampMixin, SoftDeleteMixin):
    """טסט לבקרה — מטריצת הטסטים, 12 סטטוסים (SPEC §3)."""

    __tablename__ = "control_tests"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=False, index=True
    )
    control_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("controls.id"), nullable=False, index=True
    )
    audit_year_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    subsidiary_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)

    test_round: Mapped[TestRound | None] = mapped_column(
        SAEnum(TestRound, name="test_round"), nullable=True
    )
    required_evidence: Mapped[list | None] = mapped_column(JSONType, nullable=True)
    test_method: Mapped[str | None] = mapped_column(Text, nullable=True)
    results: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[TestStatus] = mapped_column(
        SAEnum(TestStatus, name="test_status"),
        default=TestStatus.PENDING_RECEIPT,
        nullable=False,
    )
    severity: Mapped[DeficiencySeverity | None] = mapped_column(
        SAEnum(DeficiencySeverity, name="deficiency_severity"), nullable=True
    )
    effectiveness: Mapped[ControlEffectiveness | None] = mapped_column(
        SAEnum(ControlEffectiveness, name="control_effectiveness"), nullable=True
    )
    deficiencies_found: Mapped[str | None] = mapped_column(Text, nullable=True)
    compensating_control: Mapped[str | None] = mapped_column(Text, nullable=True)
    company_response: Mapped[str | None] = mapped_column(Text, nullable=True)

    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    no_due_date: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    ready_to_send: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Evidence(Base, TimestampMixin, SoftDeleteMixin):
    """ראיה/קובץ תומך לטסט. החלפה בלבד (replaced_by_id), לא מחיקה — דרישת SOX."""

    __tablename__ = "evidences"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=False, index=True
    )
    test_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("control_tests.id"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    file_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)  # sha256
    file_size: Mapped[int | None] = mapped_column(nullable=True)
    storage_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    source: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)
    email_message_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
