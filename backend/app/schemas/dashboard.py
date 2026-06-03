from pydantic import BaseModel


class DashboardOut(BaseModel):
    audit_year_id: str | None = None
    controls_total: int
    controls_by_status: dict[str, int]
    key_controls: int
    non_key_controls: int
    tests_total: int
    tests_by_status: dict[str, int]
    deficiencies_by_severity: dict[str, int]
