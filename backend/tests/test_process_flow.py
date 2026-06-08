import pytest
from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _setup(client, token):
    h = auth_headers(token)
    cid = (await client.post("/api/v1/clients", json={"name": "Acme"}, headers=h)).json()["id"]
    yr = (
        await client.post(f"/api/v1/clients/{cid}/audit-years", json={"year": 2026}, headers=h)
    ).json()["id"]
    sid = (
        await client.post(
            f"/api/v1/audit-years/{yr}/subsidiaries", json={"name": "Sub"}, headers=h
        )
    ).json()["id"]
    # bank process + two flow steps (sub_activities)
    pid = (
        await client.post(
            "/api/v1/processes/bank",
            json={"name_he": "רכש", "category": "business"},
            headers=h,
        )
    ).json()["id"]
    for name in ("דרישת רכש", "הזמנת רכש"):
        await client.post(
            f"/api/v1/processes/bank/{pid}/sub-activities", json={"name_he": name}, headers=h
        )
    return cid, yr, sid, pid


@pytest.mark.asyncio
async def test_selection_seeds_steps_from_catalog(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    h = auth_headers(token)
    _cid, yr, sid, pid = await _setup(client, token)

    psel = (
        await client.post(
            f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/process-selections",
            json={"process_id": pid},
            headers=h,
        )
    ).json()["id"]

    steps = (await client.get(f"/api/v1/process-selections/{psel}/steps", headers=h)).json()
    assert [s["name_he"] for s in steps] == ["דרישת רכש", "הזמנת רכש"]
    assert steps[0]["order_index"] == 0 and steps[1]["order_index"] == 1


@pytest.mark.asyncio
async def test_step_crud_and_reorder(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    h = auth_headers(token)
    _cid, yr, sid, pid = await _setup(client, token)
    psel = (
        await client.post(
            f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/process-selections",
            json={"process_id": pid},
            headers=h,
        )
    ).json()["id"]
    steps = (await client.get(f"/api/v1/process-selections/{psel}/steps", headers=h)).json()

    # add a step
    new = (
        await client.post(
            f"/api/v1/process-selections/{psel}/steps",
            json={"name_he": "קליטת סחורה"},
            headers=h,
        )
    ).json()
    assert new["order_index"] == 2

    # rename
    renamed = (
        await client.patch(
            f"/api/v1/process-steps/{new['id']}", json={"name_he": "קבלת סחורה"}, headers=h
        )
    ).json()
    assert renamed["name_he"] == "קבלת סחורה"

    # reorder (reverse)
    ids = [new["id"], steps[1]["id"], steps[0]["id"]]
    reordered = (
        await client.post(
            f"/api/v1/process-selections/{psel}/steps/reorder",
            json={"step_ids": ids},
            headers=h,
        )
    ).json()
    assert [s["id"] for s in reordered] == ids

    # delete
    d = await client.delete(f"/api/v1/process-steps/{new['id']}", headers=h)
    assert d.status_code == 204
    after = (await client.get(f"/api/v1/process-selections/{psel}/steps", headers=h)).json()
    assert new["id"] not in [s["id"] for s in after]


@pytest.mark.asyncio
async def test_flow_aggregates_step_status(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    h = auth_headers(token)
    _cid, yr, sid, pid = await _setup(client, token)
    psel = (
        await client.post(
            f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/process-selections",
            json={"process_id": pid},
            headers=h,
        )
    ).json()["id"]
    steps = (await client.get(f"/api/v1/process-selections/{psel}/steps", headers=h)).json()
    step0 = steps[0]["id"]

    # empty steps -> status "empty"
    flow = (await client.get(f"/api/v1/process-selections/{psel}/flow", headers=h)).json()
    assert all(s["status"] == "empty" for s in flow["steps"])

    # risk on step0 + a control under it
    rid = (
        await client.post("/api/v1/risks/bank", json={"name_he": "סיכון"}, headers=h)
    ).json()["id"]
    rsel = (
        await client.post(
            f"/api/v1/process-selections/{psel}/risks",
            json={"risk_id": rid, "process_step_id": step0},
            headers=h,
        )
    ).json()["id"]
    await client.post(
        f"/api/v1/risk-selections/{rsel}/controls",
        json={"control_name": "בקרה א"},
        headers=h,
    )

    # risks filtered by step
    by_step = (
        await client.get(
            f"/api/v1/process-selections/{psel}/risks?step_id={step0}", headers=h
        )
    ).json()
    assert len(by_step) == 1

    flow = (await client.get(f"/api/v1/process-selections/{psel}/flow", headers=h)).json()
    s0 = next(s for s in flow["steps"] if s["id"] == step0)
    assert s0["risk_count"] == 1
    assert s0["control_count"] == 1
    assert s0["status"] == "in_progress"  # control exists, no passed tests yet
