import uuid

from pydantic import BaseModel, ConfigDict

from app.models.enums import Regulation, Sector


class ClientCreate(BaseModel):
    name: str
    activity_description: str | None = None
    industry: Sector | None = None
    address: str | None = None
    is_public: bool = False
    regulations: list[Regulation] | None = None


class ClientUpdate(BaseModel):
    name: str | None = None
    activity_description: str | None = None
    industry: Sector | None = None
    address: str | None = None
    is_public: bool | None = None
    regulations: list[Regulation] | None = None


class ClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    activity_description: str | None
    industry: Sector | None
    address: str | None
    is_public: bool
    regulations: list[Regulation] | None
