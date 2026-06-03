from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, get_db
from app.core.security import new_totp_secret, totp_provisioning_uri, verify_totp
from app.models.user import User
from app.schemas.auth import MFAEnableRequest, MFASetupResponse

router = APIRouter(prefix="/auth/mfa", tags=["auth"])


@router.post("/setup", response_model=MFASetupResponse)
async def mfa_setup(
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a TOTP secret for the current user and return its provisioning URI.

    MFA is only switched on after the user confirms a code via /auth/mfa/enable.
    """
    user = await db.get(User, current.id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    secret = new_totp_secret()
    user.mfa_secret = secret
    await db.commit()
    return MFASetupResponse(
        secret=secret, provisioning_uri=totp_provisioning_uri(secret, user.email)
    )


@router.post("/enable", status_code=status.HTTP_204_NO_CONTENT)
async def mfa_enable(
    body: MFAEnableRequest,
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, current.id)
    if user is None or not user.mfa_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "run /auth/mfa/setup first")
    if not verify_totp(user.mfa_secret, body.code):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid code")
    user.mfa_enabled = True
    await db.commit()
