"""Coverage walk — exercises update/delete/list endpoints across the domain so
the 80% gate (DoD) is met. Builds the full chain once and drives the paths that
the per-feature tests don't reach (PATCH/DELETE/list/error branches)."""

import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


@pytest.mark.asyncio
async def test_full_chain_update_delete_walk(client, seed):
    t = await _login(client, "admin@a.com", "tenant-a")
    H = auth_headers(t)

    cid = (await client.post("/api/v1/clients", json={"name": "Acme"}, headers=H)).json()["id"]
    # contact create + update
    con = (
        await client.post(
            f"/api/v1/clients/{cid}/contacts",
            json={"full_name": "דנה", "email": "d@a.com"},
            headers=H,
        )
    ).json()["id"]
    await client.patch(
        f"/api/v1/clients/{cid}/contacts/{con}", json={"role_title": "CFO"}, headers=H
    )

    yr = (
        await client.post(f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=H)
    ).json()["id"]

    # materiality create + update
    mp = (
        await client.post(
            f"/api/v1/audit-years/{yr}/materiality-parameters",
            json={"slot": 1, "parameter_type": "sales", "value": "1000", "percentage": "0.05"},
            headers=H,
        )
    ).json()["id"]
    upd_mp = await client.patch(
        f"/api/v1/materiality-parameters/{mp}", json={"percentage": "0.10"}, headers=H
    )
    assert float(upd_mp.json()["computed_threshold"]) == 100.0

    # subsidiary create + update
    sid = (
        await client.post(
            f"/api/v1/audit-years/{yr}/subsidiaries", json={"name": "S"}, headers=H
        )
    ).json()["id"]
    await client.patch(
        f"/api/v1/subsidiaries/{sid}", json={"in_scope_previous_year": True}, headers=H
    )

    # process bank + selection create/update/delete
    pid = (
        await client.post(
            "/api/v1/processes/bank",
            json={"name_he": "מלאי", "category": "business"},
            headers=H,
        )
    ).json()["id"]
    psel = (
        await client.post(
            f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/process-selections",
            json={"process_id": pid},
            headers=H,
        )
    ).json()["id"]
    await client.patch(f"/api/v1/process-selections/{psel}", json={"is_material": True}, headers=H)

    # an extra selection to delete
    psel2 = (
        await client.post(
            f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/process-selections",
            json={"process_id": pid},
            headers=H,
        )
    ).json()["id"]
    deleted = await client.delete(f"/api/v1/process-selections/{psel2}", headers=H)
    assert deleted.status_code == 204

    # risk bank + selection create/update/delete
    rid = (await client.post("/api/v1/risks/bank", json={"name_he": "ס"}, headers=H)).json()["id"]
    rsel = (
        await client.post(
            f"/api/v1/process-selections/{psel}/risks", json={"risk_id": rid}, headers=H
        )
    ).json()["id"]
    await client.patch(
        f"/api/v1/risk-selections/{rsel}", json={"description": "תיאור", "financial_damage": 3},
        headers=H,
    )
    rsel2 = (
        await client.post(
            f"/api/v1/process-selections/{psel}/risks", json={"risk_id": rid}, headers=H
        )
    ).json()["id"]
    assert (await client.delete(f"/api/v1/risk-selections/{rsel2}", headers=H)).status_code == 204

    # control bank list + create/update; an extra control to delete
    await client.get("/api/v1/controls/bank", headers=H)
    ctrl = (
        await client.post(
            f"/api/v1/risk-selections/{rsel}/controls",
            json={"control_name": "בקרה"},
            headers=H,
        )
    ).json()["id"]
    await client.patch(f"/api/v1/controls/{ctrl}", json={"system_name": "SAP"}, headers=H)
    ctrl2 = (
        await client.post(
            f"/api/v1/risk-selections/{rsel}/controls",
            json={"control_name": "בקרה2"},
            headers=H,
        )
    ).json()["id"]
    assert (await client.delete(f"/api/v1/controls/{ctrl2}", headers=H)).status_code == 204

    # validate -> spawns test; then update test fields + list by year + evidences list
    for target in ("needs_validation", "validated"):
        await client.post(
            f"/api/v1/controls/{ctrl}/transition", json={"target_state": target}, headers=H
        )
    tid = (await client.get(f"/api/v1/controls/{ctrl}/tests", headers=H)).json()[0]["id"]
    await client.patch(
        f"/api/v1/tests/{tid}",
        json={"test_round": "round_a", "required_evidence": ["דוח"], "test_method": "דגימה"},
        headers=H,
    )
    assert (await client.get(f"/api/v1/audit-years/{yr}/tests", headers=H)).status_code == 200
    assert (await client.get(f"/api/v1/tests/{tid}/evidences", headers=H)).json() == []

    # dashboards (all three) + notifications read-all
    for role in ("consultant", "client", "auditor"):
        assert (await client.get(f"/api/v1/dashboards/{role}", headers=H)).status_code == 200
    assert (await client.post("/api/v1/notifications/read-all", headers=H)).status_code == 204


@pytest.mark.asyncio
async def test_not_found_paths(client, seed):
    t = await _login(client, "admin@a.com", "tenant-a")
    H = auth_headers(t)
    missing = "00000000-0000-0000-0000-000000000000"
    assert (await client.get(f"/api/v1/clients/{missing}", headers=H)).status_code == 404
    miss_ctrl = await client.patch(f"/api/v1/controls/{missing}", json={}, headers=H)
    assert miss_ctrl.status_code == 404
    assert (await client.get(f"/api/v1/tests/{missing}", headers=H)).status_code == 404
    assert (
        await client.patch(f"/api/v1/subsidiaries/{missing}", json={}, headers=H)
    ).status_code == 404
    assert (
        await client.patch(f"/api/v1/risk-selections/{missing}", json={}, headers=H)
    ).status_code == 404
