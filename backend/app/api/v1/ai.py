from fastapi import APIRouter, Depends

from app.api.deps import CurrentUser, get_current_user, require
from app.config import settings
from app.core.ai import get_ai_provider
from app.core.rbac import Permission
from app.schemas.ai import ControlSuggestionOut, SuggestControlsRequest

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status")
async def ai_status(_user: CurrentUser = Depends(get_current_user)):
    """Which AI provider is active (heuristic offline default, or anthropic)."""
    provider = type(get_ai_provider()).__name__
    return {"provider": settings.ai_provider, "active": provider, "model": settings.ai_model}


@router.post("/suggest-controls", response_model=list[ControlSuggestionOut])
async def suggest_controls(
    body: SuggestControlsRequest,
    _user: CurrentUser = Depends(require(Permission.CONTROL_CREATE)),
):
    """AI control suggestions for a risk (Phase 6). Provider is pluggable (Q4)."""
    provider = get_ai_provider()
    suggestions = await provider.suggest_controls(
        risk_name=body.risk_name, risk_description=body.risk_description
    )
    return [
        ControlSuggestionOut(
            name=s.name, description=s.description, control_type=s.control_type
        )
        for s in suggestions
    ]
