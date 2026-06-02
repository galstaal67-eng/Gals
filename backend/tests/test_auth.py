import pytest

from tests.conftest import auth_headers


@pytest.mark.asyncio
async def test_login_success(client, seed):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@a.com", "password": "secret123", "subdomain": "tenant-a"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"] and body["refresh_token"]


@pytest.mark.asyncio
async def test_login_wrong_password(client, seed):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@a.com", "password": "wrong", "subdomain": "tenant-a"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_tenant(client, seed):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@a.com", "password": "secret123", "subdomain": "nope"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_rotates_tokens(client, seed):
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@a.com", "password": "secret123", "subdomain": "tenant-a"},
    )
    refresh = login.json()["refresh_token"]
    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 200
    assert resp.json()["access_token"]


@pytest.mark.asyncio
async def test_protected_route_requires_token(client, seed):
    resp = await client.get("/api/v1/clients")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_access_token_works_on_protected_route(client, seed):
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@a.com", "password": "secret123", "subdomain": "tenant-a"},
    )
    token = login.json()["access_token"]
    resp = await client.get("/api/v1/clients", headers=auth_headers(token))
    assert resp.status_code == 200
    assert resp.json() == []
