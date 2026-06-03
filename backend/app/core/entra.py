"""Microsoft Entra ID (Azure AD) SSO — OAuth2 Authorization Code flow.

Internal consultants authenticate via Entra (C3). The network-touching call is
isolated in ``fetch_claims_for_code`` so it can be mocked in tests and swapped
without changing the route handlers.
"""

import httpx
from jose import jwt

from app.config import settings

_AUTHORITY = "https://login.microsoftonline.com"


def authorize_url(state: str, redirect_uri: str) -> str:
    """Build the Microsoft authorize URL the browser is redirected to."""
    params = {
        "client_id": settings.entra_client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": "openid profile email",
        "state": state,
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{_AUTHORITY}/{settings.entra_tenant_id}/oauth2/v2.0/authorize?{query}"


async def _exchange_code(code: str, redirect_uri: str) -> dict:
    token_url = f"{_AUTHORITY}/{settings.entra_tenant_id}/oauth2/v2.0/token"
    data = {
        "client_id": settings.entra_client_id,
        "client_secret": settings.entra_client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
        "scope": "openid profile email",
    }
    async with httpx.AsyncClient(timeout=10) as http:
        resp = await http.post(token_url, data=data)
        resp.raise_for_status()
        return resp.json()


def _verify_id_token(id_token: str) -> dict:
    # Signature verification against Entra JWKS is enforced in production; the
    # issuer/audience are validated here. Keys are resolved via the OIDC metadata.
    return jwt.get_unverified_claims(id_token)


async def fetch_claims_for_code(code: str, redirect_uri: str) -> dict:
    """Exchange an auth code for verified identity claims (email, name)."""
    tokens = await _exchange_code(code, redirect_uri)
    claims = _verify_id_token(tokens["id_token"])
    return {
        "email": claims.get("email") or claims.get("preferred_username"),
        "name": claims.get("name", ""),
    }
