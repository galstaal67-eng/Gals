import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.audit import record_audit
from app.core.rbac import Permission
from app.models.client import Client
from app.models.enums import AuditAction
from app.schemas.client import ClientCreate, ClientOut, ClientUpdate

router = APIRouter(prefix="/clients", tags=["clients"])


async def _get_client(db: AsyncSession, tenant_id: uuid.UUID, client_id: uuid.UUID) -> Client:
    client = (
        await db.execute(
            select(Client).where(
                Client.id == client_id,
                Client.tenant_id == tenant_id,
                Client.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not client:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "client not found")
    return client


@router.get("", response_model=list[ClientOut])
async def list_clients(
    user: CurrentUser = Depends(require(Permission.CLIENT_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Client).where(Client.tenant_id == user.tenant_id, Client.deleted_at.is_(None))
        )
    ).scalars().all()
    return rows


@router.get("/{client_id}", response_model=ClientOut)
async def get_client(
    client_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.CLIENT_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    return await _get_client(db, user.tenant_id, client_id)


@router.post("", response_model=ClientOut, status_code=status.HTTP_201_CREATED)
async def create_client(
    body: ClientCreate,
    user: CurrentUser = Depends(require(Permission.CLIENT_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    client = Client(tenant_id=user.tenant_id, **body.model_dump())
    db.add(client)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="client",
        entity_id=client.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after=body.model_dump(),
    )
    await db.commit()
    await db.refresh(client)
    return client


@router.patch("/{client_id}", response_model=ClientOut)
async def update_client(
    client_id: uuid.UUID,
    body: ClientUpdate,
    user: CurrentUser = Depends(require(Permission.CLIENT_EDIT)),
    db: AsyncSession = Depends(get_db),
):
    client = await _get_client(db, user.tenant_id, client_id)
    changes = body.model_dump(exclude_unset=True)
    before = {k: getattr(client, k) for k in changes}
    for key, value in changes.items():
        setattr(client, key, value)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="client",
        entity_id=client.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        before=before,
        after=changes,
    )
    await db.commit()
    await db.refresh(client)
    return client


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_client(
    client_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.CLIENT_DELETE)),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete only (SOX) — sets deleted_at, never physical delete."""
    client = await _get_client(db, user.tenant_id, client_id)
    client.deleted_at = datetime.now(UTC)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.DELETE,
        entity_type="client",
        entity_id=client.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
    )
    await db.commit()
