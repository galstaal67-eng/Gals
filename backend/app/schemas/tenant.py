import uuid

from pydantic import BaseModel, ConfigDict, EmailStr


class TenantCreate(BaseModel):
    name: str
    subdomain: str
    ad_tenant_id: str | None = None
    admin_email: EmailStr
    admin_full_name: str
    admin_password: str


class TenantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    subdomain: str
    ad_tenant_id: str | None
