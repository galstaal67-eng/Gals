import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


@pytest.mark.asyncio
async def test_admin_onboards_new_tenant_with_admin(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    resp = await client.post(
        "/api/v1/tenants",
        json={
            "name": "New Org",
            "subdomain": "new-org",
            "admin_email": "root@new.com",
            "admin_full_name": "Root",
            "admin_password": "pw12345678",
        },
        headers=auth_headers(token),
    )
    assert resp.status_code == 201
    assert resp.json()["subdomain"] == "new-org"

    # the seeded admin for the new tenant can log in
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "root@new.com", "password": "pw12345678", "subdomain": "new-org"},
    )
    assert login.status_code == 200


@pytest.mark.asyncio
async def test_duplicate_subdomain_rejected(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    resp = await client.post(
        "/api/v1/tenants",
        json={
            "name": "Dup",
            "subdomain": "tenant-b",
            "admin_email": "x@x.com",
            "admin_full_name": "X",
            "admin_password": "pw12345678",
        },
        headers=auth_headers(token),
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_client_user_cannot_create_tenant(client, seed):
    token = await _login(client, "client@a.com", "tenant-a")
    resp = await client.post(
        "/api/v1/tenants",
        json={
            "name": "Nope",
            "subdomain": "nope",
            "admin_email": "x@x.com",
            "admin_full_name": "X",
            "admin_password": "pw12345678",
        },
        headers=auth_headers(token),
    )
    assert resp.status_code == 403
