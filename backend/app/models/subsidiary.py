import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, new_uuid
from app.db.types import GUID
from app.models.enums import QualitativeQuestion, ScopeResult


class Subsidiary(Base, TimestampMixin, SoftDeleteMixin):
    """חברת בת — תחת מבנה ארגוני של הלקוח, נבחנת למהותיות לסקופ הביקורת."""

    __tablename__ = "subsidiaries"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=False, index=True
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("clients.id"), nullable=False, index=True
    )
    audit_year_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("audit_years.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantitative_result: Mapped[ScopeResult | None] = mapped_column(
        SAEnum(ScopeResult, name="scope_result_quant"), nullable=True
    )
    qualitative_result: Mapped[ScopeResult | None] = mapped_column(
        SAEnum(ScopeResult, name="scope_result_qual"), nullable=True
    )
    in_scope_previous_year: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_significant: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    scope_approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    scope_approved_by: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    scope_approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class SubsidiaryQualitativeAnswer(Base, TimestampMixin):
    """תשובה לאחת מ-5 השאלות האיכותיות, נשמרת לכל שנת ביקורת."""

    __tablename__ = "subsidiary_qualitative_answers"
    __table_args__ = (
        UniqueConstraint("subsidiary_id", "question_key", name="uq_qualitative_sub_question"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=False, index=True
    )
    subsidiary_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("subsidiaries.id"), nullable=False, index=True
    )
    question_key: Mapped[QualitativeQuestion] = mapped_column(
        SAEnum(QualitativeQuestion, name="qualitative_question"), nullable=False
    )
    answer: Mapped[bool] = mapped_column(Boolean, nullable=False)
