import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDashboard, type Dashboard, type DashboardRole } from "../api/dashboards";
import { useAuth } from "../auth/AuthContext";
import { NextStep } from "../components/NextStep";

function roleFor(role: string | undefined): DashboardRole {
  if (role === "client") return "client";
  if (role === "auditor") return "auditor";
  return "consultant";
}

function StatCard({
  value,
  label,
  ico,
  accent,
}: {
  value: number;
  label: string;
  ico: string;
  accent: string;
}) {
  return (
    <div className="col-12 col-sm-4">
      <div className="card h-100">
        <div className="card-body d-flex align-items-center gap-3">
          <span
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: accent,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: "1.5rem",
              flexShrink: 0,
            }}
          >
            {ico}
          </span>
          <div>
            <div className="h3 mb-0 fw-bold">{value}</div>
            <div className="text-muted small">{label}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CountTable({
  title,
  data,
  tprefix,
}: {
  title: string;
  data: Record<string, number>;
  tprefix?: string;
}) {
  const { t } = useTranslation();
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const label = (k: string) => (tprefix ? t(`${tprefix}.${k}`, k) : k);
  return (
    <div className="col-12 col-lg-4">
      <div className="card h-100">
        <div className="card-header fw-bold">{title}</div>
        <div className="card-body">
          {entries.length === 0 ? (
            <p className="text-muted mb-0">—</p>
          ) : (
            <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
              {entries.map(([k, v]) => (
                <li key={k}>
                  <div className="d-flex justify-content-between small mb-1">
                    <span>{label(k)}</span>
                    <span className="fw-bold">{v}</span>
                  </div>
                  <div className="progress" style={{ height: 6 }}>
                    <div
                      className="progress-bar"
                      style={{ width: `${(v / max) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
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
      <h1 className="page-title mb-4">{t("dashboard.title")}</h1>
      <NextStep
        text={t("nextstep.dashboard")}
        cta={{ label: t("nextstep.go_clients"), to: "/clients" }}
      />
      <div className="row g-3 mb-3">
        <StatCard value={data.controls_total} label={t("dashboard.controls")} ico="🛡️" accent="#4f46e5" />
        <StatCard value={data.key_controls} label={t("dashboard.key_controls")} ico="🔑" accent="#0ea5e9" />
        <StatCard value={data.tests_total} label={t("dashboard.tests")} ico="🧪" accent="#10b981" />
      </div>
      <div className="row g-3">
        <CountTable
          title={t("dashboard.controls_by_status")}
          data={data.controls_by_status}
          tprefix="control_status"
        />
        <CountTable
          title={t("dashboard.tests_by_status")}
          data={data.tests_by_status}
          tprefix="test_status"
        />
        <CountTable
          title={t("dashboard.deficiencies")}
          data={data.deficiencies_by_severity}
          tprefix="severity"
        />
      </div>
    </div>
  );
}
