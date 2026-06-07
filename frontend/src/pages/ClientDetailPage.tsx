import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import {
  type AuditYear,
  createAuditYear,
  listAuditYears,
  lockAuditYear,
} from "../api/sox";
import { useAuth } from "../auth/AuthContext";

export function ClientDetailPage() {
  const { t } = useTranslation();
  const { clientId = "" } = useParams();
  const { claims } = useAuth();
  const [years, setYears] = useState<AuditYear[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [error, setError] = useState<string | null>(null);

  const canManage = claims?.role === "admin" || claims?.role === "manager";
  const refresh = () => listAuditYears(clientId).then(setYears).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
  }, [clientId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createAuditYear(clientId, year);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div>
      <nav className="mb-3">
        <Link to="/clients" className="text-decoration-none">
          ← {t("clients.title")}
        </Link>
      </nav>
      <h1 className="h4 mb-3">{t("audit_years.title")}</h1>
      {error && <div className="alert alert-danger">{error}</div>}

      {canManage && (
        <div className="card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={add}>
              <div className="col-auto">
                <label className="form-label">{t("audit_years.year")}</label>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                />
              </div>
              <div className="col-auto">
                <button className="btn btn-sm btn-primary">{t("audit_years.add")}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-body p-0">
          <table className="table table-sm table-striped mb-0">
            <thead>
              <tr>
                <th>{t("audit_years.year")}</th>
                <th>{t("audit_years.status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id}>
                  <td>{y.year}</td>
                  <td>
                    <span
                      className={`badge ${y.status === "open" ? "bg-success" : "bg-secondary"}`}
                    >
                      {t(`audit_years.status_${y.status}`)}
                    </span>
                  </td>
                  <td className="text-end">
                    <Link
                      to={`/audit-years/${y.id}`}
                      className="btn btn-sm btn-outline-primary me-2"
                    >
                      {t("audit_years.open")}
                    </Link>
                    {canManage && y.status === "open" && (
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={async () => {
                          await lockAuditYear(y.id);
                          refresh();
                        }}
                      >
                        {t("audit_years.lock")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {years.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-muted text-center py-3">
                    {t("audit_years.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
