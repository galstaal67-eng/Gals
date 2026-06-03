import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, new_uuid
from app.db.types import GUID
from app.models.enums import (
    RiskClassification,
    RiskComplexity,
    RiskFrequency,
    RiskProbability,
    RiskRating,
)


class Risk(Base, TimestampMixin, SoftDeleteMixin):
    """בנק סיכונים — קטלוג גלובלי או override לכל לקוח (Q6)."""

    __tablename__ = "risks"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=True, index=True
    )
    code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    name_he: Mapped[str] = mapped_column(String(255), nullable=False)
    description_he: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    classification: Mapped[RiskClassification | None] = mapped_column(
        SAEnum(RiskClassification, name="risk_classification"), nullable=True
    )
    is_global: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class RiskSelection(Base, TimestampMixin, SoftDeleteMixin):
    """מופע סיכון לתהליך נבחר (שורה בטאב 'סיכונים').

    שדות הדירוג (complexity..residual_rating) רלוונטיים רק כשהתהליך אינו ITGC.
    """

    __tablename__ = "risk_selections"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=False, index=True
    )
    process_selection_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("process_selections.id"), nullable=False, index=True
    )
    subsidiary_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    audit_year_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    risk_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("risks.id"), nullable=False)

    classification: Mapped[RiskClassification | None] = mapped_column(
        SAEnum(RiskClassification, name="risk_classification_sel"), nullable=True
    )
    complexity: Mapped[RiskComplexity | None] = mapped_column(
        SAEnum(RiskComplexity, name="risk_complexity"), nullable=True
    )
    frequency: Mapped[RiskFrequency | None] = mapped_column(
        SAEnum(RiskFrequency, name="risk_frequency"), nullable=True
    )
    inherent_probability: Mapped[RiskProbability | None] = mapped_column(
        SAEnum(RiskProbability, name="risk_probability"), nullable=True
    )
    financial_damage: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5
    reputation: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5
    regulation: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5
    inherent_rating: Mapped[RiskRating | None] = mapped_column(
        SAEnum(RiskRating, name="risk_inherent_rating"), nullable=True
    )
    residual_rating: Mapped[RiskRating | None] = mapped_column(
        SAEnum(RiskRating, name="risk_residual_rating"), nullable=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
