"""Phase 6: inbound email fields on email_messages

Revision ID: 0010_email_direction
Revises: 0009_email_messages
Create Date: 2026-06-03

Idempotent: 0009 builds email_messages from the current model, which already
includes these columns, so we add each only if it is missing.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_email_direction"
down_revision: str | None = "0009_email_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_COLUMNS = {
    "direction": sa.Column(
        "direction", sa.String(length=8), nullable=False, server_default="outbound"
    ),
    "from_email": sa.Column("from_email", sa.String(length=320), nullable=True),
    "reviewed": sa.Column(
        "reviewed", sa.Boolean(), nullable=False, server_default=sa.false()
    ),
}


def _existing_columns(bind) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns("email_messages")}


def upgrade() -> None:
    bind = op.get_bind()
    existing = _existing_columns(bind)
    for name, column in NEW_COLUMNS.items():
        if name not in existing:
            op.add_column("email_messages", column)


def downgrade() -> None:
    bind = op.get_bind()
    existing = _existing_columns(bind)
    for name in ("reviewed", "from_email", "direction"):
        if name in existing:
            op.drop_column("email_messages", name)
