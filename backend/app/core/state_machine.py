"""Control state machine (SPEC §4 / DECISIONS). Illegal transitions are rejected.

States: draft (בעריכה) → needs_validation (נדרש תיקוף) → validated (מאושר);
needs_validation ↔ needs_fix (נדרש תיקון); validated may be reopened by a manager.
"""

from app.models.enums import ControlStatus, TestStatus, UserRole

A = UserRole.ADMIN
M = UserRole.MANAGER
C = UserRole.CONSULTANT
CL = UserRole.CLIENT
AU = UserRole.AUDITOR

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


# ---------------------------------------------------------------- test FSM

_TS = TestStatus
# target -> (allowed_source_states or None=any non-terminal, roles)
TEST_TRANSITIONS: dict[TestStatus, tuple[set[TestStatus] | None, set[UserRole]]] = {
    _TS.CONSULTANT_HANDLING: (
        {
            _TS.PENDING_RECEIPT,
            _TS.REVIEWED_APPROVED,
            _TS.COMPANY_COMPLETION,
            _TS.ADDITIONAL_EVIDENCE,
        },
        {A, M, C, AU},
    ),
    _TS.COMPANY_COMPLETION: ({_TS.CONSULTANT_HANDLING, _TS.ADDITIONAL_EVIDENCE}, {A, M, C}),
    _TS.ADDITIONAL_EVIDENCE: ({_TS.COMPANY_COMPLETION, _TS.DEFICIENCY_OPEN}, {A, M, C, CL}),
    _TS.REVIEWED_APPROVED: ({_TS.CONSULTANT_HANDLING, _TS.ADDITIONAL_EVIDENCE}, {A, M, C}),
    _TS.INTERNALLY_CLOSED: ({_TS.REVIEWED_APPROVED}, {A, M, AU}),
    _TS.DEFICIENCY_OPEN: (
        {_TS.CONSULTANT_HANDLING, _TS.ADDITIONAL_EVIDENCE, _TS.REVIEWED_APPROVED},
        {A, M, C},
    ),
    _TS.DEFICIENCY_COMPENSATED: ({_TS.DEFICIENCY_OPEN}, {A, M, C}),
    _TS.DEFICIENCY_CLOSED: ({_TS.DEFICIENCY_OPEN, _TS.DEFICIENCY_COMPENSATED}, {A, M, C}),
    # manual overrides reachable from any state
    _TS.NEEDS_ATTENTION: (None, {A, M}),
    _TS.ROUND_B_PENDING: (None, {A, M, C}),
    _TS.NOT_RELEVANT: (None, {A, M, C}),
}

_TEST_TERMINAL = {_TS.INTERNALLY_CLOSED, _TS.DEFICIENCY_CLOSED, _TS.NOT_RELEVANT}


def can_test_transition(current: TestStatus, target: TestStatus, role: UserRole) -> bool:
    rule = TEST_TRANSITIONS.get(target)
    if not rule:
        return False
    sources, roles = rule
    if role not in roles:
        return False
    if sources is None:  # manual override — allowed from any non-terminal state
        return current not in _TEST_TERMINAL
    return current in sources
