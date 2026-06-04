"""Phase 2: subsidiaries + qualitative answers (+RLS)

Revision ID: 0003_subsidiaries
Revises: 0002_materiality
Create Date: 2026-06-03

"""
from collections.abc import Sequence

from alembic import op
from app.models.subsidiary import Subsidiary, SubsidiaryQualitativeAnswer

revision: str = "0003_subsidiaries"
down_revision: str | None = "0002_materiality"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ["subsidiaries", "subsidiary_qualitative_answers"]


def upgrade() -> None:
    bind = op.get_bind()
    Subsidiary.__table__.create(bind=bind, checkfirst=True)
    SubsidiaryQualitativeAnswer.__table__.create(bind=bind, checkfirst=True)

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
    SubsidiaryQualitativeAnswer.__table__.drop(bind=bind, checkfirst=True)
    Subsidiary.__table__.drop(bind=bind, checkfirst=True)
