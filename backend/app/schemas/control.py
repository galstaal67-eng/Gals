import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import (
    ControlFrequency,
    ControlPurpose,
    ControlStatus,
    ControlType,
)


# ----- bank -----
class ControlBankCreate(BaseModel):
    code: str | None = None
    name_he: str
    desired_description: str | None = None


class ControlBankOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str | None
    name_he: str
    desired_description: str | None
    is_global: bool
    process_id: uuid.UUID | None = None
    step: str | None = None
    risk_description: str | None = None
    owner_hint: str | None = None
    default_purpose: ControlPurpose | None = None
    default_type: ControlType | None = None
    default_frequency: ControlFrequency | None = None
    is_key_default: bool = False


class ControlImportRequest(BaseModel):
    """ייבוא בקרה מהקטלוג הגלובלי אל חברה־בת בשנת ביקורת."""

    control_bank_id: uuid.UUID


# ----- instances -----
class ControlCreate(BaseModel):
    control_bank_id: uuid.UUID | None = None
    system_name: str | None = None
    existing_code: str | None = None
    new_code: str | None = None
    control_name: str
    desired_description: str | None = None
    actual_description: str | None = None
    purpose: ControlPurpose | None = None
    control_type: ControlType | None = None
    frequency: ControlFrequency | None = None
    owner_contact_id: uuid.UUID | None = None
    operator_contact_id: uuid.UUID | None = None
    is_key_control: bool = False


class ControlUpdate(BaseModel):
    system_name: str | None = None
    existing_code: str | None = None
    new_code: str | None = None
    control_name: str | None = None
    desired_description: str | None = None
    actual_description: str | None = None
    purpose: ControlPurpose | None = None
    control_type: ControlType | None = None
    frequency: ControlFrequency | None = None
    owner_contact_id: uuid.UUID | None = None
    operator_contact_id: uuid.UUID | None = None
    is_key_control: bool | None = None


class ControlTransition(BaseModel):
    target_state: ControlStatus
    reason: str | None = None


class ControlOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    audit_year_id: uuid.UUID
    subsidiary_id: uuid.UUID
    risk_selection_id: uuid.UUID
    process_selection_id: uuid.UUID
    control_bank_id: uuid.UUID | None
    system_name: str | None
    existing_code: str | None
    new_code: str | None
    control_name: str
    desired_description: str | None
    actual_description: str | None
    purpose: ControlPurpose | None
    control_type: ControlType | None
    frequency: ControlFrequency | None
    owner_contact_id: uuid.UUID | None
    operator_contact_id: uuid.UUID | None
    is_key_control: bool
    status: ControlStatus
    validated_at: datetime | None
