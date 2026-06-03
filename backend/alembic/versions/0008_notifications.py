"""Phase 5: notifications (+RLS)

Revision ID: 0008_notifications
Revises: 0007_tests
Create Date: 2026-06-03

"""
from collections.abc import Sequence

from alembic import op
from app.models.notification import Notification

revision: str = "0008_notifications"
down_revision: str | None = "0007_tests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    Notification.__table__.create(bind=bind)

    if bind.dialect.name != "postgresql":
        return
    op.execute("ALTER TABLE notifications ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE notifications FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON notifications
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
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON notifications")
    Notification.__table__.drop(bind=bind)
