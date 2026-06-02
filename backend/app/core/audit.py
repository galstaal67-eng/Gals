import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.enums import AuditAction


async def record_audit(
    session: AsyncSession,
    *,
    action: AuditAction,
    entity_type: str,
    entity_id: str | uuid.UUID | None = None,
    tenant_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    before: dict | None = None,
    after: dict | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> AuditLog:
    """Append a row to the append-only audit_log. Caller commits."""
    entry = AuditLog(
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        tenant_id=tenant_id,
        user_id=user_id,
        before_jsonb=before,
        after_jsonb=after,
        ip=ip,
        user_agent=user_agent,
    )
    session.add(entry)
    await session.flush()
    return entry
