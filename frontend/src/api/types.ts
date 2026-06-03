export type Role = "admin" | "manager" | "consultant" | "client" | "auditor";

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface MFARequired {
  mfa_required: true;
  mfa_token: string;
}

export interface Client {
  id: string;
  tenant_id: string;
  name: string;
  activity_description: string | null;
  industry: string | null;
  address: string | null;
  is_public: boolean;
  regulations: string[] | null;
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  role: Role;
  client_subrole: string | null;
  auth_provider: string;
  is_active: boolean;
  mfa_enabled: boolean;
}
