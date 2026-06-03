"""Phase 2: process bank + sub-activities + selections (+RLS)

Revision ID: 0004_processes
Revises: 0003_subsidiaries
Create Date: 2026-06-03

"""
from collections.abc import Sequence

from alembic import op
from app.models.process import Process, SubActivity
from app.models.process_selection import ProcessSelection

revision: str = "0004_processes"
down_revision: str | None = "0003_subsidiaries"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Bank tables hold global rows (tenant_id NULL) shared across tenants, so the
# policy also admits NULL tenant_id. Selections are strictly tenant-scoped.
BANK_TABLES = ["processes", "sub_activities"]
SCOPED_TABLES = ["process_selections"]


def _bank_policy(table: str) -> str:
    return f"""
        CREATE POLICY tenant_isolation ON {table}
        USING (
            tenant_id IS NULL
            OR current_setting('app.tenant_id', true) IS NULL
            OR current_setting('app.tenant_id', true) = ''
            OR tenant_id::text = current_setting('app.tenant_id', true)
        )
    """


def _scoped_policy(table: str) -> str:
    return f"""
        CREATE POLICY tenant_isolation ON {table}
        USING (
            current_setting('app.tenant_id', true) IS NULL
            OR current_setting('app.tenant_id', true) = ''
            OR tenant_id::text = current_setting('app.tenant_id', true)
        )
    """


def upgrade() -> None:
    bind = op.get_bind()
    Process.__table__.create(bind=bind)
    SubActivity.__table__.create(bind=bind)
    ProcessSelection.__table__.create(bind=bind)

    if bind.dialect.name != "postgresql":
        return
    for table in BANK_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(_bank_policy(table))
    for table in SCOPED_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(_scoped_policy(table))


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table in [*BANK_TABLES, *SCOPED_TABLES]:
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
    ProcessSelection.__table__.drop(bind=bind)
    SubActivity.__table__.drop(bind=bind)
    Process.__table__.drop(bind=bind)
