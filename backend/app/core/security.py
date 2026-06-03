from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import pyotp
from jose import JWTError, jwt

from app.config import settings


def hash_password(password: str) -> str:
    # bcrypt operates on the first 72 bytes; encode then hash.
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _create_token(subject: str, claims: dict[str, Any], expires_delta: timedelta) -> str:
    now = datetime.now(UTC)
    payload = {**claims, "sub": subject, "iat": now, "exp": now + expires_delta}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(*, user_id: str, tenant_id: str, role: str) -> str:
    return _create_token(
        user_id,
        {"tenant_id": tenant_id, "role": role, "type": "access"},
        timedelta(minutes=settings.access_token_expire_minutes),
    )


def create_refresh_token(*, user_id: str, tenant_id: str, role: str) -> str:
    return _create_token(
        user_id,
        {"tenant_id": tenant_id, "role": role, "type": "refresh"},
        timedelta(days=settings.refresh_token_expire_days),
    )


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


def verify_totp(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, email: str, issuer: str = "SOX System") -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)


def create_sso_state(subdomain: str) -> str:
    return _create_token(
        "sso", {"subdomain": subdomain, "type": "sso_state"}, timedelta(minutes=10)
    )
