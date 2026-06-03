from fastapi import APIRouter

from app.api.v1 import (
    audit_years,
    auth,
    clients,
    contacts,
    controls,
    dashboards,
    mfa,
    notifications,
    processes,
    reports,
    risks,
    subsidiaries,
    tenants,
    tests,
    users,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(mfa.router)
api_router.include_router(tenants.router)
api_router.include_router(users.router)
api_router.include_router(clients.router)
api_router.include_router(contacts.router)
api_router.include_router(audit_years.router)
api_router.include_router(subsidiaries.router)
api_router.include_router(processes.router)
api_router.include_router(risks.router)
api_router.include_router(controls.router)
api_router.include_router(tests.router)
api_router.include_router(notifications.router)
api_router.include_router(dashboards.router)
api_router.include_router(reports.router)
