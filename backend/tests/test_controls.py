import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _risk_selection(client, token):
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
            json={"name_he": "תהליך", "category": "business"},
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
    rid = (
        await client.post(
            "/api/v1/risks/bank", json={"name_he": "סיכון"}, headers=auth_headers(token)
        )
    ).json()["id"]
    rsel = (
        await client.post(
            f"/api/v1/process-selections/{psel}/risks",
            json={"risk_id": rid},
            headers=auth_headers(token),
        )
    ).json()["id"]
    return rsel


async def _control(client, token, rsel, name="בקרה א"):
    return (
        await client.post(
            f"/api/v1/risk-selections/{rsel}/controls",
            json={"control_name": name},
            headers=auth_headers(token),
        )
    ).json()["id"]


@pytest.mark.asyncio
async def test_create_control_defaults_to_draft(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    rsel = await _risk_selection(client, token)
    cid = await _control(client, token, rsel)
    got = await client.get(f"/api/v1/risk-selections/{rsel}/controls", headers=auth_headers(token))
    assert got.json()[0]["status"] == "draft"
    assert got.json()[0]["id"] == cid


@pytest.mark.asyncio
async def test_full_validation_flow(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    rsel = await _risk_selection(client, token)
    cid = await _control(client, token, rsel)

    # draft -> needs_validation
    t1 = await client.post(
        f"/api/v1/controls/{cid}/transition",
        json={"target_state": "needs_validation"},
        headers=auth_headers(token),
    )
    assert t1.status_code == 200 and t1.json()["status"] == "needs_validation"

    # needs_validation -> validated
    t2 = await client.post(
        f"/api/v1/controls/{cid}/transition",
        json={"target_state": "validated"},
        headers=auth_headers(token),
    )
    assert t2.status_code == 200 and t2.json()["status"] == "validated"
    assert t2.json()["validated_at"] is not None


@pytest.mark.asyncio
async def test_illegal_transition_rejected(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    rsel = await _risk_selection(client, token)
    cid = await _control(client, token, rsel)
    # draft -> validated is illegal
    r = await client.post(
        f"/api/v1/controls/{cid}/transition",
        json={"target_state": "validated"},
        headers=auth_headers(token),
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_edit_actual_description_in_needs_validation_sets_needs_fix(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    rsel = await _risk_selection(client, token)
    cid = await _control(client, token, rsel)
    await client.post(
        f"/api/v1/controls/{cid}/transition",
        json={"target_state": "needs_validation"},
        headers=auth_headers(token),
    )
    # editing actual_description -> auto needs_fix
    upd = await client.patch(
        f"/api/v1/controls/{cid}",
        json={"actual_description": "תיאור מעודכן"},
        headers=auth_headers(token),
    )
    assert upd.status_code == 200
    assert upd.json()["status"] == "needs_fix"


@pytest.mark.asyncio
async def test_other_fields_locked_in_needs_validation(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    rsel = await _risk_selection(client, token)
    cid = await _control(client, token, rsel)
    await client.post(
        f"/api/v1/controls/{cid}/transition",
        json={"target_state": "needs_validation"},
        headers=auth_headers(token),
    )
    blocked = await client.patch(
        f"/api/v1/controls/{cid}",
        json={"control_name": "שינוי"},
        headers=auth_headers(token),
    )
    assert blocked.status_code == 409


@pytest.mark.asyncio
async def test_client_validates_but_consultant_only_requests(client, seed):
    admin = await _login(client, "admin@a.com", "tenant-a")
    rsel = await _risk_selection(client, admin)
    cid = await _control(client, admin, rsel)
    await client.post(
        f"/api/v1/controls/{cid}/transition",
        json={"target_state": "needs_validation"},
        headers=auth_headers(admin),
    )
    # client may approve validation
    ct = await _login(client, "client@a.com", "tenant-a")
    ok = await client.post(
        f"/api/v1/controls/{cid}/transition",
        json={"target_state": "validated"},
        headers=auth_headers(ct),
    )
    assert ok.status_code == 200


@pytest.mark.asyncio
async def test_validated_control_locked_for_consultant(client, seed):
    admin = await _login(client, "admin@a.com", "tenant-a")
    rsel = await _risk_selection(client, admin)
    cid = await _control(client, admin, rsel)
    for target in ("needs_validation", "validated"):
        await client.post(
            f"/api/v1/controls/{cid}/transition",
            json={"target_state": target},
            headers=auth_headers(admin),
        )
    # validated controls are locked; admin still allowed, but reopening clears validation
    reopened = await client.post(
        f"/api/v1/controls/{cid}/transition",
        json={"target_state": "draft"},
        headers=auth_headers(admin),
    )
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "draft"
    assert reopened.json()["validated_at"] is None
