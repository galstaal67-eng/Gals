import pytest
from app.scripts import bootstrap as bootstrap_mod


@pytest.mark.asyncio
async def test_bootstrap_creates_tenant_and_admin(client, sessionmaker, monkeypatch):
    # point the script at the in-memory test session
    monkeypatch.setattr(bootstrap_mod, "SessionLocal", sessionmaker)

    await bootstrap_mod.bootstrap(
        name="Entropy",
        subdomain="entropy",
        admin_email="admin@entropy.com",
        admin_password="strong-pass-1",
        ad_tenant_id=None,
    )

    # the bootstrapped admin can log in
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@entropy.com", "password": "strong-pass-1", "subdomain": "entropy"},
    )
    assert login.status_code == 200
    assert login.json()["access_token"]


@pytest.mark.asyncio
async def test_bootstrap_is_idempotent(sessionmaker, monkeypatch, capsys):
    monkeypatch.setattr(bootstrap_mod, "SessionLocal", sessionmaker)
    args = dict(
        name="Entropy",
        subdomain="entropy",
        admin_email="admin@entropy.com",
        admin_password="strong-pass-1",
        ad_tenant_id=None,
    )
    await bootstrap_mod.bootstrap(**args)
    await bootstrap_mod.bootstrap(**args)
    assert "already exists" in capsys.readouterr().out
