import { api } from "./client";
import type { MFARequired, TokenResponse } from "./types";

export async function login(
  subdomain: string,
  email: string,
  password: string,
): Promise<TokenResponse | MFARequired> {
  return api<TokenResponse | MFARequired>("/auth/login", {
    method: "POST",
    auth: false,
    body: { subdomain, email, password },
  });
}

export async function verifyMfa(mfaToken: string, code: string): Promise<TokenResponse> {
  return api<TokenResponse>("/auth/mfa/verify", {
    method: "POST",
    auth: false,
    body: { mfa_token: mfaToken, code },
  });
}

export async function ssoLoginUrl(subdomain: string): Promise<string> {
  const res = await api<{ authorize_url: string }>(
    `/auth/sso/entra/login?subdomain=${encodeURIComponent(subdomain)}`,
    { auth: false },
  );
  return res.authorize_url;
}

export function isMfaRequired(r: TokenResponse | MFARequired): r is MFARequired {
  return (r as MFARequired).mfa_required === true;
}
