"""AI abstraction (Q4) — no lock-in.

A provider protocol with two implementations:
- HeuristicProvider: deterministic, offline default (works without keys/network).
- AnthropicProvider: calls the Claude API when configured (ai_provider=anthropic
  + anthropic_api_key). Prompt caching is applied to the static system prompt.

Data-residency note (DECISIONS R2): enabling the Anthropic provider sends the
prompt to an external service; gate it behind tenant policy in production.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

from app.config import settings

_SYSTEM_PROMPT = (
    "You are a SOX internal-controls expert. Given a risk, suggest concrete key "
    "controls that mitigate it. Reply ONLY with a JSON array of objects with keys "
    "name, description, control_type (preventive|detective). Hebrew text for "
    "name/description."
)


@dataclass
class ControlSuggestion:
    name: str
    description: str
    control_type: str


class AIProvider(Protocol):
    async def suggest_controls(
        self, *, risk_name: str, risk_description: str | None
    ) -> list[ControlSuggestion]: ...


class HeuristicProvider:
    """Deterministic suggestions from simple templates — no external call."""

    async def suggest_controls(
        self, *, risk_name: str, risk_description: str | None
    ) -> list[ControlSuggestion]:
        base = risk_name.strip()
        return [
            ControlSuggestion(
                name=f"בקרה מונעת ל{base}",
                description=f"אישור/הרשאה מקדימה למניעת התממשות הסיכון: {base}.",
                control_type="preventive",
            ),
            ControlSuggestion(
                name=f"בקרה מגלה ל{base}",
                description=f"התאמה/סקירה תקופתית לזיהוי חריגות הקשורות ל{base}.",
                control_type="detective",
            ),
        ]


class AnthropicProvider:
    """Claude-backed suggestions. Lazy SDK import; used only when configured."""

    def __init__(self, api_key: str, model: str) -> None:
        self._api_key = api_key
        self._model = model

    async def suggest_controls(
        self, *, risk_name: str, risk_description: str | None
    ) -> list[ControlSuggestion]:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=self._api_key)
        resp = await client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=[
                {
                    "type": "text",
                    "text": _SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": f"סיכון: {risk_name}\nתיאור: {risk_description or ''}",
                }
            ],
        )
        text = "".join(block.text for block in resp.content if block.type == "text")
        data = json.loads(text)
        return [
            ControlSuggestion(
                name=item["name"],
                description=item.get("description", ""),
                control_type=item.get("control_type", "preventive"),
            )
            for item in data
        ]


def get_ai_provider() -> AIProvider:
    if settings.ai_provider == "anthropic" and settings.anthropic_api_key:
        return AnthropicProvider(settings.anthropic_api_key, settings.ai_model)
    return HeuristicProvider()
