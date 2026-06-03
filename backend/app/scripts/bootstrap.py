"""One-time bootstrap: create the first tenant and its admin user.

Solves the chicken-and-egg problem — there is no prior user to authenticate the
first /tenants call. Run once per fresh deployment:

    python -m app.scripts.bootstrap \
        --name "Entropy" --subdomain entropy \
        --admin-email admin@entropy.com --admin-password 'strong-pass'
"""

import argparse
import asyncio

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal, set_tenant
from app.models.enums import AuthProvider, UserRole
from app.models.tenant import Tenant
from app.models.user import User


async def bootstrap(
    *, name: str, subdomain: str, admin_email: str, admin_password: str, ad_tenant_id: str | None
) -> None:
    async with SessionLocal() as db:
        existing = (
            await db.execute(select(Tenant).where(Tenant.subdomain == subdomain))
        ).scalar_one_or_none()
        if existing:
            print(f"Tenant '{subdomain}' already exists ({existing.id}); nothing to do.")
            return

        tenant = Tenant(name=name, subdomain=subdomain, ad_tenant_id=ad_tenant_id)
        db.add(tenant)
        await db.flush()

        await set_tenant(db, str(tenant.id))
        admin = User(
            tenant_id=tenant.id,
            email=admin_email,
            full_name="System Admin",
            role=UserRole.ADMIN,
            auth_provider=AuthProvider.LOCAL,
            hashed_password=hash_password(admin_password),
        )
        db.add(admin)
        await db.commit()
        print(f"Created tenant '{subdomain}' ({tenant.id}) with admin {admin_email}.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap the first tenant + admin.")
    parser.add_argument("--name", required=True)
    parser.add_argument("--subdomain", required=True)
    parser.add_argument("--admin-email", required=True)
    parser.add_argument("--admin-password", required=True)
    parser.add_argument("--ad-tenant-id", default=None)
    args = parser.parse_args()

    asyncio.run(
        bootstrap(
            name=args.name,
            subdomain=args.subdomain,
            admin_email=args.admin_email,
            admin_password=args.admin_password,
            ad_tenant_id=args.ad_tenant_id,
        )
    )


if __name__ == "__main__":
    main()
