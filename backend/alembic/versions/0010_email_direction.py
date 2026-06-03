"""Phase 6: inbound email fields on email_messages

Revision ID: 0010_email_direction
Revises: 0009_email_messages
Create Date: 2026-06-03

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_email_direction"
down_revision: str | None = "0009_email_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "email_messages",
        sa.Column("direction", sa.String(length=8), nullable=False, server_default="outbound"),
    )
    op.add_column("email_messages", sa.Column("from_email", sa.String(length=320), nullable=True))
    op.add_column(
        "email_messages",
        sa.Column("reviewed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("email_messages", "reviewed")
    op.drop_column("email_messages", "from_email")
    op.drop_column("email_messages", "direction")
