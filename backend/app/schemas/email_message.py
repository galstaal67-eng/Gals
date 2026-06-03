import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class RequestValidationIn(BaseModel):
    cc_email: str | None = None


class RequestEvidenceIn(BaseModel):
    due_date: date | None = None
    cc_email: str | None = None


class EmailMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    to_email: str
    cc_email: str | None
    subject: str
    body: str
    related_entity_type: str | None
    related_entity_id: str | None
    status: str
    created_at: datetime
