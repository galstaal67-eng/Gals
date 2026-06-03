import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_public_db
from app.config import settings
from app.core import entra
from app.core.audit import record_audit
from app.core.security import (
    create_access_token,
    create_refresh_token,
    create_sso_state,
    decode_token,
    verify_password,
    verify_totp,
)
from app.db.session import set_tenant
from app.models.enums import AuditAction, AuthProvider
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    MFARequiredResponse,
    MFAVerifyRequest,
    RefreshRequest,
    SSOLoginResponse,
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


@router.get("/sso/entra/login", response_model=SSOLoginResponse)
async def sso_entra_login(subdomain: str):
    """Return the Entra authorize URL the SPA should redirect the browser to."""
    state = create_sso_state(subdomain)
    return SSOLoginResponse(authorize_url=entra.authorize_url(state, settings.entra_redirect_uri))


@router.get("/sso/entra/callback", response_model=TokenResponse)
async def sso_entra_callback(code: str, state: str, db: AsyncSession = Depends(get_public_db)):
    payload = decode_token(state)
    if not payload or payload.get("type") != "sso_state":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid sso state")
    subdomain = payload["subdomain"]

    claims = await entra.fetch_claims_for_code(code, settings.entra_redirect_uri)
    email = claims.get("email")
    if not email:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "no email claim from idp")

    tenant = (
        await db.execute(select(Tenant).where(Tenant.subdomain == subdomain))
    ).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown tenant")
    await set_tenant(db, str(tenant.id))

    user = (
        await db.execute(
            select(User).where(
                User.tenant_id == tenant.id,
                User.email == email,
                User.auth_provider == AuthProvider.ENTRA,
            )
        )
    ).scalar_one_or_none()
    if not user or not user.is_active:
        # SSO users are provisioned by an admin first (no auto-provisioning).
        raise HTTPException(status.HTTP_403_FORBIDDEN, "user not provisioned for sso")

    return await _issue_tokens(db, user)
