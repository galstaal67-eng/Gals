import { api } from "./client";

export interface AiStatus {
  provider: string;
  active: string;
  model: string | null;
}
export interface ControlSuggestion {
  name: string;
  description: string | null;
  control_type: string | null;
}

export const aiStatus = () => api<AiStatus>(`/ai/status`);

export const suggestControls = (risk_name: string, risk_description?: string | null) =>
  api<ControlSuggestion[]>(`/ai/suggest-controls`, {
    method: "POST",
    body: { risk_name, risk_description: risk_description ?? null },
  });
