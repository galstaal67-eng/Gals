import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { User } from "../api/types";
import { deactivateUser, listUsers } from "../api/users";

export function UsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => listUsers().then(setUsers).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div>
      <h1 className="page-title mb-4">{t("users.title")}</h1>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="card">
        <div className="card-body p-0">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th className="ps-3">{t("users.full_name")}</th>
                <th>{t("users.email")}</th>
                <th>{t("users.role")}</th>
                <th>{t("users.active")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="ps-3 fw-semibold">{u.full_name}</td>
                  <td className="text-muted">{u.email}</td>
                  <td>
                    <span className="badge text-bg-light">{t(`roles.${u.role}`)}</span>
                  </td>
                  <td>
                    {u.is_active ? (
                      <span className="badge text-bg-success">●</span>
                    ) : (
                      <span className="badge text-bg-secondary">○</span>
                    )}
                  </td>
                  <td className="text-end pe-3">
                    {u.is_active && (
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={async () => {
                          await deactivateUser(u.id);
                          refresh();
                        }}
                      >
                        {t("users.deactivate")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted text-center py-4">
                    —
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
