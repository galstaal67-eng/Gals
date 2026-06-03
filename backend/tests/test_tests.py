import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _validated_control(client, token):
    """Build the chain down to a validated control (which spawns a test)."""
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
            json={"name": "S"},
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
        await client.post("/api/v1/risks/bank", json={"name_he": "ס"}, headers=auth_headers(token))
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
    for target in ("needs_validation", "validated"):
        await client.post(
            f"/api/v1/controls/{control_id}/transition",
            json={"target_state": target},
            headers=auth_headers(token),
        )
    return yr, control_id


@pytest.mark.asyncio
async def test_validated_control_spawns_test(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    _, control_id = await _validated_control(client, token)
    tests = await client.get(
        f"/api/v1/controls/{control_id}/tests", headers=auth_headers(token)
    )
    assert len(tests.json()) == 1
    assert tests.json()[0]["status"] == "pending_receipt"


@pytest.mark.asyncio
async def test_evidence_upload_and_replace(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    _, control_id = await _validated_control(client, token)
    tid = (
        await client.get(f"/api/v1/controls/{control_id}/tests", headers=auth_headers(token))
    ).json()[0]["id"]

    ev = await client.post(
        f"/api/v1/tests/{tid}/evidences",
        json={"filename": "a.pdf", "file_hash": "abc123"},
        headers=auth_headers(token),
    )
    assert ev.status_code == 201
    eid = ev.json()["id"]

    rep = await client.post(
        f"/api/v1/tests/{tid}/evidences/{eid}/replace",
        json={"filename": "a-fixed.pdf", "file_hash": "def456"},
        headers=auth_headers(token),
    )
    assert rep.status_code == 201
    # original is kept (not deleted), now 2 evidence rows; original links forward
    listing = await client.get(f"/api/v1/tests/{tid}/evidences", headers=auth_headers(token))
    assert len(listing.json()) == 2
    original = next(e for e in listing.json() if e["id"] == eid)
    assert original["replaced_by_id"] == rep.json()["id"]


@pytest.mark.asyncio
async def test_test_status_flow(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    _, control_id = await _validated_control(client, token)
    tid = (
        await client.get(f"/api/v1/controls/{control_id}/tests", headers=auth_headers(token))
    ).json()[0]["id"]

    # pending_receipt -> consultant_handling -> reviewed_approved -> internally_closed
    for target in ("consultant_handling", "reviewed_approved", "internally_closed"):
        r = await client.post(
            f"/api/v1/tests/{tid}/transition",
            json={"target_state": target},
            headers=auth_headers(token),
        )
        assert r.status_code == 200, target
    got = await client.get(f"/api/v1/tests/{tid}", headers=auth_headers(token))
    assert got.json()["status"] == "internally_closed"
    assert got.json()["completed_at"] is not None


@pytest.mark.asyncio
async def test_illegal_test_transition_rejected(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    _, control_id = await _validated_control(client, token)
    tid = (
        await client.get(f"/api/v1/controls/{control_id}/tests", headers=auth_headers(token))
    ).json()[0]["id"]
    # pending_receipt -> internally_closed is illegal
    r = await client.post(
        f"/api/v1/tests/{tid}/transition",
        json={"target_state": "internally_closed"},
        headers=auth_headers(token),
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_deficiency_flow_with_severity(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    _, control_id = await _validated_control(client, token)
    tid = (
        await client.get(f"/api/v1/controls/{control_id}/tests", headers=auth_headers(token))
    ).json()[0]["id"]
    await client.post(
        f"/api/v1/tests/{tid}/transition",
        json={"target_state": "consultant_handling"},
        headers=auth_headers(token),
    )
    await client.post(
        f"/api/v1/tests/{tid}/transition",
        json={"target_state": "deficiency_open"},
        headers=auth_headers(token),
    )
    # record severity + deficiency details
    upd = await client.patch(
        f"/api/v1/tests/{tid}",
        json={"severity": "material_weakness", "deficiencies_found": "חסר תיעוד"},
        headers=auth_headers(token),
    )
    assert upd.json()["severity"] == "material_weakness"
    closed = await client.post(
        f"/api/v1/tests/{tid}/transition",
        json={"target_state": "deficiency_closed"},
        headers=auth_headers(token),
    )
    assert closed.json()["status"] == "deficiency_closed"


@pytest.mark.asyncio
async def test_client_marks_ready(client, seed):
    admin = await _login(client, "admin@a.com", "tenant-a")
    _, control_id = await _validated_control(client, admin)
    tid = (
        await client.get(f"/api/v1/controls/{control_id}/tests", headers=auth_headers(admin))
    ).json()[0]["id"]
    ct = await _login(client, "client@a.com", "tenant-a")
    r = await client.post(f"/api/v1/tests/{tid}/ready", headers=auth_headers(ct))
    assert r.status_code == 200
    assert r.json()["ready_to_send"] is True
    assert r.json()["status"] == "consultant_handling"
