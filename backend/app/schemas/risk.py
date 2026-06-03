import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import (
    RiskClassification,
    RiskComplexity,
    RiskFrequency,
    RiskProbability,
    RiskRating,
)


# ----- bank -----
class RiskBankCreate(BaseModel):
    code: str | None = None
    name_he: str
    description_he: str | None = None
    description_en: str | None = None
    classification: RiskClassification | None = None


class RiskBankOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str | None
    name_he: str
    description_he: str | None
    classification: RiskClassification | None
    is_global: bool


# ----- instances -----
class RiskSelectionCreate(BaseModel):
    risk_id: uuid.UUID
    classification: RiskClassification | None = None
    complexity: RiskComplexity | None = None
    frequency: RiskFrequency | None = None
    inherent_probability: RiskProbability | None = None
    financial_damage: int | None = Field(default=None, ge=1, le=5)
    reputation: int | None = Field(default=None, ge=1, le=5)
    regulation: int | None = Field(default=None, ge=1, le=5)
    inherent_rating: RiskRating | None = None
    residual_rating: RiskRating | None = None
    description: str | None = None


class RiskSelectionUpdate(BaseModel):
    classification: RiskClassification | None = None
    complexity: RiskComplexity | None = None
    frequency: RiskFrequency | None = None
    inherent_probability: RiskProbability | None = None
    financial_damage: int | None = Field(default=None, ge=1, le=5)
    reputation: int | None = Field(default=None, ge=1, le=5)
    regulation: int | None = Field(default=None, ge=1, le=5)
    inherent_rating: RiskRating | None = None
    residual_rating: RiskRating | None = None
    description: str | None = None


class RiskSelectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    process_selection_id: uuid.UUID
    subsidiary_id: uuid.UUID
    audit_year_id: uuid.UUID
    risk_id: uuid.UUID
    classification: RiskClassification | None
    complexity: RiskComplexity | None
    frequency: RiskFrequency | None
    inherent_probability: RiskProbability | None
    financial_damage: int | None
    reputation: int | None
    regulation: int | None
    inherent_rating: RiskRating | None
    residual_rating: RiskRating | None
    description: str | None
