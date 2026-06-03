import pytest
from app.config import settings
from app.core import ai, storage
from app.core.storage import AzureBlobStorage, LocalStorage

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
    return (
        await client.post(
            f"/api/v1/risk-selections/{rsel}/controls",
            json={"control_name": "בקרה", "owner_contact_id": contact},
            headers=auth_headers(token),
        )
    ).json()["id"]


# ---- Gap 1: email dispatcher ----

@pytest.mark.asyncio
async def test_dispatch_sends_queued_email(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    cid = await _control_with_owner(client, token)
    await client.post(
        f"/api/v1/controls/{cid}/request-validation", json={}, headers=auth_headers(token)
    )
    # one queued email exists
    queued = await client.get(
        "/api/v1/email/outbox?status_filter=queued", headers=auth_headers(token)
    )
    assert len(queued.json()) == 1

    disp = await client.post("/api/v1/email/dispatch", headers=auth_headers(token))
    assert disp.json()["dispatched"] == 1

    sent = await client.get("/api/v1/email/outbox?status_filter=sent", headers=auth_headers(token))
    assert len(sent.json()) == 1
    assert sent.json()[0]["status"] == "sent"


# ---- Gap 2: Azure Blob storage selection ----

def test_storage_defaults_to_local(monkeypatch):
    monkeypatch.setattr(settings, "azure_storage_connection_string", "")
    assert isinstance(storage.get_storage(), LocalStorage)


def test_storage_selects_azure_when_configured(monkeypatch):
    monkeypatch.setattr(
        settings,
        "azure_storage_connection_string",
        "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y;",
    )
    assert isinstance(storage.get_storage(), AzureBlobStorage)


# ---- Gap 3: AI provider selection ----

@pytest.mark.asyncio
async def test_ai_status_default_heuristic(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    r = await client.get("/api/v1/ai/status", headers=auth_headers(token))
    assert r.status_code == 200
    assert r.json()["active"] == "HeuristicProvider"


def test_ai_selects_anthropic_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "anthropic")
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-test")
    assert type(ai.get_ai_provider()).__name__ == "AnthropicProvider"
