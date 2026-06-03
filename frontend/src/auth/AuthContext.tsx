import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { getToken, setToken } from "../api/client";

interface JwtClaims {
  sub: string;
  tenant_id: string;
  role: string;
  exp: number;
}

function decodeClaims(token: string): JwtClaims | null {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload)) as JwtClaims;
  } catch {
    return null;
  }
}

interface AuthState {
  token: string | null;
  claims: JwtClaims | null;
  signIn: (token: string) => void;
  signOut: () => void;
}

const AuthCtx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(getToken());

  const value = useMemo<AuthState>(
    () => ({
      token,
      claims: token ? decodeClaims(token) : null,
      signIn: (t: string) => {
        setToken(t);
        setTok(t);
      },
      signOut: () => {
        setToken(null);
        setTok(null);
      },
    }),
    [token],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
