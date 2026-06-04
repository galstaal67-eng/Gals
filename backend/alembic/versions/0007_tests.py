"""Phase 4: control_tests + evidences (+RLS)

Revision ID: 0007_tests
Revises: 0006_controls
Create Date: 2026-06-03

"""
from collections.abc import Sequence

from alembic import op
from app.models.control_test import ControlTest, Evidence

revision: str = "0007_tests"
down_revision: str | None = "0006_controls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ["control_tests", "evidences"]


def upgrade() -> None:
    bind = op.get_bind()
    ControlTest.__table__.create(bind=bind, checkfirst=True)
    Evidence.__table__.create(bind=bind, checkfirst=True)

    if bind.dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
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
        for table in TABLES:
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    Evidence.__table__.drop(bind=bind, checkfirst=True)
    ControlTest.__table__.drop(bind=bind, checkfirst=True)
