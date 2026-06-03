import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import NotificationChannel


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_type: str
    entity_type: str | None
    entity_id: str | None
    channel: NotificationChannel
    title: str
    body: str | None
    read_at: datetime | None
    created_at: datetime
