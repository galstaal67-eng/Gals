import uuid

from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid
from app.db.types import GUID


class EmailMessage(Base, TimestampMixin):
    """הודעת דוא\"ל יוצאת. נשמרת כרשומה; שכבת ה-dispatch (Graph/SMTP) שולחת בפועל.

    status: queued (ממתין לשליחה) / sent / failed. ב-MVP נשמר queued ונשלף ע"י
    מנגנון השליחה. שומר Audit Trail מלא של ההתנהלות מול הלקוח (דרישת SOX).
    """

    __tablename__ = "email_messages"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    to_email: Mapped[str] = mapped_column(String(320), nullable=False)
    cc_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    subject: Mapped[str] = mapped_column(String(512), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    related_entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    related_entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    message_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    in_reply_to: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    direction: Mapped[str] = mapped_column(String(8), default="outbound", nullable=False)
    from_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sent_by_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
