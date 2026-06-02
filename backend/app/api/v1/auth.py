import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_public_db
from app.core.audit import record_audit
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
    verify_totp,
)
from app.db.session import set_tenant
from app.models.enums import AuditAction
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    MFARequiredResponse,
    MFAVerifyRequest,
    RefreshRequest,
    TokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# Short-lived in-memory MFA challenge store (replace with Redis in production).
_mfa_challenges: dict[str, str] = {}


async def _issue_tokens(session: AsyncSession, user: User) -> TokenResponse:
    user.last_login_at = datetime.now(UTC)
    await record_audit(
        session,
        action=AuditAction.LOGIN,
        entity_type="user",
        entity_id=user.id,
        tenant_id=user.tenant_id,
        user_id=user.id,
    )
    await session.commit()
    return TokenResponse(
        access_token=create_access_token(
            user_id=str(user.id), tenant_id=str(user.tenant_id), role=user.role.value
        ),
        refresh_token=create_refresh_token(
            user_id=str(user.id), tenant_id=str(user.tenant_id), role=user.role.value
        ),
    )


@router.post("/login", responses={200: {"model": TokenResponse}})
async def login(body: LoginRequest, db: AsyncSession = Depends(get_public_db)):
    """Local login (clients/auditors). Entra/SSO users use the SSO flow."""
    tenant = (
        await db.execute(select(Tenant).where(Tenant.subdomain == body.subdomain))
    ).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    await set_tenant(db, str(tenant.id))
    user = (
        await db.execute(
            select(User).where(User.tenant_id == tenant.id, User.email == body.email)
        )
    ).scalar_one_or_none()
    if (
        not user
        or not user.is_active
        or not user.hashed_password
        or not verify_password(body.password, user.hashed_password)
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")

    if user.mfa_enabled:
        mfa_token = secrets.token_urlsafe(32)
        _mfa_challenges[mfa_token] = str(user.id)
        return MFARequiredResponse(mfa_token=mfa_token)

    return await _issue_tokens(db, user)


@router.post("/mfa/verify", response_model=TokenResponse)
async def mfa_verify(body: MFAVerifyRequest, db: AsyncSession = Depends(get_public_db)):
    user_id = _mfa_challenges.get(body.mfa_token)
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired mfa token")
    user = await db.get(User, user_id)
    if not user or not user.mfa_secret or not verify_totp(user.mfa_secret, body.code):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid code")
    await set_tenant(db, str(user.tenant_id))
    _mfa_challenges.pop(body.mfa_token, None)
    return await _issue_tokens(db, user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest):
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid refresh token")
    role = payload["role"]
    return TokenResponse(
        access_token=create_access_token(
            user_id=payload["sub"], tenant_id=payload["tenant_id"], role=role
        ),
        refresh_token=create_refresh_token(
            user_id=payload["sub"], tenant_id=payload["tenant_id"], role=role
        ),
    )
