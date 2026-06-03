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


class Sector(str, enum.Enum):
    """סקטור פעילות — רשימה סגורה (טאב מידע כללי)."""

    HITECH = "hitech"  # הייטק
    CREDIT = "credit"  # אשראי
    EDUCATION = "education"  # חינוך
    INSURANCE = "insurance"  # ביטוח
    FINANCE = "finance"  # פיננסים
    BANKING = "banking"  # בנקאות
    HEALTH = "health"  # בריאות
    RETAIL = "retail"  # קמעונאות
    GOVERNMENT = "government"  # ממשלתי


class Regulation(str, enum.Enum):
    SOX = "SOX"
    ISOX = "ISOX"
    CSOX = "CSOX"


class TenantStatus(str, enum.Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class AuditYearStatus(str, enum.Enum):
    OPEN = "open"
    LOCKED = "locked"
    ARCHIVED = "archived"


class QualitativeQuestion(str, enum.Enum):
    """5 השאלות האיכותיות לבחינת חברת בת (טאב חברות בנות)."""

    SEPARATE_LOCATION = "separate_location"  # מיקום פיזי נפרד
    SEPARATE_MANAGEMENT = "separate_management"  # הנהלה/דירקטוריון נפרדים
    SEPARATE_SYSTEMS = "separate_systems"  # מערכות מידע מופרדות
    UNIQUE_REPORTING_RISK = "unique_reporting_risk"  # סיכון ייחודי בדיווח/גילוי
    FRAUD_OR_ERROR = "fraud_or_error"  # הונאות/מעילות/טעויות מהותיות


class ScopeResult(str, enum.Enum):
    PASS = "pass"  # נכנס לסקופ / מהותי
    FAIL = "fail"  # לא מהותי


class ProcessCategory(str, enum.Enum):
    BUSINESS = "business"  # עסקי
    ITGC = "itgc"


class ItgcLayer(str, enum.Enum):
    """רובד — נבחר רק כאשר התהליך הוא ITGC."""

    NETWORK = "network"  # רשת
    APPLICATION = "application"  # אפליקציה
    DATABASE = "database"  # בסיס נתונים
    APP_SERVER = "app_server"  # שרת אפליקציה
    DB_SERVER = "db_server"  # שרת בסיס נתונים


class RiskClassification(str, enum.Enum):
    FINANCIAL = "financial"  # כספי
    OPERATIONAL = "operational"  # תפעולי


class RiskComplexity(str, enum.Enum):
    MEDIUM = "medium"  # בינונית
    MEDIUM_HIGH = "medium_high"  # בינונית-גבוהה
    HIGH = "high"  # גבוהה


class RiskFrequency(str, enum.Enum):
    DAILY = "daily"  # יומית
    MULTIPLE_DAILY = "multiple_daily"  # רב פעמי ביום
    MULTIPLE_MONTHLY = "multiple_monthly"  # מספר פעמים בחודש
    MULTIPLE_YEARLY = "multiple_yearly"  # מספר פעמים בשנה
    ANNUAL_PLUS = "annual_plus"  # שנתית ומעלה


class RiskProbability(str, enum.Enum):
    LOW = "low"  # נמוכה
    MEDIUM = "medium"  # בינונית
    HIGH = "high"  # גבוהה
    VERY_HIGH = "very_high"  # גבוהה מאוד


class RiskRating(str, enum.Enum):
    LOW = "low"  # קל
    MEDIUM = "medium"  # בינוני
    HIGH = "high"  # גבוה
    VERY_HIGH = "very_high"  # גבוה מאוד


class ControlStatus(str, enum.Enum):
    """סטאטוס בקרה — 4 מצבים (טאב בקרות)."""

    DRAFT = "draft"  # בעריכה
    NEEDS_VALIDATION = "needs_validation"  # נדרש תיקוף
    NEEDS_FIX = "needs_fix"  # נדרש תיקון
    VALIDATED = "validated"  # מאושר


class ControlPurpose(str, enum.Enum):
    PREVENTIVE = "preventive"  # מונעת
    DIRECTIVE = "directive"  # מנחה
    DETECTIVE = "detective"  # מגלה
    COMPENSATING = "compensating"  # מפצה


class ControlType(str, enum.Enum):
    MANUAL = "manual"  # ידנית
    AUTOMATIC = "automatic"  # אוטומטית
    HYBRID = "hybrid"  # משולבת


class ControlFrequency(str, enum.Enum):
    ONGOING = "ongoing"  # שוטף
    AUTOMATIC = "automatic"  # אוטומטית
    MONTHLY = "monthly"  # חודשית
    QUARTERLY = "quarterly"  # רבעונית
    SEMIANNUAL = "semiannual"  # חצי שנתית
    ANNUAL = "annual"  # שנתית


class MaterialityParameterType(str, enum.Enum):
    """פרמטר לקביעת סף מהותיות — רשימה סגורה (טאב שנת ביקורת)."""

    SALES = "sales"  # מכירות
    NET_INCOME = "net_income"  # רווח (הפסד) נקי
    ASSETS = "assets"  # נכסים
    OPERATING_INCOME = "operating_income"  # רווח תפעולי
    EQUITY = "equity"  # הון עצמי (גרעון בהון)
    PRETAX_INCOME = "pretax_income"  # רווח (הפסד) לפני מס
    CASH = "cash"  # מזומנים
    OPERATING_EXPENSES = "operating_expenses"  # הוצאות תפעוליות


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


class TestRound(str, enum.Enum):
    """סבב הבדיקות (טאב טסטים)."""

    ROUND_A = "round_a"  # סבב א'
    ROUND_B = "round_b"  # סבב ב'
    BOTH = "both"  # שניהם
    NOT_REQUIRED = "not_required"  # לא נדרש לביצוע


class DeficiencySeverity(str, enum.Enum):
    """חומרת ליקוי — שדה נפרד, אינו סטטוס (SPEC C2)."""

    DEFICIENCY = "deficiency"  # ליקוי
    MATERIAL_DEFICIENCY = "material_deficiency"  # ליקוי מהותי
    MATERIAL_WEAKNESS = "material_weakness"  # חולשה מהותית


class ControlEffectiveness(str, enum.Enum):
    EFFECTIVE = "effective"  # אפקטיבית
    INEFFECTIVE = "ineffective"  # לא אפקטיבית
    NOT_RELEVANT = "not_relevant"  # לא רלוונטי


class NotificationChannel(str, enum.Enum):
    IN_APP = "in_app"
    EMAIL = "email"
    SMS = "sms"
