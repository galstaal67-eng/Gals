import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _make_client(client, token, name="Acme"):
    r = await client.post("/api/v1/clients", json={"name": name}, headers=auth_headers(token))
    return r.json()["id"]


@pytest.mark.asyncio
async def test_create_and_list_audit_years(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    cid = await _make_client(client, token)
    r = await client.post(
        f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(token)
    )
    assert r.status_code == 201
    listing = await client.get(
        f"/api/v1/clients/{cid}/audit-years", headers=auth_headers(token)
    )
    assert [y["year"] for y in listing.json()] == [2026]


@pytest.mark.asyncio
async def test_duplicate_year_rejected(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    cid = await _make_client(client, token)
    await client.post(
        f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(token)
    )
    dup = await client.post(
        f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(token)
    )
    assert dup.status_code == 409


@pytest.mark.asyncio
async def test_materiality_computed_threshold(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    cid = await _make_client(client, token)
    yr = (
        await client.post(
            f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(token)
        )
    ).json()["id"]
    r = await client.post(
        f"/api/v1/audit-years/{yr}/materiality-parameters",
        json={"slot": 1, "parameter_type": "sales", "value": "1000", "percentage": "0.05"},
        headers=auth_headers(token),
    )
    assert r.status_code == 201
    assert float(r.json()["computed_threshold"]) == 50.0


@pytest.mark.asyncio
async def test_parameter_type_unique_per_year(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    cid = await _make_client(client, token)
    yr = (
        await client.post(
            f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(token)
        )
    ).json()["id"]
    body = {"slot": 1, "parameter_type": "sales", "value": "1000", "percentage": "0.05"}
    await client.post(
        f"/api/v1/audit-years/{yr}/materiality-parameters", json=body, headers=auth_headers(token)
    )
    body2 = {"slot": 2, "parameter_type": "sales", "value": "2000", "percentage": "0.03"}
    dup = await client.post(
        f"/api/v1/audit-years/{yr}/materiality-parameters", json=body2, headers=auth_headers(token)
    )
    assert dup.status_code == 409


@pytest.mark.asyncio
async def test_lock_blocks_edits(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    cid = await _make_client(client, token)
    yr = (
        await client.post(
            f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(token)
        )
    ).json()["id"]
    lock = await client.post(f"/api/v1/audit-years/{yr}/lock", headers=auth_headers(token))
    assert lock.status_code == 200
    assert lock.json()["status"] == "locked"

    blocked = await client.post(
        f"/api/v1/audit-years/{yr}/materiality-parameters",
        json={"slot": 1, "parameter_type": "assets", "value": "1", "percentage": "0.1"},
        headers=auth_headers(token),
    )
    assert blocked.status_code == 409


@pytest.mark.asyncio
async def test_clone_from_previous_year(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    cid = await _make_client(client, token)
    y2025 = (
        await client.post(
            f"/api/v1/clients/{cid}/audit-years", json={"year": 2025}, headers=auth_headers(token)
        )
    ).json()["id"]
    await client.post(
        f"/api/v1/audit-years/{y2025}/materiality-parameters",
        json={"slot": 1, "parameter_type": "sales", "value": "1000", "percentage": "0.05"},
        headers=auth_headers(token),
    )
    y2026 = (
        await client.post(
            f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(token)
        )
    ).json()["id"]
    clone = await client.post(
        f"/api/v1/audit-years/{y2026}/clone-from-previous", headers=auth_headers(token)
    )
    assert clone.status_code == 200
    params = (
        await client.get(
            f"/api/v1/audit-years/{y2026}/materiality-parameters", headers=auth_headers(token)
        )
    ).json()
    assert len(params) == 1
    assert params[0]["parameter_type"] == "sales"


@pytest.mark.asyncio
async def test_client_user_cannot_create_year(client, seed):
    admin = await _login(client, "admin@a.com", "tenant-a")
    cid = await _make_client(client, admin)
    ct = await _login(client, "client@a.com", "tenant-a")
    r = await client.post(
        f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(ct)
    )
    assert r.status_code == 403
