"""Phase 2: risk bank + risk selections (+RLS)

Revision ID: 0005_risks
Revises: 0004_processes
Create Date: 2026-06-03

"""
from collections.abc import Sequence

from alembic import op
from app.models.risk import Risk, RiskSelection

revision: str = "0005_risks"
down_revision: str | None = "0004_processes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    Risk.__table__.create(bind=bind)
    RiskSelection.__table__.create(bind=bind)

    if bind.dialect.name != "postgresql":
        return
    # risks: bank table — admit global rows (tenant_id NULL).
    op.execute("ALTER TABLE risks ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE risks FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON risks
        USING (
            tenant_id IS NULL
            OR current_setting('app.tenant_id', true) IS NULL
            OR current_setting('app.tenant_id', true) = ''
            OR tenant_id::text = current_setting('app.tenant_id', true)
        )
        """
    )
    # risk_selections: strictly tenant-scoped.
    op.execute("ALTER TABLE risk_selections ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE risk_selections FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON risk_selections
        USING (
            current_setting('app.tenant_id', true) IS NULL
            OR current_setting('app.tenant_id', true) = ''
            OR tenant_id::text = current_setting('app.tenant_id', true)
        )
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON risk_selections")
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON risks")
    RiskSelection.__table__.drop(bind=bind)
    Risk.__table__.drop(bind=bind)
