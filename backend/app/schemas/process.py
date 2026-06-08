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
    order_index: int
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


# ----- flow-diagram steps -----
class ProcessStepCreate(BaseModel):
    name_he: str
    order_index: int | None = None


class ProcessStepUpdate(BaseModel):
    name_he: str | None = None
    order_index: int | None = None


class ProcessStepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    process_selection_id: uuid.UUID
    name_he: str
    order_index: int
    source_sub_activity_id: uuid.UUID | None


class ProcessStepReorder(BaseModel):
    """New order of step ids, first to last."""

    step_ids: list[uuid.UUID]


class StepFlowOut(BaseModel):
    """A step plus the aggregated status of its risks/controls/tests, for the
    flow diagram."""

    id: uuid.UUID
    name_he: str
    order_index: int
    risk_count: int
    control_count: int
    test_count: int
    tests_passed: int
    tests_failed: int
    tests_pending: int
    tests_in_progress: int
    status: str  # empty | pending | in_progress | failed | passed


class ProcessFlowOut(BaseModel):
    process_selection_id: uuid.UUID
    steps: list[StepFlowOut]
