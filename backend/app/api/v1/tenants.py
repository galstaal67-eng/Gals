from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_public_db, require
from app.core.audit import record_audit
from app.core.rbac import Permission
from app.core.security import hash_password
from app.db.session import set_tenant
from app.models.enums import AuditAction, AuthProvider, UserRole
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.tenant import TenantCreate, TenantOut

router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.post("", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreate,
    actor: CurrentUser = Depends(require(Permission.USER_CREATE)),
    db: AsyncSession = Depends(get_public_db),
):
    """Onboard a new tenant (organization) plus its initial local admin user.

    System-level action (admin). Uses a tenant-unscoped session and sets the
    RLS context to the new tenant before inserting its first user.
    """
    existing = (
        await db.execute(select(Tenant).where(Tenant.subdomain == body.subdomain))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "subdomain already in use")

    tenant = Tenant(name=body.name, subdomain=body.subdomain, ad_tenant_id=body.ad_tenant_id)
    db.add(tenant)
    await db.flush()

    # RLS WITH CHECK requires the session tenant to match the new row's tenant_id.
    await set_tenant(db, str(tenant.id))
    admin = User(
        tenant_id=tenant.id,
        email=body.admin_email,
        full_name=body.admin_full_name,
        role=UserRole.ADMIN,
        auth_provider=AuthProvider.LOCAL,
        hashed_password=hash_password(body.admin_password),
    )
    db.add(admin)
    await db.flush()
    await record_audit(
        db,
        action=AuditAction.CREATE,
        entity_type="tenant",
        entity_id=tenant.id,
        tenant_id=tenant.id,
        user_id=actor.id,
        after={"subdomain": body.subdomain, "admin_email": body.admin_email},
    )
    await db.commit()
    await db.refresh(tenant)
    return tenant
