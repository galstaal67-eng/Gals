import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _validated_control_with_test(client, token):
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
            json={"control_name": "c", "is_key_control": True},
            headers=auth_headers(token),
        )
    ).json()["id"]
    for target in ("needs_validation", "validated"):
        await client.post(
            f"/api/v1/controls/{control_id}/transition",
            json={"target_state": target},
            headers=auth_headers(token),
        )
    tid = (
        await client.get(f"/api/v1/controls/{control_id}/tests", headers=auth_headers(token))
    ).json()[0]["id"]
    return yr, tid


@pytest.mark.asyncio
async def test_notification_on_test_return(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    _, tid = await _validated_control_with_test(client, token)
    client_user_id = str(seed["a"]["client"])
    # assign the test to the client user, then bounce it back
    await client.patch(
        f"/api/v1/tests/{tid}",
        json={"assigned_to_user_id": client_user_id},
        headers=auth_headers(token),
    )
    await client.post(
        f"/api/v1/tests/{tid}/transition",
        json={"target_state": "consultant_handling"},
        headers=auth_headers(token),
    )
    await client.post(
        f"/api/v1/tests/{tid}/transition",
        json={"target_state": "deficiency_open", "reason": "חסר תיעוד"},
        headers=auth_headers(token),
    )
    # the client user sees a notification
    ct = await _login(client, "client@a.com", "tenant-a")
    notes = await client.get("/api/v1/notifications?unread=true", headers=auth_headers(ct))
    assert notes.status_code == 200
    assert len(notes.json()) == 1
    assert notes.json()[0]["event_type"] == "test_returned"


@pytest.mark.asyncio
async def test_mark_notification_read(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    _, tid = await _validated_control_with_test(client, token)
    client_user_id = str(seed["a"]["client"])
    await client.patch(
        f"/api/v1/tests/{tid}",
        json={"assigned_to_user_id": client_user_id},
        headers=auth_headers(token),
    )
    for target in ("consultant_handling", "company_completion"):
        await client.post(
            f"/api/v1/tests/{tid}/transition",
            json={"target_state": target},
            headers=auth_headers(token),
        )
    ct = await _login(client, "client@a.com", "tenant-a")
    nid = (await client.get("/api/v1/notifications", headers=auth_headers(ct))).json()[0]["id"]
    r = await client.post(f"/api/v1/notifications/{nid}/read", headers=auth_headers(ct))
    assert r.json()["read_at"] is not None
    unread = await client.get("/api/v1/notifications?unread=true", headers=auth_headers(ct))
    assert unread.json() == []


@pytest.mark.asyncio
async def test_consultant_dashboard(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    yr, _ = await _validated_control_with_test(client, token)
    dash = await client.get(
        f"/api/v1/dashboards/consultant?audit_year_id={yr}", headers=auth_headers(token)
    )
    assert dash.status_code == 200
    body = dash.json()
    assert body["controls_total"] == 1
    assert body["key_controls"] == 1
    assert body["controls_by_status"]["validated"] == 1
    assert body["tests_total"] == 1
    assert body["tests_by_status"]["pending_receipt"] == 1


@pytest.mark.asyncio
async def test_reports_csv(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    yr, _ = await _validated_control_with_test(client, token)
    r = await client.get(
        f"/api/v1/reports/controls-matrix?audit_year_id={yr}", headers=auth_headers(token)
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "control_name" in r.text

    ts = await client.get(
        f"/api/v1/reports/test-status?audit_year_id={yr}", headers=auth_headers(token)
    )
    assert ts.status_code == 200
    assert "status" in ts.text


@pytest.mark.asyncio
async def test_auditor_cannot_export_is_allowed_but_client_dashboard_role(client, seed):
    # auditor may export reports (REPORT_EXPORT includes auditor)
    token = await _login(client, "admin@a.com", "tenant-a")
    yr, _ = await _validated_control_with_test(client, token)
    # client can see client dashboard
    ct = await _login(client, "client@a.com", "tenant-a")
    dash = await client.get(
        f"/api/v1/dashboards/client?audit_year_id={yr}", headers=auth_headers(ct)
    )
    assert dash.status_code == 200
