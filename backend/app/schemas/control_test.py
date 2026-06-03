import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import (
    ControlEffectiveness,
    DeficiencySeverity,
    TestRound,
    TestStatus,
)


class TestUpdate(BaseModel):
    test_round: TestRound | None = None
    required_evidence: list[str] | None = None
    test_method: str | None = None
    results: str | None = None
    notes: str | None = None
    severity: DeficiencySeverity | None = None
    effectiveness: ControlEffectiveness | None = None
    deficiencies_found: str | None = None
    compensating_control: str | None = None
    company_response: str | None = None
    assigned_to_user_id: uuid.UUID | None = None
    due_date: date | None = None
    no_due_date: bool | None = None
    ready_to_send: bool | None = None


class TestTransition(BaseModel):
    target_state: TestStatus
    reason: str | None = None


class TestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    control_id: uuid.UUID
    audit_year_id: uuid.UUID
    subsidiary_id: uuid.UUID
    test_round: TestRound | None
    required_evidence: list[str] | None
    test_method: str | None
    results: str | None
    notes: str | None
    status: TestStatus
    severity: DeficiencySeverity | None
    effectiveness: ControlEffectiveness | None
    deficiencies_found: str | None
    compensating_control: str | None
    company_response: str | None
    assigned_to_user_id: uuid.UUID | None
    due_date: date | None
    no_due_date: bool
    ready_to_send: bool
    completed_at: datetime | None


class EvidenceCreate(BaseModel):
    filename: str
    file_hash: str | None = None
    file_size: int | None = None
    storage_path: str | None = None
    is_sample: bool = False
    notes: str | None = None


class EvidenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    test_id: uuid.UUID
    filename: str
    file_hash: str | None
    file_size: int | None
    storage_path: str | None
    is_sample: bool
    notes: str | None
    source: str
    replaced_by_id: uuid.UUID | None
    uploaded_at: datetime
