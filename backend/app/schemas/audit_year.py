import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import AuditYearStatus


class AuditYearCreate(BaseModel):
    year: int


class AuditYearOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    client_id: uuid.UUID
    year: int
    status: AuditYearStatus
    locked_at: datetime | None
    locked_by: uuid.UUID | None
