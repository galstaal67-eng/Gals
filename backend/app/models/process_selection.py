import uuid

from sqlalchemy import Boolean, ForeignKey
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, new_uuid
from app.db.types import GUID
from app.models.enums import ItgcLayer


class ProcessSelection(Base, TimestampMixin, SoftDeleteMixin):
    """מופע של תהליך בנק עבור חברת-בת בשנת ביקורת (שורה בטאב 'תהליכים')."""

    __tablename__ = "process_selections"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=False, index=True
    )
    audit_year_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("audit_years.id"), nullable=False, index=True
    )
    subsidiary_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("subsidiaries.id"), nullable=False, index=True
    )
    process_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("processes.id"), nullable=False
    )
    sub_activity_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("sub_activities.id"), nullable=True
    )
    # רובד — only meaningful when the bank process category is ITGC.
    itgc_layer: Mapped[ItgcLayer | None] = mapped_column(
        SAEnum(ItgcLayer, name="itgc_layer"), nullable=True
    )
    is_in_scope: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_material: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
