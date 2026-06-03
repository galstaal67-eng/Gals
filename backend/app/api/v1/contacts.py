import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.audit import record_audit
from app.core.rbac import Permission
from app.models.client import Client
from app.models.contact import Contact
from app.models.enums import AuditAction
from app.schemas.contact import ContactCreate, ContactOut, ContactUpdate

router = APIRouter(prefix="/clients/{client_id}/contacts", tags=["contacts"])


async def _ensure_client(db: AsyncSession, tenant_id: uuid.UUID, client_id: uuid.UUID) -> None:
    exists = (
        await db.execute(
            select(Client.id).where(
                Client.id == client_id,
                Client.tenant_id == tenant_id,
                Client.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not exists:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")


async def _get_contact(
    db: AsyncSession, tenant_id: uuid.UUID, client_id: uuid.UUID, contact_id: uuid.UUID
) -> Contact:
    contact = (
        await db.execute(
            select(Contact).where(
                Contact.id == contact_id,
                Contact.client_id == client_id,
                Contact.tenant_id == tenant_id,
                Contact.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not contact:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "contact not found")
    return contact


@router.get("", response_model=list[ContactOut])
async def list_contacts(
    client_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.CONTACT_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_client(db, user.tenant_id, client_id)
    rows = (
        await db.execute(
            select(Contact).where(
                Contact.client_id == client_id,
                Contact.tenant_id == user.tenant_id,
                Contact.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    return rows


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def create_contact(
    client_id: uuid.UUID,
    body: ContactCreate,
    user: CurrentUser = Depends(require(Permission.CONTACT_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_client(db, user.tenant_id, client_id)
    payload = body.model_dump()
    if payload.get("email") is not None:
        payload["email"] = str(payload["email"])
    contact = Contact(tenant_id=user.tenant_id, client_id=client_id, **payload)
    db.add(contact)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="contact",
        entity_id=contact.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"full_name": contact.full_name},
    )
    await db.commit()
    await db.refresh(contact)
    return contact


@router.patch("/{contact_id}", response_model=ContactOut)
async def update_contact(
    client_id: uuid.UUID,
    contact_id: uuid.UUID,
    body: ContactUpdate,
    user: CurrentUser = Depends(require(Permission.CONTACT_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    contact = await _get_contact(db, user.tenant_id, client_id, contact_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("email") is not None:
        changes["email"] = str(changes["email"])
    for key, value in changes.items():
        setattr(contact, key, value)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="contact",
        entity_id=contact.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={k: str(v) for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(contact)
    return contact


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    client_id: uuid.UUID,
    contact_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.CONTACT_MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete only (SOX)."""
    contact = await _get_contact(db, user.tenant_id, client_id, contact_id)
    contact.deleted_at = datetime.now(UTC)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.DELETE,
        entity_type="contact",
        entity_id=contact.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
    )
    await db.commit()
