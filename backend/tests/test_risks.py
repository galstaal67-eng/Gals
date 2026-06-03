import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _selection(client, token, category="business"):
    cid = (
        await client.post("/api/v1/clients", json={"name": "Acme"}, headers=auth_headers(token))
    ).json()["id"]
    yr = (
        await client.post(
            f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(token)
        )
    ).json()["id"]
    sid = (
        await client.post(
            f"/api/v1/audit-years/{yr}/subsidiaries",
            json={"name": "Sub"},
            headers=auth_headers(token),
        )
    ).json()["id"]
    pid = (
        await client.post(
            "/api/v1/processes/bank",
            json={"name_he": "תהליך", "category": category},
            headers=auth_headers(token),
        )
    ).json()["id"]
    psel = (
        await client.post(
            f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/process-selections",
            json={"process_id": pid},
            headers=auth_headers(token),
        )
    ).json()["id"]
    return psel


async def _bank_risk(client, token, name="סיכון א"):
    return (
        await client.post(
            "/api/v1/risks/bank",
            json={"name_he": name, "classification": "financial"},
            headers=auth_headers(token),
        )
    ).json()["id"]


@pytest.mark.asyncio
async def test_create_risk_selection_business(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    psel = await _selection(client, token, "business")
    rid = await _bank_risk(client, token)
    r = await client.post(
        f"/api/v1/process-selections/{psel}/risks",
        json={"risk_id": rid, "financial_damage": 4, "inherent_rating": "high"},
        headers=auth_headers(token),
    )
    assert r.status_code == 201
    assert r.json()["financial_damage"] == 4
    assert r.json()["inherent_rating"] == "high"


@pytest.mark.asyncio
async def test_itgc_risk_drops_rating_fields(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    psel = await _selection(client, token, "itgc")
    rid = await _bank_risk(client, token)
    r = await client.post(
        f"/api/v1/process-selections/{psel}/risks",
        json={"risk_id": rid, "financial_damage": 5, "inherent_rating": "high"},
        headers=auth_headers(token),
    )
    assert r.status_code == 201
    # ITGC processes ignore rating fields
    assert r.json()["financial_damage"] is None
    assert r.json()["inherent_rating"] is None


@pytest.mark.asyncio
async def test_damage_out_of_range_rejected(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    psel = await _selection(client, token)
    rid = await _bank_risk(client, token)
    r = await client.post(
        f"/api/v1/process-selections/{psel}/risks",
        json={"risk_id": rid, "financial_damage": 9},
        headers=auth_headers(token),
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_client_user_cannot_create_risk_selection(client, seed):
    admin = await _login(client, "admin@a.com", "tenant-a")
    psel = await _selection(client, admin)
    rid = await _bank_risk(client, admin)
    ct = await _login(client, "client@a.com", "tenant-a")
    r = await client.post(
        f"/api/v1/process-selections/{psel}/risks",
        json={"risk_id": rid},
        headers=auth_headers(ct),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_update_and_list_risk_selection(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    psel = await _selection(client, token)
    rid = await _bank_risk(client, token)
    sel = (
        await client.post(
            f"/api/v1/process-selections/{psel}/risks",
            json={"risk_id": rid},
            headers=auth_headers(token),
        )
    ).json()["id"]
    upd = await client.patch(
        f"/api/v1/risk-selections/{sel}",
        json={"residual_rating": "medium", "description": "תיאור"},
        headers=auth_headers(token),
    )
    assert upd.status_code == 200
    assert upd.json()["residual_rating"] == "medium"
    listing = await client.get(
        f"/api/v1/process-selections/{psel}/risks", headers=auth_headers(token)
    )
    assert len(listing.json()) == 1
