"""Flow-diagram process steps: process_steps table + risk_selections.process_step_id

Revision ID: 0012_process_steps
Revises: 0011_catalog
Create Date: 2026-06-08

Idempotent: creates the table with checkfirst and adds the column only when
missing, so re-running against a DB already built from the model is a no-op.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from app.models.process_selection import ProcessStep

revision: str = "0012_process_steps"
down_revision: str | None = "0011_catalog"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _cols(bind, table) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    ProcessStep.__table__.create(bind=bind, checkfirst=True)

    if "process_step_id" not in _cols(bind, "risk_selections"):
        op.add_column(
            "risk_selections", sa.Column("process_step_id", sa.Uuid(), nullable=True)
        )
        op.create_index(
            "ix_risk_selections_process_step_id", "risk_selections", ["process_step_id"]
        )

    if "order_index" not in _cols(bind, "sub_activities"):
        op.add_column(
            "sub_activities",
            sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        )

    if bind.dialect.name != "postgresql":
        return
    # process_steps admits only tenant-scoped rows (no global) — strict RLS.
    op.execute("ALTER TABLE process_steps ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE process_steps FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON process_steps
        USING (
            current_setting('app.tenant_id', true) IS NULL
            OR current_setting('app.tenant_id', true) = ''
            OR tenant_id::text = current_setting('app.tenant_id', true)
        )
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "order_index" in _cols(bind, "sub_activities"):
        op.drop_column("sub_activities", "order_index")
    if "process_step_id" in _cols(bind, "risk_selections"):
        op.drop_index("ix_risk_selections_process_step_id", table_name="risk_selections")
        op.drop_column("risk_selections", "process_step_id")
    ProcessStep.__table__.drop(bind=bind, checkfirst=True)
