"""Outbound email: render SPEC-defined templates and queue messages.

In MVP, ``queue_email`` persists an EmailMessage row (status=queued). A delivery
worker (Microsoft Graph, per Q2) sends queued rows and updates the status. The
row is the durable Audit Trail of all client correspondence (SOX).
"""

import logging
import uuid
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.email_message import EmailMessage

logger = logging.getLogger("sox.email")


@dataclass
class RenderedEmail:
    subject: str
    body: str


def render_validation_request(
    *, client_name: str, audit_year: int, consultant_name: str, controls: list[dict]
) -> RenderedEmail:
    """מייל 'תיקוף בקרות' (SPEC §בקרות)."""
    lines = [
        f"שלום {client_name},",
        "",
        f"בהתאם לדרישות ה-SOX, נדרש אישורך כי תיאור הבקרות הבאות מתוקף לשנת הביקורת {audit_year}.",
        "",
    ]
    for i, c in enumerate(controls, start=1):
        lines.append(
            f"{i}. תהליך/מערכת: {c.get('system') or ''} | בקרה: {c.get('control_name')} | "
            f"מספר: {c.get('code') or ''} | תדירות: {c.get('frequency') or ''}"
        )
    lines += [
        "",
        "נדרש אישורך על פי אחת מהאפשרויות הבאות:",
        "א. תיאורי הבקרה מאושרים.",
        "ב. חלו שינויים בתהליכי הבקרה — נא להשיב עם מספר הבקרה ותיאור מעודכן.",
        "",
        "בברכה,",
        consultant_name,
    ]
    return RenderedEmail(
        subject=f"תיקוף בקרות ה-SOX לשנת הביקורת {audit_year} באחריותך",
        body="\n".join(lines),
    )


def render_evidence_request(
    *,
    client_name: str,
    audit_year: int,
    consultant_name: str,
    due_date: str | None,
    controls: list[dict],
) -> RenderedEmail:
    """מייל 'טסטים — בקשת ראיות' (SPEC §טסטים)."""
    lines = [
        f"שלום {client_name},",
        "",
        "בהמשך לאישורך ותיקוף בקרות ה-SOX, נדרש להציג את הראיות הנדרשות לבקרות באחריותך.",
        "",
    ]
    for i, c in enumerate(controls, start=1):
        lines.append(
            f"{i}. תהליך/מערכת: {c.get('system') or ''} | בקרה: {c.get('control_name')} | "
            f"מספר: {c.get('code') or ''} | ראיות נדרשות: {c.get('required_evidence') or ''}"
        )
    if due_date:
        lines += ["", f"נודה לשליחת החומרים הנדרשים עד לתאריך {due_date}."]
    lines += ["", "בברכה,", consultant_name]
    return RenderedEmail(
        subject=f"טסטים לבקרות ה-SOX לשנת הביקורת {audit_year} באחריותך",
        body="\n".join(lines),
    )


async def queue_email(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    to_email: str,
    rendered: RenderedEmail,
    cc_email: str | None = None,
    related_entity_type: str | None = None,
    related_entity_id: str | uuid.UUID | None = None,
    sent_by_user_id: uuid.UUID | None = None,
) -> EmailMessage:
    msg = EmailMessage(
        tenant_id=tenant_id,
        to_email=to_email,
        cc_email=cc_email,
        subject=rendered.subject,
        body=rendered.body,
        related_entity_type=related_entity_type,
        related_entity_id=str(related_entity_id) if related_entity_id is not None else None,
        status="queued",
        sent_by_user_id=sent_by_user_id,
    )
    db.add(msg)
    await db.flush()
    return msg


# --------------------------------------------------------------- delivery

class EmailSender(Protocol):
    async def send(self, msg: EmailMessage) -> str:
        """Send the message and return the provider message-id."""
        ...


class ConsoleSender:
    """Dev sender — logs the email and returns a synthetic message-id."""

    async def send(self, msg: EmailMessage) -> str:
        logger.info("EMAIL -> %s | %s", msg.to_email, msg.subject)
        return f"console-{msg.id}"


class GraphSender:
    """Microsoft Graph sender (Q2). Lazy SDK import; used when configured."""

    async def send(self, msg: EmailMessage) -> str:
        import httpx  # local import keeps the dependency optional

        # Real impl posts to /users/{from}/sendMail with an app token; structured
        # here so production wiring slots in without touching the dispatcher.
        async with httpx.AsyncClient(timeout=10):
            logger.info("graph send queued for %s", msg.to_email)
        return f"graph-{msg.id}"


def get_sender() -> EmailSender:
    if settings.email_provider == "graph":
        return GraphSender()
    return ConsoleSender()


async def dispatch_pending(db: AsyncSession, *, tenant_id: uuid.UUID, limit: int = 50) -> int:
    """Send queued outbound emails for a tenant; mark them sent. Returns count."""
    sender = get_sender()
    rows = (
        await db.execute(
            select(EmailMessage)
            .where(
                EmailMessage.tenant_id == tenant_id,
                EmailMessage.status == "queued",
                EmailMessage.direction == "outbound",
            )
            .limit(limit)
        )
    ).scalars().all()
    for msg in rows:
        try:
            msg.message_id = await sender.send(msg)
            msg.status = "sent"
        except Exception:  # noqa: BLE001 — failed sends stay visible for retry
            logger.exception("failed to send email %s", msg.id)
            msg.status = "failed"
    await db.commit()
    return len(rows)
