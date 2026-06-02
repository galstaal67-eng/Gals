import enum


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    MANAGER = "manager"  # מנהל תיק
    CONSULTANT = "consultant"  # יועץ
    CLIENT = "client"  # לקוח
    AUDITOR = "auditor"  # רו"ח מבקר


class ClientSubrole(str, enum.Enum):
    CONTROL_OWNER = "control_owner"  # אחראי בקרה
    CONTROL_OPERATOR = "control_operator"  # מבצע בקרה


class AuthProvider(str, enum.Enum):
    ENTRA = "entra"  # יועצים פנימיים (Azure AD / SSO)
    LOCAL = "local"  # לקוחות / רו"ח (שם משתמש + סיסמה + 2FA)


class TenantStatus(str, enum.Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class AuditYearStatus(str, enum.Enum):
    OPEN = "open"
    LOCKED = "locked"
    ARCHIVED = "archived"


class AuditAction(str, enum.Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    APPROVE = "APPROVE"
    REJECT = "REJECT"
    LOGIN = "LOGIN"


# Test status enum — 12 values (SPEC §3 / DECISIONS C2). Phase 4, defined early
# as the canonical source so downstream modules align.
class TestStatus(str, enum.Enum):
    PENDING_RECEIPT = "pending_receipt"
    CONSULTANT_HANDLING = "consultant_handling"
    COMPANY_COMPLETION = "company_completion"
    ADDITIONAL_EVIDENCE = "additional_evidence"
    REVIEWED_APPROVED = "reviewed_approved"
    INTERNALLY_CLOSED = "internally_closed"
    NEEDS_ATTENTION = "needs_attention"
    DEFICIENCY_OPEN = "deficiency_open"
    DEFICIENCY_COMPENSATED = "deficiency_compensated"
    DEFICIENCY_CLOSED = "deficiency_closed"
    ROUND_B_PENDING = "round_b_pending"
    NOT_RELEVANT = "not_relevant"
