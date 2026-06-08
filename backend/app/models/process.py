import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, new_uuid
from app.db.types import GUID
from app.models.enums import ProcessCategory


class Process(Base, TimestampMixin, SoftDeleteMixin):
    """בנק תהליכים — קטלוג גלובלי (is_global) או override לכל לקוח (Q6)."""

    __tablename__ = "processes"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    # NULL tenant_id allowed only for global bank rows.
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=True, index=True
    )
    code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    name_he: Mapped[str] = mapped_column(String(255), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[ProcessCategory] = mapped_column(
        SAEnum(ProcessCategory, name="process_category"), nullable=False
    )
    is_global: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class SubActivity(Base, TimestampMixin, SoftDeleteMixin):
    """תת-פעילות המשויכת לתהליך בבנק."""

    __tablename__ = "sub_activities"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    process_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("processes.id"), nullable=False, index=True
    )
    name_he: Mapped[str] = mapped_column(String(255), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(255), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_global: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
