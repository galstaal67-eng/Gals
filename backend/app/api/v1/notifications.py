import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, get_db
from app.models.notification import Notification
from app.schemas.notification import NotificationOut

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    unread: bool = False,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Notification).where(
        Notification.recipient_user_id == user.id,
        Notification.tenant_id == user.tenant_id,
    )
    if unread:
        stmt = stmt.where(Notification.read_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc())
    return (await db.execute(stmt)).scalars().all()


@router.post("/{note_id}/read", response_model=NotificationOut)
async def mark_read(
    note_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    note = (
        await db.execute(
            select(Notification).where(
                Notification.id == note_id,
                Notification.recipient_user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not note:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "notification not found")
    if note.read_at is None:
        note.read_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(note)
    return note


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(Notification)
        .where(
            Notification.recipient_user_id == user.id,
            Notification.tenant_id == user.tenant_id,
            Notification.read_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )
    await db.commit()
