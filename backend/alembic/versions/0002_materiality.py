"""Phase 2: materiality_parameters table (+RLS)

Revision ID: 0002_materiality
Revises: 0001_initial
Create Date: 2026-06-03

"""
from collections.abc import Sequence

from alembic import op
from app.models.materiality import MaterialityParameter  # noqa: F401

revision: str = "0002_materiality"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "materiality_parameters"


def upgrade() -> None:
    bind = op.get_bind()
    MaterialityParameter.__table__.create(bind=bind, checkfirst=True)

    if bind.dialect.name != "postgresql":
        return
    op.execute(f"ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON {TABLE}
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
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {TABLE}")
    MaterialityParameter.__table__.drop(bind=bind, checkfirst=True)
