import uuid

from pydantic import BaseModel, ConfigDict

from app.models.enums import ItgcLayer, ProcessCategory


# ----- bank (catalog) -----
class ProcessBankCreate(BaseModel):
    code: str | None = None
    name_he: str
    name_en: str | None = None
    category: ProcessCategory


class ProcessBankOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str | None
    name_he: str
    name_en: str | None
    category: ProcessCategory
    is_global: bool


class SubActivityCreate(BaseModel):
    name_he: str
    name_en: str | None = None


class SubActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    process_id: uuid.UUID
    name_he: str
    name_en: str | None
    is_global: bool


# ----- instances (selections) -----
class ProcessSelectionCreate(BaseModel):
    process_id: uuid.UUID
    sub_activity_id: uuid.UUID | None = None
    itgc_layer: ItgcLayer | None = None
    is_material: bool = False


class ProcessSelectionUpdate(BaseModel):
    sub_activity_id: uuid.UUID | None = None
    itgc_layer: ItgcLayer | None = None
    is_in_scope: bool | None = None
    is_material: bool | None = None


class ProcessSelectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    audit_year_id: uuid.UUID
    subsidiary_id: uuid.UUID
    process_id: uuid.UUID
    sub_activity_id: uuid.UUID | None
    itgc_layer: ItgcLayer | None
    is_in_scope: bool
    is_material: bool
