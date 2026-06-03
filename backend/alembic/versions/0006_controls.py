"""Phase 3: control bank + controls (+RLS)

Revision ID: 0006_controls
Revises: 0005_risks
Create Date: 2026-06-03

"""
from collections.abc import Sequence

from alembic import op
from app.models.control import Control, ControlBank

revision: str = "0006_controls"
down_revision: str | None = "0005_risks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    ControlBank.__table__.create(bind=bind)
    Control.__table__.create(bind=bind)

    if bind.dialect.name != "postgresql":
        return
    # control_bank: admit global rows (tenant_id NULL).
    op.execute("ALTER TABLE control_bank ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE control_bank FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON control_bank
        USING (
            tenant_id IS NULL
            OR current_setting('app.tenant_id', true) IS NULL
            OR current_setting('app.tenant_id', true) = ''
            OR tenant_id::text = current_setting('app.tenant_id', true)
        )
        """
    )
    # controls: strictly tenant-scoped.
    op.execute("ALTER TABLE controls ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE controls FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON controls
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
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON controls")
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON control_bank")
    Control.__table__.drop(bind=bind)
    ControlBank.__table__.drop(bind=bind)
