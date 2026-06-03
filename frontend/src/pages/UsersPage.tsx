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
      <h1 className="h4 mb-3">{t("users.title")}</h1>
      {error && <div className="alert alert-danger">{error}</div>}
      <table className="table table-striped">
        <thead>
          <tr>
            <th>{t("users.full_name")}</th>
            <th>{t("users.email")}</th>
            <th>{t("users.role")}</th>
            <th>{t("users.active")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.full_name}</td>
              <td>{u.email}</td>
              <td>{t(`roles.${u.role}`)}</td>
              <td>{u.is_active ? "✓" : "—"}</td>
              <td>
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
        </tbody>
      </table>
    </div>
  );
}
