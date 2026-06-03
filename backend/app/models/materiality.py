import uuid

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Integer, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid
from app.db.types import GUID
from app.models.enums import MaterialityParameterType


class MaterialityParameter(Base, TimestampMixin):
    """פרמטר סף מהותיות (C1) — 1..N לכל שנת ביקורת, ואופציונלית לכל חברת בת.

    subsidiary_id NULL = הגדרת הלקוח ברמת שנת הביקורת (סף 1/2/3).
    computed_threshold = value * percentage (מחושב, read-only).
    """

    __tablename__ = "materiality_parameters"
    __table_args__ = (
        UniqueConstraint(
            "audit_year_id", "subsidiary_id", "slot", name="uq_materiality_year_sub_slot"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=False, index=True
    )
    audit_year_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("audit_years.id"), nullable=False, index=True
    )
    subsidiary_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    slot: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 / 2 / 3
    parameter_type: Mapped[MaterialityParameterType] = mapped_column(
        SAEnum(MaterialityParameterType, name="materiality_parameter_type"), nullable=False
    )
    value: Mapped[float] = mapped_column(Numeric(20, 4), nullable=False)
    percentage: Mapped[float] = mapped_column(Numeric(7, 4), nullable=False)
    computed_threshold: Mapped[float] = mapped_column(Numeric(20, 4), nullable=False)
