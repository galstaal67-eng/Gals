import uuid

from pydantic import BaseModel, ConfigDict


class ClientCreate(BaseModel):
    name: str
    activity_description: str | None = None
    industry: str | None = None
    address: str | None = None
    is_public: bool = False
    regulations: list[str] | None = None


class ClientUpdate(BaseModel):
    name: str | None = None
    activity_description: str | None = None
    industry: str | None = None
    address: str | None = None
    is_public: bool | None = None
    regulations: list[str] | None = None


class ClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    activity_description: str | None
    industry: str | None
    address: str | None
    is_public: bool
    regulations: list[str] | None
