"""Role-Based Access Control — permission matrix from the spec (§4 הרשאות).

Scoping qualifiers from the spec (only-for-assigned-clients etc.) are enforced
separately via UserAssignment; this matrix encodes the coarse role capability.
"""

import enum

from app.models.enums import UserRole


class Permission(str, enum.Enum):
    # ניהול לקוחות
    CLIENT_CREATE = "client:create"
    CLIENT_EDIT = "client:edit"
    CLIENT_DELETE = "client:delete"
    CLIENT_VIEW = "client:view"
    # ניהול משתמשים
    USER_VIEW = "user:view"
    USER_CREATE = "user:create"
    USER_EDIT_PERMISSIONS = "user:edit_permissions"
    USER_DEACTIVATE = "user:deactivate"
    # אנשי קשר (בנק)
    CONTACT_VIEW = "contact:view"
    CONTACT_MANAGE = "contact:manage"
    # שנות ביקורת
    AUDIT_YEAR_CREATE = "audit_year:create"
    AUDIT_YEAR_EDIT = "audit_year:edit"
    AUDIT_YEAR_LOCK = "audit_year:lock"
    AUDIT_YEAR_VIEW = "audit_year:view"
    # דוחות
    REPORT_EXPORT = "report:export"


A = UserRole.ADMIN
M = UserRole.MANAGER
C = UserRole.CONSULTANT
CL = UserRole.CLIENT
AU = UserRole.AUDITOR

# Permission -> set of roles allowed. (* / ** scoping handled via assignments.)
PERMISSION_ROLES: dict[Permission, set[UserRole]] = {
    Permission.CLIENT_CREATE: {A, M},
    Permission.CLIENT_EDIT: {A, M},
    Permission.CLIENT_DELETE: {A},
    Permission.CLIENT_VIEW: {A, M, C, CL},
    Permission.USER_VIEW: {A, M},
    Permission.USER_CREATE: {A},
    Permission.USER_EDIT_PERMISSIONS: {A},
    Permission.USER_DEACTIVATE: {A, M},
    Permission.CONTACT_VIEW: {A, M, C, CL},
    Permission.CONTACT_MANAGE: {A, M},
    Permission.AUDIT_YEAR_CREATE: {A, M, C},
    Permission.AUDIT_YEAR_EDIT: {A, M, C},
    Permission.AUDIT_YEAR_LOCK: {A, M},
    Permission.AUDIT_YEAR_VIEW: {A, M, C, CL},
    Permission.REPORT_EXPORT: {A, M, C, CL, AU},
}


def has_permission(role: UserRole, permission: Permission) -> bool:
    return role in PERMISSION_ROLES.get(permission, set())
