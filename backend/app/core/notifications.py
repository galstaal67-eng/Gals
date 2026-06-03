import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import NotificationChannel
from app.models.notification import Notification


async def notify(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    recipient_user_id: uuid.UUID,
    event_type: str,
    title: str,
    body: str | None = None,
    entity_type: str | None = None,
    entity_id: str | uuid.UUID | None = None,
    channel: NotificationChannel = NotificationChannel.IN_APP,
) -> Notification:
    """Create a notification row. Email/SMS dispatch is wired by the delivery
    layer reading channel != in_app; the row is the durable record either way.
    Caller commits.
    """
    note = Notification(
        tenant_id=tenant_id,
        recipient_user_id=recipient_user_id,
        event_type=event_type,
        title=title,
        body=body,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        channel=channel,
    )
    db.add(note)
    await db.flush()
    return note
