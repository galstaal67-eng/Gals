"""Phase 5 gap: email_messages (+RLS)

Revision ID: 0009_email_messages
Revises: 0008_notifications
Create Date: 2026-06-03

"""
from collections.abc import Sequence

from alembic import op
from app.models.email_message import EmailMessage

revision: str = "0009_email_messages"
down_revision: str | None = "0008_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    EmailMessage.__table__.create(bind=bind, checkfirst=True)

    if bind.dialect.name != "postgresql":
        return
    op.execute("ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE email_messages FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON email_messages
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
        op.execute("DROP POLICY IF EXISTS tenant_isolation ON email_messages")
    EmailMessage.__table__.drop(bind=bind, checkfirst=True)
