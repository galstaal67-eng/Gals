import pytest
from app.models.audit_log import AuditLog
from app.models.client import Client
from app.models.enums import AuditAction
from sqlalchemy import func, select

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


@pytest.mark.asyncio
async def test_create_then_get_client(client, seed):
    token = await _login(client, "admin@a.com", "tenant-a")
    created = await client.post(
        "/api/v1/clients",
        json={"name": "Acme", "industry": "hitech", "regulations": ["SOX"]},
        headers=auth_headers(token),
    )
    assert created.status_code == 201
    cid = created.json()["id"]

    got = await client.get(f"/api/v1/clients/{cid}", headers=auth_headers(token))
    assert got.status_code == 200
    assert got.json()["industry"] == "hitech"
    assert got.json()["regulations"] == ["SOX"]


@pytest.mark.asyncio
async def test_update_client_records_audit(client, seed, sessionmaker):
    token = await _login(client, "admin@a.com", "tenant-a")
    created = await client.post(
        "/api/v1/clients", json={"name": "Acme"}, headers=auth_headers(token)
    )
    cid = created.json()["id"]
    await client.patch(
        f"/api/v1/clients/{cid}", json={"name": "Acme Corp"}, headers=auth_headers(token)
    )

    async with sessionmaker() as s:
        updates = (
            await s.execute(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.entity_type == "client", AuditLog.action == AuditAction.UPDATE)
            )
        ).scalar_one()
    assert updates == 1


@pytest.mark.asyncio
async def test_delete_is_soft_delete(client, seed, sessionmaker):
    token = await _login(client, "admin@a.com", "tenant-a")
    created = await client.post(
        "/api/v1/clients", json={"name": "Acme"}, headers=auth_headers(token)
    )
    cid = created.json()["id"]
    resp = await client.delete(f"/api/v1/clients/{cid}", headers=auth_headers(token))
    assert resp.status_code == 204

    # row still physically present, but with deleted_at set
    async with sessionmaker() as s:
        row = (await s.execute(select(Client).where(Client.id == cid))).scalar_one()
        assert row.deleted_at is not None

    # and no longer returned by the API
    got = await client.get(f"/api/v1/clients/{cid}", headers=auth_headers(token))
    assert got.status_code == 404


@pytest.mark.asyncio
async def test_tenant_isolation_at_app_layer(client, seed):
    """A user from tenant A must not see tenant B's clients (app-level filter;
    RLS provides defense-in-depth in PostgreSQL)."""
    token_a = await _login(client, "admin@a.com", "tenant-a")
    await client.post("/api/v1/clients", json={"name": "A-Client"}, headers=auth_headers(token_a))

    token_b = await _login(client, "admin@b.com", "tenant-b")
    resp = await client.get("/api/v1/clients", headers=auth_headers(token_b))
    assert resp.status_code == 200
    assert resp.json() == []
