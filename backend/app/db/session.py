from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings

engine = create_async_engine(settings.database_url, echo=settings.debug, future=True)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def set_tenant(session: AsyncSession, tenant_id: str | None) -> None:
    """Set the PostgreSQL session variable used by RLS policies.

    RLS policies filter rows by current_setting('app.tenant_id'). Setting it
    per-request enforces multi-tenant isolation at the database layer.
    Skipped on backends without RLS (e.g. SQLite in tests).
    """
    if session.bind is None or session.bind.dialect.name != "postgresql":
        return
    await session.execute(
        text("SELECT set_config('app.tenant_id', :tid, true)"),
        {"tid": str(tenant_id) if tenant_id else ""},
    )


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
