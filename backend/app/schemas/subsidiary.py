import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import QualitativeQuestion, ScopeResult


class SubsidiaryCreate(BaseModel):
    name: str
    in_scope_previous_year: bool = False


class SubsidiaryUpdate(BaseModel):
    name: str | None = None
    in_scope_previous_year: bool | None = None
    quantitative_result: ScopeResult | None = None


class SubsidiaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID
    audit_year_id: uuid.UUID
    name: str
    quantitative_result: ScopeResult | None
    qualitative_result: ScopeResult | None
    in_scope_previous_year: bool
    is_significant: bool
    scope_approved: bool
    scope_approved_at: datetime | None


class QualitativeAnswerIn(BaseModel):
    question_key: QualitativeQuestion
    answer: bool


class QualitativeAnswersUpdate(BaseModel):
    answers: list[QualitativeAnswerIn]


class QualitativeAnswerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    question_key: QualitativeQuestion
    answer: bool


class ScopeDecision(BaseModel):
    is_significant: bool
    approve: bool = False
