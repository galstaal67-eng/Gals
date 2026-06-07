import { api, getToken } from "./client";
// ---- audit years ----
export interface AuditYear {
  id: string;
  client_id: string;
  year: number;
  status: "open" | "locked" | "archived";
  locked_at: string | null;
}
export const listAuditYears = (clientId: string) =>
  api<AuditYear[]>(`/clients/${clientId}/audit-years`);
export const createAuditYear = (clientId: string, year: number) =>
  api<AuditYear>(`/clients/${clientId}/audit-years`, { method: "POST", body: { year } });
export const lockAuditYear = (yearId: string) =>
  api<AuditYear>(`/audit-years/${yearId}/lock`, { method: "POST" });
export const cloneFromPrevious = (yearId: string) =>
  api<AuditYear>(`/audit-years/${yearId}/clone-from-previous`, { method: "POST" });

// ---- materiality ----
export interface MaterialityParam {
  id: string;
  slot: number;
  parameter_type: string;
  value: string;
  percentage: string;
  computed_threshold: string;
}
export const listMateriality = (yearId: string) =>
  api<MaterialityParam[]>(`/audit-years/${yearId}/materiality-parameters`);
export const createMateriality = (yearId: string, body: Record<string, unknown>) =>
  api<MaterialityParam>(`/audit-years/${yearId}/materiality-parameters`, {
    method: "POST",
    body,
  });

// ---- subsidiaries ----
export interface Subsidiary {
  id: string;
  audit_year_id: string;
  name: string;
  qualitative_result: string | null;
  is_significant: boolean;
  scope_approved: boolean;
}
export const listSubsidiaries = (yearId: string) =>
  api<Subsidiary[]>(`/audit-years/${yearId}/subsidiaries`);
export const createSubsidiary = (yearId: string, name: string) =>
  api<Subsidiary>(`/audit-years/${yearId}/subsidiaries`, { method: "POST", body: { name } });
export const setQualitative = (subId: string, answers: { question_key: string; answer: boolean }[]) =>
  api<Subsidiary>(`/subsidiaries/${subId}/qualitative-answers`, { method: "PUT", body: { answers } });
export const scopeDecision = (subId: string, is_significant: boolean, approve: boolean) =>
  api<Subsidiary>(`/subsidiaries/${subId}/scope-decision`, {
    method: "POST",
    body: { is_significant, approve },
  });

// ---- process bank + selections ----
export interface BankItem {
  id: string;
  name_he: string;
  category?: string;
}
export interface ProcessSelection {
  id: string;
  process_id: string;
  is_material: boolean;
}
export const listProcessBank = (category?: string) =>
  api<BankItem[]>(`/processes/bank${category ? `?category=${category}` : ""}`);
export const createBankProcess = (name_he: string, category: string) =>
  api<BankItem>(`/processes/bank`, { method: "POST", body: { name_he, category } });
export const listProcessSelections = (yearId: string, subId: string) =>
  api<ProcessSelection[]>(`/audit-years/${yearId}/subsidiaries/${subId}/process-selections`);
export const createProcessSelection = (yearId: string, subId: string, process_id: string) =>
  api<ProcessSelection>(`/audit-years/${yearId}/subsidiaries/${subId}/process-selections`, {
    method: "POST",
    body: { process_id },
  });

// ---- risk bank + selections ----
export interface RiskSelection {
  id: string;
  risk_id: string;
  description: string | null;
}
export const listRiskBank = () => api<BankItem[]>(`/risks/bank`);
export const createBankRisk = (name_he: string) =>
  api<BankItem>(`/risks/bank`, { method: "POST", body: { name_he } });
export const listRiskSelections = (pselId: string) =>
  api<RiskSelection[]>(`/process-selections/${pselId}/risks`);
export const createRiskSelection = (pselId: string, risk_id: string) =>
  api<RiskSelection>(`/process-selections/${pselId}/risks`, { method: "POST", body: { risk_id } });

// ---- controls ----
export interface Control {
  id: string;
  control_name: string;
  status: "draft" | "needs_validation" | "needs_fix" | "validated";
}
export const listControls = (rselId: string) =>
  api<Control[]>(`/risk-selections/${rselId}/controls`);
export const createControl = (rselId: string, body: Record<string, unknown>) =>
  api<Control>(`/risk-selections/${rselId}/controls`, { method: "POST", body });
export const transitionControl = (cid: string, target_state: string) =>
  api<Control>(`/controls/${cid}/transition`, { method: "POST", body: { target_state } });

// ---- tests + evidence ----
export interface ControlTest {
  id: string;
  control_id: string;
  status: string;
  severity: string | null;
}
export interface Evidence {
  id: string;
  filename: string;
  file_hash: string | null;
  is_sample: boolean;
}
export const listTestsForControl = (cid: string) => api<ControlTest[]>(`/controls/${cid}/tests`);
export const listTestsForYear = (yearId: string) =>
  api<ControlTest[]>(`/audit-years/${yearId}/tests`);
export const transitionTest = (tid: string, target_state: string) =>
  api<ControlTest>(`/tests/${tid}/transition`, { method: "POST", body: { target_state } });
export const listEvidences = (tid: string) => api<Evidence[]>(`/tests/${tid}/evidences`);

export async function uploadEvidence(testId: string, file: File): Promise<Evidence> {
  const base = import.meta.env.VITE_API_BASE ?? "/api/v1";
  const fd = new FormData();
  fd.append("file", file);
  fd.append("is_sample", "false");
  const resp = await fetch(`${base}/tests/${testId}/evidences/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    body: fd,
  });
  if (!resp.ok) throw new Error(`upload failed: ${resp.status}`);
  return resp.json();
}
