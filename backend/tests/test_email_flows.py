import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _control_with_owner(client, token):
    cid = (
        await client.post("/api/v1/clients", json={"name": "Acme"}, headers=auth_headers(token))
    ).json()["id"]
    contact = (
        await client.post(
            f"/api/v1/clients/{cid}/contacts",
            json={"full_name": "דנה", "email": "dana@acme.com"},
            headers=auth_headers(token),
        )
    ).json()["id"]
    yr = (
        await client.post(
            f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(token)
        )
    ).json()["id"]
    sid = (
        await client.post(
            f"/api/v1/audit-years/{yr}/subsidiaries",
            json={"name": "S"},
            headers=auth_headers(token),
        )
    ).json()["id"]
    pid = (
        await client.post(
            "/api/v1/processes/bank",
            json={"name_he": "p", "category": "business"},
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
        await client.post("/api/v1/risks/bank", json={"name_he": "r"}, headers=auth_headers(token))
    ).json()["id"]
    rsel = (
        await client.post(
            f"/api/v1/process-selections/{psel}/risks",
            json={"risk_id": rid},
            headers=auth_headers(token),
        )
    ).json()["id"]
    control_id = (
        await client.post(
            f"/api/v1/risk-selections/{rsel}/controls",
            json={"control_name": "בקרה", "owner_contact_id": contact, "frequency": "monthly"},
            headers=auth_headers(token),
        )
    ).json()["id"]
    return control_id


@pytest.mark.asyncio
async def test_request_validation_queues_email_and_moves_status(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    cid = await _control_with_owner(client, token)
    r = await client.post(
        f"/api/v1/controls/{cid}/request-validation", json={}, headers=auth_headers(token)
    )
    assert r.status_code == 200
    assert r.json()["to_email"] == "dana@acme.com"
    assert "תיקוף בקרות" in r.json()["subject"]
    assert r.json()["status"] == "queued"

    # control moved to needs_validation → a second request is now illegal
    again = await client.post(
        f"/api/v1/controls/{cid}/request-validation", json={}, headers=auth_headers(token)
    )
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_request_validation_without_owner_email_fails(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    # build a control without owner contact
    cid = (
        await client.post(
            "/api/v1/clients", json={"name": "NoContact"}, headers=auth_headers(token)
        )
    ).json()["id"]
    yr = (
        await client.post(
            f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=auth_headers(token)
        )
    ).json()["id"]
    sid = (
        await client.post(
            f"/api/v1/audit-years/{yr}/subsidiaries",
            json={"name": "S"},
            headers=auth_headers(token),
        )
    ).json()["id"]
    pid = (
        await client.post(
            "/api/v1/processes/bank",
            json={"name_he": "p", "category": "business"},
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
        await client.post("/api/v1/risks/bank", json={"name_he": "r"}, headers=auth_headers(token))
    ).json()["id"]
    rsel = (
        await client.post(
            f"/api/v1/process-selections/{psel}/risks",
            json={"risk_id": rid},
            headers=auth_headers(token),
        )
    ).json()["id"]
    control_id = (
        await client.post(
            f"/api/v1/risk-selections/{rsel}/controls",
            json={"control_name": "בקרה"},
            headers=auth_headers(token),
        )
    ).json()["id"]
    r = await client.post(
        f"/api/v1/controls/{control_id}/request-validation", json={}, headers=auth_headers(token)
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_request_evidence_email(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    cid = await _control_with_owner(client, token)
    # validate to spawn the test
    for target in ("needs_validation", "validated"):
        await client.post(
            f"/api/v1/controls/{cid}/transition",
            json={"target_state": target},
            headers=auth_headers(token),
        )
    tid = (
        await client.get(f"/api/v1/controls/{cid}/tests", headers=auth_headers(token))
    ).json()[0]["id"]
    r = await client.post(
        f"/api/v1/tests/{tid}/request-evidence",
        json={"due_date": "2026-07-01"},
        headers=auth_headers(token),
    )
    assert r.status_code == 200
    assert "טסטים לבקרות" in r.json()["subject"]
    assert "2026-07-01" in r.json()["body"]
