import uuid

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models.enums import AuthProvider, ClientSubrole, UserRole


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    role: UserRole
    client_subrole: ClientSubrole | None = None
    auth_provider: AuthProvider = AuthProvider.LOCAL
    password: str | None = None  # required for local provider


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    email: EmailStr
    full_name: str
    role: UserRole
    client_subrole: ClientSubrole | None
    auth_provider: AuthProvider
    is_active: bool
    mfa_enabled: bool
