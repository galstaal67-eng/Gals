import pytest
from app.models.control import ControlBank
from app.models.enums import (
    ControlFrequency,
    ControlPurpose,
    ControlType,
    ProcessCategory,
)
from app.models.process import Process
from app.scripts.seed_catalog import seed_catalog
from sqlalchemy import func, select

from tests.conftest import auth_headers


async def _login(client, email, subdomain):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "secret123", "subdomain": subdomain},
    )
    return resp.json()["access_token"]


async def _global_catalog_entry(sessionmaker):
    """Insert one global process + one global catalog control (is_global)."""
    async with sessionmaker() as s:
        proc = Process(
            tenant_id=None,
            code="payroll",
            name_he="שכר ומשאבי אנוש",
            category=ProcessCategory.BUSINESS,
            is_global=True,
        )
        s.add(proc)
        await s.flush()
        bank = ControlBank(
            tenant_id=None,
            is_global=True,
            code="PL-1",
            name_he="הפרדת תפקידים בשכר",
            desired_description="SOD מאושר בין גיוס, הקמה, חישוב ותשלום.",
            process_id=proc.id,
            step="כללי",
            risk_description="היעדר אחידות בתהליך השכר",
            owner_hint="מנהל מחלקת השכר",
            default_purpose=ControlPurpose.PREVENTIVE,
            default_type=ControlType.MANUAL,
            default_frequency=ControlFrequency.QUARTERLY,
            is_key_default=True,
        )
        s.add(bank)
        await s.commit()
        return str(proc.id), str(bank.id)


async def _subsidiary(client, token):
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
    return yr, sid


@pytest.mark.asyncio
async def test_catalog_bank_exposes_defaults_and_filters_by_process(client, seed, sessionmaker):
    token = await _login(client, "admin@a.com", "tenant-a")
    pid, bid = await _global_catalog_entry(sessionmaker)

    # Global catalog is visible to the tenant, with the enriched fields.
    rows = (await client.get("/api/v1/controls/bank", headers=auth_headers(token))).json()
    entry = next(r for r in rows if r["id"] == bid)
    assert entry["process_id"] == pid
    assert entry["default_purpose"] == "preventive"
    assert entry["default_frequency"] == "quarterly"
    assert entry["is_key_default"] is True

    # process_id filter narrows the catalog.
    filtered = (
        await client.get(f"/api/v1/controls/bank?process_id={pid}", headers=auth_headers(token))
    ).json()
    assert [r["id"] for r in filtered] == [bid]


@pytest.mark.asyncio
async def test_import_control_builds_chain_and_copies_defaults(client, seed, sessionmaker):
    token = await _login(client, "admin@a.com", "tenant-a")
    _pid, bid = await _global_catalog_entry(sessionmaker)
    yr, sid = await _subsidiary(client, token)

    resp = await client.post(
        f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/import-control",
        json={"control_bank_id": bid},
        headers=auth_headers(token),
    )
    assert resp.status_code == 201, resp.text
    ctrl = resp.json()
    assert ctrl["control_name"] == "הפרדת תפקידים בשכר"
    assert ctrl["control_bank_id"] == bid
    assert ctrl["purpose"] == "preventive"
    assert ctrl["control_type"] == "manual"
    assert ctrl["frequency"] == "quarterly"
    assert ctrl["is_key_control"] is True
    assert ctrl["status"] == "draft"

    # Re-importing the same catalog control reuses the process/risk selections.
    resp2 = await client.post(
        f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/import-control",
        json={"control_bank_id": bid},
        headers=auth_headers(token),
    )
    assert resp2.status_code == 201
    assert resp2.json()["process_selection_id"] == ctrl["process_selection_id"]
    assert resp2.json()["risk_selection_id"] == ctrl["risk_selection_id"]

    sels = (
        await client.get(
            f"/api/v1/audit-years/{yr}/subsidiaries/{sid}/process-selections",
            headers=auth_headers(token),
        )
    ).json()
    assert len(sels) == 1


@pytest.mark.asyncio
async def test_import_rejects_cross_tenant_subsidiary(client, seed, sessionmaker):
    token_a = await _login(client, "admin@a.com", "tenant-a")
    token_b = await _login(client, "admin@b.com", "tenant-b")
    _pid, bid = await _global_catalog_entry(sessionmaker)
    yr_a, sid_a = await _subsidiary(client, token_a)

    # Tenant B cannot import into Tenant A's subsidiary.
    resp = await client.post(
        f"/api/v1/audit-years/{yr_a}/subsidiaries/{sid_a}/import-control",
        json={"control_bank_id": bid},
        headers=auth_headers(token_b),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_seed_catalog_sync_is_idempotent(sessionmaker):
    """First sync populates the global banks; a second sync is a no-op."""
    first = await seed_catalog(session_factory=sessionmaker)
    assert first["controls_added"] > 0
    assert first["processes_added"] == 9

    second = await seed_catalog(session_factory=sessionmaker)
    assert all(v == 0 for v in second.values()), second

    async with sessionmaker() as s:
        total = (
            await s.execute(
                select(func.count(ControlBank.id)).where(
                    ControlBank.is_global.is_(True), ControlBank.deleted_at.is_(None)
                )
            )
        ).scalar_one()
    assert total == first["controls_added"]


@pytest.mark.asyncio
async def test_seed_catalog_sync_repairs_changed_row(sessionmaker):
    """A drifted global control_bank row is restored on the next sync."""
    await seed_catalog(session_factory=sessionmaker)

    async with sessionmaker() as s:
        bank = (
            await s.execute(
                select(ControlBank).where(
                    ControlBank.is_global.is_(True), ControlBank.code == "PL-1"
                )
            )
        ).scalar_one()
        original = bank.name_he
        bank.name_he = "drifted"
        bank.is_key_default = not bank.is_key_default
        await s.commit()

    counts = await seed_catalog(session_factory=sessionmaker)
    assert counts["controls_updated"] >= 1

    async with sessionmaker() as s:
        bank = (
            await s.execute(
                select(ControlBank).where(
                    ControlBank.is_global.is_(True), ControlBank.code == "PL-1"
                )
            )
        ).scalar_one()
    assert bank.name_he == original


@pytest.mark.asyncio
async def test_catalog_sync_endpoint_populates_bank(client, seed):
    """Admin can populate the running instance's catalog via the API."""
    token = await _login(client, "admin@a.com", "tenant-a")
    before = (await client.get("/api/v1/controls/bank", headers=auth_headers(token))).json()
    assert before == []

    resp = await client.post("/api/v1/catalog/sync", headers=auth_headers(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["controls_added"] > 0

    after = (await client.get("/api/v1/controls/bank", headers=auth_headers(token))).json()
    assert len(after) == resp.json()["controls_added"]


@pytest.mark.asyncio
async def test_catalog_sync_requires_bank_manage_permission(client, seed):
    """A client-role user cannot trigger a catalog sync."""
    token = await _login(client, "client@a.com", "tenant-a")
    resp = await client.post("/api/v1/catalog/sync", headers=auth_headers(token))
    assert resp.status_code == 403
