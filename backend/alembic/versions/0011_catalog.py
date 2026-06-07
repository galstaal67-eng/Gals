"""Catalog enrichment: link control_bank to processes + default attributes,
and extend control_frequency with weekly / ad_hoc.

Revision ID: 0011_catalog
Revises: 0010_email_direction
Create Date: 2026-06-07

Idempotent: each column/enum value is added only when missing, so re-running
against a DB already built from the current model is a no-op.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from app.models.enums import ControlFrequency, ControlPurpose, ControlType

revision: str = "0011_catalog"
down_revision: str | None = "0010_email_direction"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# New control_frequency members introduced by the RCM catalog.
NEW_FREQ_VALUES = ("weekly", "ad_hoc")


def _new_columns() -> dict[str, sa.Column]:
    return {
        "process_id": sa.Column("process_id", sa.Uuid(), nullable=True),
        "step": sa.Column("step", sa.String(length=255), nullable=True),
        "risk_description": sa.Column("risk_description", sa.Text(), nullable=True),
        "owner_hint": sa.Column("owner_hint", sa.String(length=255), nullable=True),
        "default_purpose": sa.Column(
            "default_purpose",
            sa.Enum(ControlPurpose, name="control_purpose", create_type=False),
            nullable=True,
        ),
        "default_type": sa.Column(
            "default_type",
            sa.Enum(ControlType, name="control_type", create_type=False),
            nullable=True,
        ),
        "default_frequency": sa.Column(
            "default_frequency",
            sa.Enum(ControlFrequency, name="control_frequency", create_type=False),
            nullable=True,
        ),
        "is_key_default": sa.Column(
            "is_key_default", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    }


def _existing_columns(bind) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns("control_bank")}


def upgrade() -> None:
    bind = op.get_bind()

    # 1) Extend the control_frequency enum (PostgreSQL native enum only).
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            for value in NEW_FREQ_VALUES:
                op.execute(
                    f"ALTER TYPE control_frequency ADD VALUE IF NOT EXISTS '{value}'"
                )

    # 2) Add catalog columns to control_bank.
    existing = _existing_columns(bind)
    for name, column in _new_columns().items():
        if name not in existing:
            op.add_column("control_bank", column)

    if "process_id" not in existing:
        op.create_index(
            "ix_control_bank_process_id", "control_bank", ["process_id"]
        )


def downgrade() -> None:
    bind = op.get_bind()
    existing = _existing_columns(bind)
    if "process_id" in existing:
        op.drop_index("ix_control_bank_process_id", table_name="control_bank")
    for name in reversed(list(_new_columns())):
        if name in existing:
            op.drop_column("control_bank", name)
    # Enum values are intentionally not removed (PostgreSQL cannot drop them).
