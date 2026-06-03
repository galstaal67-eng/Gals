import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, new_uuid
from app.db.types import GUID
from app.models.enums import (
    ControlFrequency,
    ControlPurpose,
    ControlStatus,
    ControlType,
)


class ControlBank(Base, TimestampMixin, SoftDeleteMixin):
    """בנק בקרות — קטלוג גלובלי/לקוח של בקרות לבחירה (Q6)."""

    __tablename__ = "control_bank"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=True, index=True
    )
    code: Mapped[str | None] = mapped_column(String(32), nullable=True)  # "AA-00"
    name_he: Mapped[str] = mapped_column(String(255), nullable=False)
    desired_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_global: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Control(Base, TimestampMixin, SoftDeleteMixin):
    """מופע בקרה — שורה בטאב 'בקרות', משויכת לסיכון נבחר ולתהליך נבחר."""

    __tablename__ = "controls"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=False, index=True
    )
    audit_year_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    subsidiary_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    risk_selection_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("risk_selections.id"), nullable=False, index=True
    )
    process_selection_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    control_bank_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("control_bank.id"), nullable=True
    )

    system_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    existing_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    new_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    control_name: Mapped[str] = mapped_column(String(255), nullable=False)
    desired_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    actual_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    purpose: Mapped[ControlPurpose | None] = mapped_column(
        SAEnum(ControlPurpose, name="control_purpose"), nullable=True
    )
    control_type: Mapped[ControlType | None] = mapped_column(
        SAEnum(ControlType, name="control_type"), nullable=True
    )
    frequency: Mapped[ControlFrequency | None] = mapped_column(
        SAEnum(ControlFrequency, name="control_frequency"), nullable=True
    )
    owner_contact_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    operator_contact_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    is_key_control: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    status: Mapped[ControlStatus] = mapped_column(
        SAEnum(ControlStatus, name="control_status"),
        default=ControlStatus.DRAFT,
        nullable=False,
    )
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    validated_by: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
