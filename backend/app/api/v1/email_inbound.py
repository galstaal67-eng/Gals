from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_public_db
from app.db.session import set_tenant
from app.models.email_message import EmailMessage
from app.models.tenant import Tenant
from app.schemas.ai import InboundEmail
from app.schemas.email_message import EmailMessageOut

router = APIRouter(prefix="/email", tags=["email"])


@router.post("/inbound", response_model=EmailMessageOut, status_code=status.HTTP_201_CREATED)
async def inbound_email(body: InboundEmail, db: AsyncSession = Depends(get_public_db)):
    """Webhook for inbound client/auditor email (Microsoft Graph, Q2).

    Records the message and routes it to the 'לטיפול היועצים' queue, linked to the
    relevant control/test when provided. Secured by Graph validation in production.
    """
    tenant = (
        await db.execute(select(Tenant).where(Tenant.subdomain == body.subdomain))
    ).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown tenant")
    await set_tenant(db, str(tenant.id))

    msg = EmailMessage(
        tenant_id=tenant.id,
        direction="inbound",
        from_email=body.from_email,
        to_email=body.to_email,
        subject=body.subject,
        body=body.body,
        message_id=body.message_id,
        in_reply_to=body.in_reply_to,
        related_entity_type=body.related_entity_type,
        related_entity_id=body.related_entity_id,
        status="received",
        reviewed=False,
    )
    db.add(msg)
    await db.flush()
    await db.commit()
    await db.refresh(msg)
    return msg
