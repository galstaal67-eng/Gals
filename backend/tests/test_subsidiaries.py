import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _year(client, token):
    cid = (
        await client.post("/api/v1/clients", json={"name": "Acme"}, headers=auth_headers(token))
    ).json()["id"]
    return (
        await client.post(
            f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(token)
        )
    ).json()["id"]


async def _sub(client, token, year_id, name="Sub1"):
    return (
        await client.post(
            f"/api/v1/audit-years/{year_id}/subsidiaries",
            json={"name": name},
            headers=auth_headers(token),
        )
    ).json()["id"]


@pytest.mark.asyncio
async def test_create_and_list_subsidiary(client, seed):
    admin = await _login(client, "admin@a.com", "tenant-a")
    yr = await _year(client, admin)
    sid = await _sub(client, admin, yr)
    assert sid
    listing = await client.get(
        f"/api/v1/audit-years/{yr}/subsidiaries", headers=auth_headers(admin)
    )
    assert listing.status_code == 200
    assert len(listing.json()) == 1


@pytest.mark.asyncio
async def test_client_user_cannot_create_subsidiary(client, seed):
    admin = await _login(client, "admin@a.com", "tenant-a")
    yr = await _year(client, admin)
    ct = await _login(client, "client@a.com", "tenant-a")
    r = await client.post(
        f"/api/v1/audit-years/{yr}/subsidiaries", json={"name": "X"}, headers=auth_headers(ct)
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_qualitative_four_yes_marks_significant(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    yr = await _year(client, token)
    sid = await _sub(client, token, yr)
    answers = {
        "answers": [
            {"question_key": "separate_location", "answer": True},
            {"question_key": "separate_management", "answer": True},
            {"question_key": "separate_systems", "answer": True},
            {"question_key": "unique_reporting_risk", "answer": True},
            {"question_key": "fraud_or_error", "answer": False},
        ]
    }
    r = await client.put(
        f"/api/v1/subsidiaries/{sid}/qualitative-answers", json=answers, headers=auth_headers(token)
    )
    assert r.status_code == 200
    assert r.json()["qualitative_result"] == "pass"


@pytest.mark.asyncio
async def test_qualitative_three_yes_not_significant(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    yr = await _year(client, token)
    sid = await _sub(client, token, yr)
    answers = {
        "answers": [
            {"question_key": "separate_location", "answer": True},
            {"question_key": "separate_management", "answer": True},
            {"question_key": "separate_systems", "answer": True},
            {"question_key": "unique_reporting_risk", "answer": False},
            {"question_key": "fraud_or_error", "answer": False},
        ]
    }
    r = await client.put(
        f"/api/v1/subsidiaries/{sid}/qualitative-answers", json=answers, headers=auth_headers(token)
    )
    assert r.json()["qualitative_result"] == "fail"


@pytest.mark.asyncio
async def test_scope_decision_requires_manager(client, seed):
    admin = await _login(client, "admin@a.com", "tenant-a")
    yr = await _year(client, admin)
    sid = await _sub(client, admin, yr)
    # client user cannot decide scope
    ct = await _login(client, "client@a.com", "tenant-a")
    blocked = await client.post(
        f"/api/v1/subsidiaries/{sid}/scope-decision",
        json={"is_significant": True, "approve": True},
        headers=auth_headers(ct),
    )
    assert blocked.status_code == 403

    ok = await client.post(
        f"/api/v1/subsidiaries/{sid}/scope-decision",
        json={"is_significant": True, "approve": True},
        headers=auth_headers(admin),
    )
    assert ok.status_code == 200
    assert ok.json()["scope_approved"] is True


@pytest.mark.asyncio
async def test_in_scope_listing(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    yr = await _year(client, token)
    s1 = await _sub(client, token, yr, "In")
    await _sub(client, token, yr, "Out")
    await client.post(
        f"/api/v1/subsidiaries/{s1}/scope-decision",
        json={"is_significant": True, "approve": True},
        headers=auth_headers(token),
    )
    in_scope = await client.get(
        f"/api/v1/audit-years/{yr}/subsidiaries/in-scope", headers=auth_headers(token)
    )
    assert [s["name"] for s in in_scope.json()] == ["In"]
