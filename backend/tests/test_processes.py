import io

import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _sub(client, token):
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
    return yr, sid


@pytest.mark.asyncio
async def test_create_bank_process_and_sub_activity(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    proc = await client.post(
        "/api/v1/processes/bank",
        json={"name_he": "מכירות", "category": "business"},
        headers=auth_headers(token),
    )
    assert proc.status_code == 201
    pid = proc.json()["id"]
    sub = await client.post(
        f"/api/v1/processes/bank/{pid}/sub-activities",
        json={"name_he": "הזמנות"},
        headers=auth_headers(token),
    )
    assert sub.status_code == 201
    listing = await client.get(
        f"/api/v1/processes/bank/{pid}/sub-activities", headers=auth_headers(token)
    )
    assert len(listing.json()) == 1


@pytest.mark.asyncio
async def test_csv_import(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    csv_data = (
        "category,name_he,name_en,code,sub_activities\n"
        "business,רכש,Procurement,P-01,הזמנה;קליטה\n"
        "itgc,ITGC פריוריטי,ITGC,IT-01,מדיניות סיסמאות\n"
    )
    files = {"file": ("bank.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}
    resp = await client.post(
        "/api/v1/processes/bank/import-csv", files=files, headers=auth_headers(token)
    )
    assert resp.status_code == 200
    assert resp.json() == {"processes": 2, "sub_activities": 3}
    bank = await client.get("/api/v1/processes/bank?category=itgc", headers=auth_headers(token))
    assert [p["name_he"] for p in bank.json()] == ["ITGC פריוריטי"]


@pytest.mark.asyncio
async def test_create_process_selection(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    yr, sid = await _sub(client, token)
    pid = (
        await client.post(
            "/api/v1/processes/bank",
            json={"name_he": "מלאי", "category": "business"},
            headers=auth_headers(token),
        )
    ).json()["id"]
    sel = await client.post(
        f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/process-selections",
        json={"process_id": pid, "is_material": True},
        headers=auth_headers(token),
    )
    assert sel.status_code == 201
    listing = await client.get(
        f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/process-selections",
        headers=auth_headers(token),
    )
    assert len(listing.json()) == 1


@pytest.mark.asyncio
async def test_itgc_layer_only_for_itgc(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    yr, sid = await _sub(client, token)
    pid = (
        await client.post(
            "/api/v1/processes/bank",
            json={"name_he": "מכירות", "category": "business"},
            headers=auth_headers(token),
        )
    ).json()["id"]
    bad = await client.post(
        f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/process-selections",
        json={"process_id": pid, "itgc_layer": "network"},
        headers=auth_headers(token),
    )
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_client_user_cannot_manage_bank(client, seed):
    token = await _login(client, "client@a.com", "tenant-a")
    resp = await client.post(
        "/api/v1/processes/bank",
        json={"name_he": "X", "category": "business"},
        headers=auth_headers(token),
    )
    assert resp.status_code == 403
