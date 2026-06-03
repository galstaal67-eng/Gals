import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { createClient, deleteClient, listClients } from "../api/clients";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";

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
      <h1 className="h4 mb-3">{t("clients.title")}</h1>
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

      {clients.length === 0 ? (
        <p className="text-muted">{t("clients.empty")}</p>
      ) : (
        <table className="table table-striped">
          <thead>
            <tr>
              <th>{t("clients.name")}</th>
              <th>{t("clients.industry")}</th>
              <th>{t("clients.is_public")}</th>
              {claims?.role === "admin" && <th />}
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.industry ?? "—"}</td>
                <td>{c.is_public ? "✓" : "—"}</td>
                {claims?.role === "admin" && (
                  <td>
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
          </tbody>
        </table>
      )}
    </div>
  );
}
