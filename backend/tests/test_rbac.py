import pytest
from app.core.rbac import Permission, has_permission
from app.models.enums import UserRole

from tests.conftest import auth_headers


def test_permission_matrix():
    assert has_permission(UserRole.ADMIN, Permission.CLIENT_DELETE)
    assert not has_permission(UserRole.MANAGER, Permission.CLIENT_DELETE)
    assert has_permission(UserRole.MANAGER, Permission.CLIENT_CREATE)
    assert not has_permission(UserRole.CLIENT, Permission.CLIENT_CREATE)
    assert has_permission(UserRole.AUDITOR, Permission.REPORT_EXPORT)
    assert not has_permission(UserRole.AUDITOR, Permission.CLIENT_VIEW)


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


@pytest.mark.asyncio
async def test_client_user_cannot_create_client(client, seed):
    token = await _login(client, "client@a.com", "tenant-a")
    resp = await client.post(
        "/api/v1/clients", json={"name": "Acme"}, headers=auth_headers(token)
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_create_client(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    resp = await client.post(
        "/api/v1/clients", json={"name": "Acme"}, headers=auth_headers(token)
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Acme"


@pytest.mark.asyncio
async def test_client_user_cannot_delete_client(client, seed):
    admin = await _login(client, "admin@a.com", "tenant-a")
    created = await client.post(
        "/api/v1/clients", json={"name": "Acme"}, headers=auth_headers(admin)
    )
    cid = created.json()["id"]
    client_token = await _login(client, "client@a.com", "tenant-a")
    resp = await client.delete(f"/api/v1/clients/{cid}", headers=auth_headers(client_token))
    assert resp.status_code == 403
