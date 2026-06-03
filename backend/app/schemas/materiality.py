import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import MaterialityParameterType


class MaterialityParameterCreate(BaseModel):
    slot: int = Field(ge=1, le=3)
    subsidiary_id: uuid.UUID | None = None
    parameter_type: MaterialityParameterType
    value: Decimal
    percentage: Decimal


class MaterialityParameterUpdate(BaseModel):
    parameter_type: MaterialityParameterType | None = None
    value: Decimal | None = None
    percentage: Decimal | None = None


class MaterialityParameterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    audit_year_id: uuid.UUID
    subsidiary_id: uuid.UUID | None
    slot: int
    parameter_type: MaterialityParameterType
    value: Decimal
    percentage: Decimal
    computed_threshold: Decimal
