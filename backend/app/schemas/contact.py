import uuid

from pydantic import BaseModel, ConfigDict, EmailStr


class ContactCreate(BaseModel):
    full_name: str
    role_title: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    manager_name: str | None = None
    subsidiary_id: uuid.UUID | None = None


class ContactUpdate(BaseModel):
    full_name: str | None = None
    role_title: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    manager_name: str | None = None
    subsidiary_id: uuid.UUID | None = None


class ContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    client_id: uuid.UUID
    full_name: str
    role_title: str | None
    email: EmailStr | None
    phone: str | None
    manager_name: str | None
    subsidiary_id: uuid.UUID | None
