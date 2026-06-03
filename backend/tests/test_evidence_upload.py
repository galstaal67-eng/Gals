import io

import pytest

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _test_id(client, token):
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


@pytest.mark.asyncio
async def test_upload_computes_sha256(client, seed):
    import hashlib

    token = await _login(client, "admin@a.com", "tenant-a")
    tid = await _test_id(client, token)
    content = b"evidence file contents"
    files = {"file": ("proof.txt", io.BytesIO(content), "text/plain")}
    resp = await client.post(
        f"/api/v1/tests/{tid}/evidences/upload",
        files=files,
        data={"is_sample": "false"},
        headers=auth_headers(token),
    )
    assert resp.status_code == 201
    assert resp.json()["file_hash"] == hashlib.sha256(content).hexdigest()
    assert resp.json()["file_size"] == len(content)
    assert resp.json()["filename"] == "proof.txt"


@pytest.mark.asyncio
async def test_client_cannot_mark_sample(client, seed):
    admin = await _login(client, "admin@a.com", "tenant-a")
    tid = await _test_id(client, admin)
    ct = await _login(client, "client@a.com", "tenant-a")
    files = {"file": ("x.txt", io.BytesIO(b"data"), "text/plain")}
    resp = await client.post(
        f"/api/v1/tests/{tid}/evidences/upload",
        files=files,
        data={"is_sample": "true"},
        headers=auth_headers(ct),
    )
    assert resp.status_code == 201
    # client's sample flag is ignored
    assert resp.json()["is_sample"] is False
