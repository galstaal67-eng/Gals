import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDashboard, type Dashboard, type DashboardRole } from "../api/dashboards";
import { useAuth } from "../auth/AuthContext";

function roleFor(role: string | undefined): DashboardRole {
  if (role === "client") return "client";
  if (role === "auditor") return "auditor";
  return "consultant";
}

function CountTable({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data);
  return (
    <div className="card mb-3">
      <div className="card-header">{title}</div>
      <div className="card-body p-0">
        {entries.length === 0 ? (
          <p className="text-muted p-3 mb-0">—</p>
        ) : (
          <table className="table mb-0">
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="text-end fw-bold">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { claims } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboard(roleFor(claims?.role))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [claims?.role]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!data) return <p className="text-muted">{t("dashboard.loading")}</p>;

  return (
    <div>
      <h1 className="h4 mb-3">{t("dashboard.title")}</h1>
      <div className="row g-3 mb-3">
        <div className="col">
          <div className="card text-center p-3">
            <div className="h2">{data.controls_total}</div>
            <div className="text-muted">{t("dashboard.controls")}</div>
          </div>
        </div>
        <div className="col">
          <div className="card text-center p-3">
            <div className="h2">{data.key_controls}</div>
            <div className="text-muted">{t("dashboard.key_controls")}</div>
          </div>
        </div>
        <div className="col">
          <div className="card text-center p-3">
            <div className="h2">{data.tests_total}</div>
            <div className="text-muted">{t("dashboard.tests")}</div>
          </div>
        </div>
      </div>
      <CountTable title={t("dashboard.controls_by_status")} data={data.controls_by_status} />
      <CountTable title={t("dashboard.tests_by_status")} data={data.tests_by_status} />
      <CountTable title={t("dashboard.deficiencies")} data={data.deficiencies_by_severity} />
    </div>
  );
}
