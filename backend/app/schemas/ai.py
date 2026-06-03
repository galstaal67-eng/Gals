from pydantic import BaseModel


class SuggestControlsRequest(BaseModel):
    risk_name: str
    risk_description: str | None = None


class ControlSuggestionOut(BaseModel):
    name: str
    description: str
    control_type: str


class EvidenceComparison(BaseModel):
    added: list[str]
    removed: list[str]
    unchanged: list[str]


class InboundEmail(BaseModel):
    subdomain: str
    from_email: str
    to_email: str
    subject: str
    body: str
    message_id: str | None = None
    in_reply_to: str | None = None
    related_entity_type: str | None = None
    related_entity_id: str | None = None
