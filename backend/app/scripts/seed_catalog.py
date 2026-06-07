"""Sync the GLOBAL banks (processes / sub-activities / risks / control_bank)
from the RCM catalog exported from the sox-controls-dashboard.

Idempotent *sync* (not insert-only): re-running reconciles the global catalog
with `data/sox_catalog.json` — it adds new rows, updates changed rows, and
soft-deletes rows that disappeared from the catalog. Global rows carry
tenant_id = NULL and is_global = True, which the RLS policies expose to every
tenant (CLAUDE.md: global catalog).

    python -m app.scripts.seed_catalog
"""

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.control import ControlBank
from app.models.enums import (
    ControlFrequency,
    ControlPurpose,
    ControlType,
    ProcessCategory,
)
from app.models.process import Process, SubActivity
from app.models.risk import Risk

CATALOG_PATH = Path(__file__).parent / "data" / "sox_catalog.json"


def _short_name(description: str | None, fallback: str) -> str:
    """Derive a concise control name from the first sentence of its description."""
    if not description:
        return fallback
    first = description.replace("\n", " ").split(". ")[0].strip()
    if len(first) > 180:
        first = first[:177].rstrip() + "…"
    return first or fallback


def _bank_fields(c: dict, process_id) -> dict:
    """The catalog-derived fields of a control_bank row (excluding identity)."""
    return {
        "name_he": _short_name(c.get("description"), c["code"]),
        "desired_description": c.get("description"),
        "process_id": process_id,
        "step": c.get("step"),
        "risk_description": c.get("risk"),
        "owner_hint": c.get("owner"),
        "default_purpose": ControlPurpose(c["purpose"]) if c.get("purpose") else None,
        "default_type": ControlType(c["control_type"]) if c.get("control_type") else None,
        "default_frequency": (
            ControlFrequency(c["frequency"]) if c.get("frequency") else None
        ),
        "is_key_default": bool(c.get("is_key")),
    }


async def seed_catalog(session_factory=SessionLocal) -> dict[str, int]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    now = datetime.now(UTC)
    counts = {
        "processes_added": 0,
        "processes_updated": 0,
        "sub_activities_added": 0,
        "sub_activities_removed": 0,
        "risks_added": 0,
        "controls_added": 0,
        "controls_updated": 0,
        "controls_removed": 0,
    }

    async with session_factory() as db:
        # 1) Processes (global), keyed by code — add or update. ------------------
        proc_by_code: dict[str, Process] = {}
        for p in catalog["processes"]:
            category = ProcessCategory(p["category"])
            proc = (
                await db.execute(
                    select(Process).where(
                        Process.code == p["code"], Process.is_global.is_(True)
                    )
                )
            ).scalar_one_or_none()
            if proc:
                if (
                    proc.name_he != p["name_he"]
                    or proc.category != category
                    or proc.deleted_at is not None
                ):
                    proc.name_he = p["name_he"]
                    proc.category = category
                    proc.deleted_at = None
                    counts["processes_updated"] += 1
            else:
                proc = Process(
                    tenant_id=None,
                    code=p["code"],
                    name_he=p["name_he"],
                    name_en=p["code"],
                    category=category,
                    is_global=True,
                )
                db.add(proc)
                counts["processes_added"] += 1
            await db.flush()
            proc_by_code[p["code"]] = proc

            # 2) Sub-activities (flow steps) — sync to the catalog list. ---------
            existing_subs = (
                await db.execute(
                    select(SubActivity).where(
                        SubActivity.process_id == proc.id,
                        SubActivity.is_global.is_(True),
                        SubActivity.deleted_at.is_(None),
                    )
                )
            ).scalars().all()
            existing_by_name = {s.name_he: s for s in existing_subs}
            wanted = list(dict.fromkeys(p.get("steps", [])))
            for step in wanted:
                if step not in existing_by_name:
                    db.add(
                        SubActivity(
                            tenant_id=None,
                            process_id=proc.id,
                            name_he=step,
                            is_global=True,
                        )
                    )
                    counts["sub_activities_added"] += 1
            for name, sub in existing_by_name.items():
                if name not in wanted:
                    sub.deleted_at = now
                    counts["sub_activities_removed"] += 1

        # 3) Risks (global) — add new names (insert-only pool). ------------------
        existing_risk_names = set(
            (
                await db.execute(
                    select(Risk.name_he).where(
                        Risk.is_global.is_(True), Risk.deleted_at.is_(None)
                    )
                )
            ).scalars().all()
        )
        for name in {c["risk"].strip() for c in catalog["controls"] if c.get("risk")}:
            if name not in existing_risk_names:
                db.add(Risk(tenant_id=None, name_he=name, is_global=True))
                existing_risk_names.add(name)
                counts["risks_added"] += 1

        # 4) Control bank (global) — upsert by code + soft-delete removals. ------
        banks = (
            await db.execute(
                select(ControlBank).where(ControlBank.is_global.is_(True))
            )
        ).scalars().all()
        bank_by_code = {b.code: b for b in banks}
        catalog_codes: set[str] = set()
        for c in catalog["controls"]:
            catalog_codes.add(c["code"])
            proc = proc_by_code.get(c["process_code"])
            fields = _bank_fields(c, proc.id if proc else None)
            bank = bank_by_code.get(c["code"])
            if bank:
                changed = bank.deleted_at is not None or any(
                    getattr(bank, k) != v for k, v in fields.items()
                )
                if changed:
                    for k, v in fields.items():
                        setattr(bank, k, v)
                    bank.deleted_at = None
                    counts["controls_updated"] += 1
            else:
                db.add(
                    ControlBank(tenant_id=None, is_global=True, code=c["code"], **fields)
                )
                counts["controls_added"] += 1

        for code, bank in bank_by_code.items():
            if code not in catalog_codes and bank.deleted_at is None:
                bank.deleted_at = now
                counts["controls_removed"] += 1

        await db.commit()

    print("catalog sync: " + ", ".join(f"{k}={v}" for k, v in counts.items() if v))
    return counts


if __name__ == "__main__":
    asyncio.run(seed_catalog())
