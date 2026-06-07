"""Seed the GLOBAL banks (processes / sub-activities / risks / control_bank)
from the RCM catalog exported from the sox-controls-dashboard.

Idempotent per row (keyed by code / name), so the entrypoint can run it on
every boot. Global rows carry tenant_id = NULL and is_global = True, which the
RLS policies expose to every tenant (CLAUDE.md: global catalog).

    python -m app.scripts.seed_catalog
"""

import asyncio
import json
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


async def seed_catalog() -> dict[str, int]:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    counts = {"processes": 0, "sub_activities": 0, "risks": 0, "controls": 0}

    async with SessionLocal() as db:
        # 1) Processes (global), keyed by code. ----------------------------------
        proc_by_code: dict[str, Process] = {}
        for p in catalog["processes"]:
            existing = (
                await db.execute(
                    select(Process).where(
                        Process.code == p["code"], Process.is_global.is_(True)
                    )
                )
            ).scalar_one_or_none()
            if existing:
                proc_by_code[p["code"]] = existing
                continue
            proc = Process(
                tenant_id=None,
                code=p["code"],
                name_he=p["name_he"],
                name_en=p["code"],
                category=ProcessCategory(p["category"]),
                is_global=True,
            )
            db.add(proc)
            await db.flush()
            proc_by_code[p["code"]] = proc
            counts["processes"] += 1

            # 2) Sub-activities (flow steps) per process. ------------------------
            for step in p.get("steps", []):
                db.add(
                    SubActivity(
                        tenant_id=None,
                        process_id=proc.id,
                        name_he=step,
                        is_global=True,
                    )
                )
                counts["sub_activities"] += 1

        # 3) Risks (global), de-duplicated by name. ------------------------------
        risk_names = {
            c["risk"].strip() for c in catalog["controls"] if c.get("risk")
        }
        for name in risk_names:
            exists = (
                await db.execute(
                    select(Risk.id).where(
                        Risk.name_he == name, Risk.is_global.is_(True)
                    )
                )
            ).scalar_one_or_none()
            if exists:
                continue
            db.add(Risk(tenant_id=None, name_he=name, is_global=True))
            counts["risks"] += 1

        # 4) Control bank (global), keyed by code. -------------------------------
        for c in catalog["controls"]:
            exists = (
                await db.execute(
                    select(ControlBank.id).where(
                        ControlBank.code == c["code"],
                        ControlBank.is_global.is_(True),
                    )
                )
            ).scalar_one_or_none()
            if exists:
                continue
            proc = proc_by_code.get(c["process_code"])
            db.add(
                ControlBank(
                    tenant_id=None,
                    is_global=True,
                    code=c["code"],
                    name_he=_short_name(c.get("description"), c["code"]),
                    desired_description=c.get("description"),
                    process_id=proc.id if proc else None,
                    step=c.get("step"),
                    risk_description=c.get("risk"),
                    owner_hint=c.get("owner"),
                    default_purpose=ControlPurpose(c["purpose"]) if c.get("purpose") else None,
                    default_type=ControlType(c["control_type"]) if c.get("control_type") else None,
                    default_frequency=(
                        ControlFrequency(c["frequency"]) if c.get("frequency") else None
                    ),
                    is_key_default=bool(c.get("is_key")),
                )
            )
            counts["controls"] += 1

        await db.commit()

    print(
        "catalog seed: "
        + ", ".join(f"{k}=+{v}" for k, v in counts.items())
    )
    return counts


if __name__ == "__main__":
    asyncio.run(seed_catalog())
