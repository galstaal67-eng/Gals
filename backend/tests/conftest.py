import uuid

import pytest_asyncio
from app.api.deps import get_db, get_public_db
from app.core.security import hash_password
from app.db.base import Base
from app.main import app
from app.models.enums import AuthProvider, UserRole
from app.models.tenant import Tenant
from app.models.user import User
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DB_URL, future=True)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def sessionmaker(engine):
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture
async def seed(sessionmaker):
    """Two tenants, each with an admin and a client user — for isolation tests."""
    data = {}
    async with sessionmaker() as s:
        for key in ("a", "b"):
            tenant = Tenant(name=f"Tenant {key}", subdomain=f"tenant-{key}")
            s.add(tenant)
            await s.flush()
            admin = User(
                tenant_id=tenant.id,
                email=f"admin@{key}.com",
                full_name="Admin",
                role=UserRole.ADMIN,
                auth_provider=AuthProvider.LOCAL,
                hashed_password=hash_password("secret123"),
            )
            client_user = User(
                tenant_id=tenant.id,
                email=f"client@{key}.com",
                full_name="Client",
                role=UserRole.CLIENT,
                auth_provider=AuthProvider.LOCAL,
                hashed_password=hash_password("secret123"),
            )
            s.add_all([admin, client_user])
            await s.flush()
            data[key] = {
                "tenant": tenant.id,
                "subdomain": tenant.subdomain,
                "admin": admin.id,
                "client": client_user.id,
            }
        await s.commit()
    return data


@pytest_asyncio.fixture
async def client(sessionmaker):
    async def _override_get_db():
        async with sessionmaker() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_public_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def make_uuid() -> str:
    return str(uuid.uuid4())
