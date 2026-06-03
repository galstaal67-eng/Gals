from fastapi import APIRouter, Depends

from app.api.deps import CurrentUser, require
from app.core.ai import get_ai_provider
from app.core.rbac import Permission
from app.schemas.ai import ControlSuggestionOut, SuggestControlsRequest

router = APIRouter(prefix="/ai", tags=["ai"])


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
