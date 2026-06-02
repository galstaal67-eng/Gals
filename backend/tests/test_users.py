import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


@pytest.mark.asyncio
async def test_admin_creates_local_user(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    resp = await client.post(
        "/api/v1/users",
        json={
            "email": "new@a.com",
            "full_name": "New User",
            "role": "consultant",
            "auth_provider": "local",
            "password": "pw12345678",
        },
        headers=auth_headers(token),
    )
    assert resp.status_code == 201
    assert resp.json()["email"] == "new@a.com"
    assert resp.json()["role"] == "consultant"


@pytest.mark.asyncio
async def test_local_user_requires_password(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    resp = await client.post(
        "/api/v1/users",
        json={"email": "x@a.com", "full_name": "X", "role": "client", "auth_provider": "local"},
        headers=auth_headers(token),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_non_admin_cannot_list_users(client, seed):
    token = await _login(client, "client@a.com", "tenant-a")
    resp = await client.get("/api/v1/users", headers=auth_headers(token))
    assert resp.status_code == 403
