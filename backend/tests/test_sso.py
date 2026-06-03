import pytest
from app.core import entra


@pytest.mark.asyncio
async def test_sso_login_returns_authorize_url(client, seed):
    resp = await client.get("/api/v1/auth/sso/entra/login", params={"subdomain": "tenant-a"})
    assert resp.status_code == 200
    assert "oauth2/v2.0/authorize" in resp.json()["authorize_url"]


@pytest.mark.asyncio
async def test_sso_callback_logs_in_provisioned_entra_user(client, seed, monkeypatch):
    # get a signed state via the login endpoint
    login = await client.get("/api/v1/auth/sso/entra/login", params={"subdomain": "tenant-a"})
    url = login.json()["authorize_url"]
    state = url.split("state=")[1]

    async def fake_claims(code, redirect_uri):
        return {"email": seed["a"]["consultant_email"], "name": "Consultant"}

    monkeypatch.setattr(entra, "fetch_claims_for_code", fake_claims)

    resp = await client.get(
        "/api/v1/auth/sso/entra/callback", params={"code": "abc", "state": state}
    )
    assert resp.status_code == 200
    assert resp.json()["access_token"]


@pytest.mark.asyncio
async def test_sso_callback_rejects_unprovisioned_user(client, seed, monkeypatch):
    login = await client.get("/api/v1/auth/sso/entra/login", params={"subdomain": "tenant-a"})
    state = login.json()["authorize_url"].split("state=")[1]

    async def fake_claims(code, redirect_uri):
        return {"email": "stranger@a.com", "name": "Stranger"}

    monkeypatch.setattr(entra, "fetch_claims_for_code", fake_claims)

    resp = await client.get(
        "/api/v1/auth/sso/entra/callback", params={"code": "abc", "state": state}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_sso_callback_rejects_bad_state(client, seed):
    resp = await client.get(
        "/api/v1/auth/sso/entra/callback", params={"code": "abc", "state": "garbage"}
    )
    assert resp.status_code == 400
