import pyotp
import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()


@pytest.mark.asyncio
async def test_mfa_setup_enable_and_login_challenge(client, seed):
    token = (await _login(client, "client@a.com", "tenant-a"))["access_token"]

    # 1. setup -> get secret
    setup = await client.post("/api/v1/auth/mfa/setup", headers=auth_headers(token))
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    assert setup.json()["provisioning_uri"].startswith("otpauth://")

    # 2. enable with a valid TOTP code
    code = pyotp.TOTP(secret).now()
    enable = await client.post(
        "/api/v1/auth/mfa/enable", json={"code": code}, headers=auth_headers(token)
    )
    assert enable.status_code == 204

    # 3. subsequent login now returns an MFA challenge instead of tokens
    login = await _login(client, "client@a.com", "tenant-a")
    assert login.get("mfa_required") is True
    mfa_token = login["mfa_token"]

    # 4. verify the challenge -> tokens
    verify = await client.post(
        "/api/v1/auth/mfa/verify",
        json={"mfa_token": mfa_token, "code": pyotp.TOTP(secret).now()},
    )
    assert verify.status_code == 200
    assert verify.json()["access_token"]


@pytest.mark.asyncio
async def test_mfa_enable_requires_setup_first(client, seed):
    token = (await _login(client, "admin@a.com", "tenant-a"))["access_token"]
    resp = await client.post(
        "/api/v1/auth/mfa/enable", json={"code": "000000"}, headers=auth_headers(token)
    )
    assert resp.status_code == 400
