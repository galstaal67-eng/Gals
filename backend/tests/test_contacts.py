import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _make_client(client, token, name="Acme"):
    resp = await client.post("/api/v1/clients", json={"name": name}, headers=auth_headers(token))
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_manager_creates_and_lists_contacts(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    cid = await _make_client(client, token)
    created = await client.post(
        f"/api/v1/clients/{cid}/contacts",
        json={"full_name": "Dana Levi", "role_title": "CFO", "email": "dana@a.com"},
        headers=auth_headers(token),
    )
    assert created.status_code == 201
    assert created.json()["full_name"] == "Dana Levi"

    listing = await client.get(f"/api/v1/clients/{cid}/contacts", headers=auth_headers(token))
    assert listing.status_code == 200
    assert len(listing.json()) == 1


@pytest.mark.asyncio
async def test_client_user_cannot_create_contact(client, seed):
    admin = await _login(client, "admin@a.com", "tenant-a")
    cid = await _make_client(client, admin)
    client_token = await _login(client, "client@a.com", "tenant-a")
    resp = await client.post(
        f"/api/v1/clients/{cid}/contacts",
        json={"full_name": "X"},
        headers=auth_headers(client_token),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_contact_soft_delete(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    cid = await _make_client(client, token)
    c = await client.post(
        f"/api/v1/clients/{cid}/contacts",
        json={"full_name": "Temp"},
        headers=auth_headers(token),
    )
    contact_id = c.json()["id"]
    resp = await client.delete(
        f"/api/v1/clients/{cid}/contacts/{contact_id}", headers=auth_headers(token)
    )
    assert resp.status_code == 204
    listing = await client.get(f"/api/v1/clients/{cid}/contacts", headers=auth_headers(token))
    assert listing.json() == []
