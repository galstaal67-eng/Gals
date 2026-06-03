import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


@pytest.mark.asyncio
async def test_admin_updates_user_role(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    target = str(seed["a"]["client"])
    resp = await client.patch(
        f"/api/v1/users/{target}", json={"role": "consultant"}, headers=auth_headers(token)
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "consultant"


@pytest.mark.asyncio
async def test_admin_deactivates_user(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    target = str(seed["a"]["client"])
    resp = await client.post(f"/api/v1/users/{target}/deactivate", headers=auth_headers(token))
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    # deactivated local user can no longer log in
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "client@a.com", "password": "secret123", "subdomain": "tenant-a"},
    )
    assert login.status_code == 401


@pytest.mark.asyncio
async def test_manager_can_view_but_not_edit_permissions(client, seed):
    # promote the client user to manager via admin
    admin = await _login(client, "admin@a.com", "tenant-a")
    target = str(seed["a"]["client"])
    await client.patch(
        f"/api/v1/users/{target}", json={"role": "manager"}, headers=auth_headers(admin)
    )
    mgr = await _login(client, "client@a.com", "tenant-a")
    # manager may list users
    assert (await client.get("/api/v1/users", headers=auth_headers(mgr))).status_code == 200
    # but may not edit permissions
    other = str(seed["a"]["consultant"])
    resp = await client.patch(
        f"/api/v1/users/{other}", json={"role": "admin"}, headers=auth_headers(mgr)
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_cannot_update_user_in_other_tenant(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    target_b = str(seed["b"]["client"])
    resp = await client.patch(
        f"/api/v1/users/{target_b}", json={"role": "consultant"}, headers=auth_headers(token)
    )
    assert resp.status_code == 404
