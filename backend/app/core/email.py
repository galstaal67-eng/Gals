"""Outbound email: render SPEC-defined templates and queue messages.

In MVP, ``queue_email`` persists an EmailMessage row (status=queued). A delivery
worker (Microsoft Graph, per Q2) sends queued rows and updates the status. The
row is the durable Audit Trail of all client correspondence (SOX).
"""

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email_message import EmailMessage


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
