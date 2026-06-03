import io

import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


@pytest.mark.asyncio
async def test_ai_suggest_controls_heuristic(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    r = await client.post(
        "/api/v1/ai/suggest-controls",
        json={"risk_name": "גישה לא מורשית", "risk_description": "סיכון הרשאות"},
        headers=auth_headers(token),
    )
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    assert {i["control_type"] for i in items} == {"preventive", "detective"}
    assert "גישה לא מורשית" in items[0]["name"]


@pytest.mark.asyncio
async def test_ai_suggest_requires_create_permission(client, seed):
    token = await _login(client, "client@a.com", "tenant-a")
    r = await client.post(
        "/api/v1/ai/suggest-controls",
        json={"risk_name": "x"},
        headers=auth_headers(token),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_inbound_email_recorded(client, seed):
    r = await client.post(
        "/api/v1/email/inbound",
        json={
            "subdomain": "tenant-a",
            "from_email": "client@acme.com",
            "to_email": "sox@entropy.com",
            "subject": "תשובה לתיקוף",
            "body": "הבקרות מאושרות",
            "message_id": "<abc@mail>",
        },
    )
    assert r.status_code == 201
    assert r.json()["status"] == "received"
    assert r.json()["subject"] == "תשובה לתיקוף"


@pytest.mark.asyncio
async def test_inbound_email_unknown_tenant(client, seed):
    r = await client.post(
        "/api/v1/email/inbound",
        json={
            "subdomain": "nope",
            "from_email": "a@b.com",
            "to_email": "c@d.com",
            "subject": "x",
            "body": "y",
        },
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_evidence_comparison_year_over_year(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    # build a control + test, upload an evidence file
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

    async def _make_test():
        control_id = (
            await client.post(
                f"/api/v1/risk-selections/{rsel}/controls",
                json={"control_name": "c"},
                headers=auth_headers(token),
            )
        ).json()["id"]
        for target in ("needs_validation", "validated"):
            await client.post(
                f"/api/v1/controls/{control_id}/transition",
                json={"target_state": target},
                headers=auth_headers(token),
            )
        return (
            await client.get(f"/api/v1/controls/{control_id}/tests", headers=auth_headers(token))
        ).json()[0]["id"]

    t_prev = await _make_test()
    t_curr = await _make_test()

    async def _upload(tid, name, content):
        files = {"file": (name, io.BytesIO(content), "text/plain")}
        await client.post(
            f"/api/v1/tests/{tid}/evidences/upload", files=files, headers=auth_headers(token)
        )

    await _upload(t_prev, "shared.txt", b"same")
    await _upload(t_prev, "old.txt", b"only-prev")
    await _upload(t_curr, "shared.txt", b"same")  # same hash → unchanged
    await _upload(t_curr, "new.txt", b"only-curr")

    cmp = await client.get(
        f"/api/v1/tests/{t_curr}/evidence-comparison/{t_prev}", headers=auth_headers(token)
    )
    assert cmp.status_code == 200
    body = cmp.json()
    assert body["unchanged"] == ["shared.txt"]
    assert body["added"] == ["new.txt"]
    assert body["removed"] == ["old.txt"]
