import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Permission, has_permission
from app.core.security import decode_token
from app.db.session import SessionLocal, set_tenant
from app.models.enums import UserRole

bearer = HTTPBearer(auto_error=True)


@dataclass
class CurrentUser:
    id: uuid.UUID
    tenant_id: uuid.UUID
    role: UserRole


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
) -> CurrentUser:
    payload = decode_token(creds.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
    try:
        return CurrentUser(
            id=uuid.UUID(payload["sub"]),
            tenant_id=uuid.UUID(payload["tenant_id"]),
            role=UserRole(payload["role"]),
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed token") from exc


async def get_db(
    user: CurrentUser = Depends(get_current_user),
) -> AsyncGenerator[AsyncSession, None]:
    """Session with the RLS tenant context set from the JWT."""
    async with SessionLocal() as session:
        await set_tenant(session, str(user.tenant_id))
        yield session


async def get_public_db() -> AsyncGenerator[AsyncSession, None]:
    """Session for pre-auth endpoints (login/mfa/refresh). Tenant set by caller."""
    async with SessionLocal() as session:
        yield session


def require(permission: Permission):
    """Dependency factory enforcing a coarse RBAC permission."""

    async def _checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not has_permission(user.role, permission):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, f"missing permission: {permission.value}"
            )
        return user

    return _checker
