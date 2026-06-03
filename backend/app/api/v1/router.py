from fastapi import APIRouter

from app.api.v1 import auth, clients, contacts, mfa, tenants, users

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(mfa.router)
api_router.include_router(tenants.router)
api_router.include_router(users.router)
api_router.include_router(clients.router)
api_router.include_router(contacts.router)
