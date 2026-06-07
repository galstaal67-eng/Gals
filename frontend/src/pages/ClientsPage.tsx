import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { createClient, deleteClient, listClients } from "../api/clients";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { NextStep } from "../components/NextStep";

export function ClientsPage() {
  const { t } = useTranslation();
  const { claims } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canManage = claims?.role === "admin" || claims?.role === "manager";

  const refresh = () => listClients().then(setClients).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
  }, []);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createClient({ name });
    setName("");
    refresh();
  };

  return (
    <div>
      <h1 className="page-title mb-4">{t("clients.title")}</h1>
      <NextStep
        text={t(clients.length === 0 ? "nextstep.clients_empty" : "nextstep.clients_pick")}
      />
      {error && <div className="alert alert-danger">{error}</div>}

      {canManage && (
        <form className="row g-2 mb-3" onSubmit={onAdd}>
          <div className="col-auto">
            <input
              className="form-control"
              placeholder={t("clients.name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="col-auto">
            <button className="btn btn-primary">{t("clients.add")}</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="card-body p-0">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th className="ps-3">{t("clients.name")}</th>
                <th>{t("clients.industry")}</th>
                <th>{t("clients.is_public")}</th>
                {claims?.role === "admin" && <th />}
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td className="ps-3">
                    <Link to={`/clients/${c.id}`} className="fw-semibold text-decoration-none">
                      {c.name}
                    </Link>
                  </td>
                  <td>{c.industry ? t(`sectors.${c.industry}`, c.industry) : "—"}</td>
                  <td>
                    {c.is_public ? (
                      <span className="badge text-bg-light">✓</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  {claims?.role === "admin" && (
                    <td className="text-end pe-3">
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={async () => {
                          await deleteClient(c.id);
                          refresh();
                        }}
                      >
                        {t("clients.delete")}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={claims?.role === "admin" ? 4 : 3} className="text-muted text-center py-4">
                    {t("clients.empty")}
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
