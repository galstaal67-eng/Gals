import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { isMfaRequired, login, ssoLoginUrl, verifyMfa } from "../api/auth";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [subdomain, setSubdomain] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await login(subdomain, email, password);
      if (isMfaRequired(res)) {
        setMfaToken(res.mfa_token);
      } else {
        signIn(res.access_token);
        navigate("/clients");
      }
    } catch (err) {
      setError(err instanceof ApiError ? t("login.error") : String(err));
    }
  };

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await verifyMfa(mfaToken!, code);
      signIn(res.access_token);
      navigate("/clients");
    } catch {
      setError(t("login.error"));
    }
  };

  const onSso = async () => {
    try {
      window.location.href = await ssoLoginUrl(subdomain);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: "10vh" }}>
      <h1 className="h4 mb-4">{t("login.title")}</h1>
      {error && <div className="alert alert-danger">{error}</div>}

      {!mfaToken ? (
        <form onSubmit={onSubmit}>
          <div className="mb-3">
            <label className="form-label">{t("login.subdomain")}</label>
            <input className="form-control" value={subdomain} onChange={(e) => setSubdomain(e.target.value)} required />
          </div>
          <div className="mb-3">
            <label className="form-label">{t("login.email")}</label>
            <input type="email" className="form-control" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="mb-3">
            <label className="form-label">{t("login.password")}</label>
            <input type="password" className="form-control" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary w-100 mb-2">
            {t("login.submit")}
          </button>
          <button type="button" className="btn btn-outline-secondary w-100" onClick={onSso}>
            {t("login.sso")}
          </button>
        </form>
      ) : (
        <form onSubmit={onVerify}>
          <h2 className="h6">{t("login.mfa_title")}</h2>
          <div className="mb-3">
            <label className="form-label">{t("login.mfa_code")}</label>
            <input className="form-control" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary w-100">
            {t("login.submit")}
          </button>
        </form>
      )}
    </div>
  );
}
