"""Microsoft Entra ID (Azure AD) SSO — OAuth2 Authorization Code flow.

Internal consultants authenticate via Entra (C3). The network-touching calls are
isolated in ``fetch_claims_for_code`` so it can be mocked in tests and swapped
without changing the route handlers. The id_token signature is verified against
Entra's published JWKS, with issuer and audience validation.
"""

import httpx
from jose import jwt

from app.config import settings

_AUTHORITY = "https://login.microsoftonline.com"


def _tenant_base() -> str:
    return f"{_AUTHORITY}/{settings.entra_tenant_id}"


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
    return f"{_tenant_base()}/oauth2/v2.0/authorize?{query}"


async def _exchange_code(code: str, redirect_uri: str) -> dict:
    data = {
        "client_id": settings.entra_client_id,
        "client_secret": settings.entra_client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
        "scope": "openid profile email",
    }
    async with httpx.AsyncClient(timeout=10) as http:
        resp = await http.post(f"{_tenant_base()}/oauth2/v2.0/token", data=data)
        resp.raise_for_status()
        return resp.json()


async def _fetch_jwks() -> dict:
    async with httpx.AsyncClient(timeout=10) as http:
        resp = await http.get(f"{_tenant_base()}/discovery/v2.0/keys")
        resp.raise_for_status()
        return resp.json()


async def _verify_id_token(id_token: str) -> dict:
    """Verify the id_token signature (RS256) against Entra JWKS + iss/aud."""
    header = jwt.get_unverified_header(id_token)
    jwks = await _fetch_jwks()
    key = next((k for k in jwks["keys"] if k["kid"] == header["kid"]), None)
    if key is None:
        raise ValueError("no matching JWKS key for id_token")
    return jwt.decode(
        id_token,
        key,
        algorithms=["RS256"],
        audience=settings.entra_client_id,
        issuer=f"https://login.microsoftonline.com/{settings.entra_tenant_id}/v2.0",
    )


async def fetch_claims_for_code(code: str, redirect_uri: str) -> dict:
    """Exchange an auth code for verified identity claims (email, name)."""
    tokens = await _exchange_code(code, redirect_uri)
    claims = await _verify_id_token(tokens["id_token"])
    return {
        "email": claims.get("email") or claims.get("preferred_username"),
        "name": claims.get("name", ""),
    }
