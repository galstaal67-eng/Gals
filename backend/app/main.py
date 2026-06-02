from fastapi import FastAPI

from app.api.v1.router import api_router
from app.config import settings

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="SOX management system — Phase 1 MVP (clients, users, auth).",
)

app.include_router(api_router)


@app.get("/health", tags=["meta"])
async def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}
