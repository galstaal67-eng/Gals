import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.audit import record_audit
from app.core.rbac import Permission
from app.core.security import hash_password
from app.models.enums import AuditAction, AuthProvider
from app.models.user import User
from app.schemas.user import UserCreate, UserOut, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


async def _get_user(db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> User:
    target = (
        await db.execute(
            select(User).where(
                User.id == user_id,
                User.tenant_id == tenant_id,
                User.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return target


@router.get("", response_model=list[UserOut])
async def list_users(
    user: CurrentUser = Depends(require(Permission.USER_VIEW)),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(User).where(User.tenant_id == user.tenant_id, User.deleted_at.is_(None))
        )
    ).scalars().all()
    return rows


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    user: CurrentUser = Depends(require(Permission.USER_CREATE)),
    db: AsyncSession = Depends(get_db),
):
    if body.auth_provider == AuthProvider.LOCAL and not body.password:
        raise HTTPException(422, "password required for local auth")

    new_user = User(
        tenant_id=user.tenant_id,
        email=body.email,
        full_name=body.full_name,
        role=body.role,
        client_subrole=body.client_subrole,
        auth_provider=body.auth_provider,
        hashed_password=hash_password(body.password) if body.password else None,
    )
    db.add(new_user)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="user",
        entity_id=new_user.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"email": body.email, "role": body.role.value},
    )
    await db.commit()
    await db.refresh(new_user)
    return new_user


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    user: CurrentUser = Depends(require(Permission.USER_EDIT_PERMISSIONS)),
    db: AsyncSession = Depends(get_db),
):
    target = await _get_user(db, user.tenant_id, user_id)
    changes = body.model_dump(exclude_unset=True)
    before = {k: getattr(target, k) for k in changes}
    for key, value in changes.items():
        setattr(target, key, value)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="user",
        entity_id=target.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        before={k: (v.value if hasattr(v, "value") else v) for k, v in before.items()},
        after={k: (v.value if hasattr(v, "value") else v) for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(target)
    return target


@router.post("/{user_id}/deactivate", response_model=UserOut)
async def deactivate_user(
    user_id: uuid.UUID,
    user: CurrentUser = Depends(require(Permission.USER_DEACTIVATE)),
    db: AsyncSession = Depends(get_db),
):
    target = await _get_user(db, user.tenant_id, user_id)
    target.is_active = False
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.UPDATE,
        entity_type="user",
        entity_id=target.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        after={"is_active": False},
    )
    await db.commit()
    await db.refresh(target)
    return target
