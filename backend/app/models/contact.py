import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, new_uuid
from app.db.types import GUID


class Contact(Base, TimestampMixin, SoftDeleteMixin):
    """בנק אנשי קשר ללקוח (שם מלא, תפקיד, מייל, טלפון, מנהל ישיר, חברת בת)."""

    __tablename__ = "contacts"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tenants.id"), nullable=False, index=True
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("clients.id"), nullable=False, index=True
    )
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    manager_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # חברת בת — nullable until Phase 2 introduces the subsidiaries table proper.
    subsidiary_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
