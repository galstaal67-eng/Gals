"""Control state machine (SPEC §4 / DECISIONS). Illegal transitions are rejected.

States: draft (בעריכה) → needs_validation (נדרש תיקוף) → validated (מאושר);
needs_validation ↔ needs_fix (נדרש תיקון); validated may be reopened by a manager.
"""

from app.models.enums import ControlStatus, UserRole

A = UserRole.ADMIN
M = UserRole.MANAGER
C = UserRole.CONSULTANT
CL = UserRole.CLIENT

# target_state -> (allowed_source_states, roles_allowed_to_perform)
CONTROL_TRANSITIONS: dict[ControlStatus, tuple[set[ControlStatus], set[UserRole]]] = {
    ControlStatus.NEEDS_VALIDATION: ({ControlStatus.DRAFT, ControlStatus.NEEDS_FIX}, {A, M, C}),
    ControlStatus.VALIDATED: ({ControlStatus.NEEDS_VALIDATION}, {A, M, C, CL}),
    ControlStatus.NEEDS_FIX: ({ControlStatus.NEEDS_VALIDATION}, {A, M, C, CL}),
    ControlStatus.DRAFT: ({ControlStatus.VALIDATED}, {A, M}),  # reopen — manager only
}


def can_transition(current: ControlStatus, target: ControlStatus, role: UserRole) -> bool:
    rule = CONTROL_TRANSITIONS.get(target)
    if not rule:
        return False
    sources, roles = rule
    return current in sources and role in roles
