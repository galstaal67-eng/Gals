from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db, require
from app.core.audit import record_audit
from app.core.rbac import Permission
from app.core.security import hash_password
from app.models.enums import AuditAction, AuthProvider
from app.models.user import User
from app.schemas.user import UserCreate, UserOut

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserOut])
async def list_users(
    user: CurrentUser = Depends(require(Permission.USER_CREATE)),
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
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "password required for local auth"
        )

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
