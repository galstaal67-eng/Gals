import { api } from "./client";

export interface Dashboard {
  audit_year_id: string | null;
  controls_total: number;
  controls_by_status: Record<string, number>;
  key_controls: number;
  non_key_controls: number;
  tests_total: number;
  tests_by_status: Record<string, number>;
  deficiencies_by_severity: Record<string, number>;
}

export type DashboardRole = "consultant" | "client" | "auditor";

export const getDashboard = (role: DashboardRole) => api<Dashboard>(`/dashboards/${role}`);
