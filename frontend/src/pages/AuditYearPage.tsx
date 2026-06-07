import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { downloadReport } from "../api/reports";
import {
  type MaterialityParam,
  type Subsidiary,
  cloneFromPrevious,
  createMateriality,
  createSubsidiary,
  listMateriality,
  listSubsidiaries,
  scopeDecision,
} from "../api/sox";
import { useAuth } from "../auth/AuthContext";
import { NextStep } from "../components/NextStep";

const PARAM_TYPES = [
  "sales",
  "net_income",
  "assets",
  "operating_income",
  "equity",
  "pretax_income",
  "cash",
  "operating_expenses",
];

export function AuditYearPage() {
  const { t } = useTranslation();
  const { clientId = "", yearId = "" } = useParams();
  const { claims } = useAuth();
  const [params, setParams] = useState<MaterialityParam[]>([]);
  const [subs, setSubs] = useState<Subsidiary[]>([]);
  const [subName, setSubName] = useState("");
  const [mp, setMp] = useState({ slot: 1, parameter_type: "sales", value: "", percentage: "" });
  const [error, setError] = useState<string | null>(null);

  const canManage = claims?.role === "admin" || claims?.role === "manager";

  const refresh = () => {
    listMateriality(yearId).then(setParams).catch((e) => setError(String(e)));
    listSubsidiaries(yearId).then(setSubs).catch((e) => setError(String(e)));
  };
  useEffect(() => {
    refresh();
  }, [yearId]);

  const addParam = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createMateriality(yearId, mp);
      setMp({ ...mp, value: "", percentage: "" });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const addSub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subName.trim()) return;
    await createSubsidiary(yearId, subName);
    setSubName("");
    refresh();
  };

  return (
    <div>
      <nav className="mb-2">
        <Link to={`/clients/${clientId}`} className="text-decoration-none">
          ← {t("audit_years.title")}
        </Link>
      </nav>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="page-title mb-0">{t("audit_years.year_title")}</h1>
        <div className="btn-group">
          {canManage && (
            <button
              className="btn btn-sm btn-outline-primary"
              onClick={async () => {
                setError(null);
                try {
                  await cloneFromPrevious(yearId);
                  refresh();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              {t("audit_years.clone_previous")}
            </button>
          )}
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => downloadReport("controls-matrix", yearId, "xlsx").catch((e) => setError(String(e)))}
          >
            {t("reports.controls_xlsx")}
          </button>
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => downloadReport("test-status", yearId, "xlsx").catch((e) => setError(String(e)))}
          >
            {t("reports.tests_xlsx")}
          </button>
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      <NextStep
        text={t(subs.length === 0 ? "nextstep.year_no_subs" : "nextstep.year_pick_sub")}
      />

      {/* materiality */}
      <div className="card mb-4">
        <div className="card-header fw-bold">{t("materiality.title")}</div>
        <div className="card-body">
          {canManage && (
            <form className="row g-2 align-items-end mb-3" onSubmit={addParam}>
              <div className="col-auto">
                <label className="form-label">{t("materiality.slot")}</label>
                <select
                  className="form-select form-select-sm"
                  value={mp.slot}
                  onChange={(e) => setMp({ ...mp, slot: Number(e.target.value) })}
                >
                  {[1, 2, 3].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-auto">
                <label className="form-label">{t("materiality.param")}</label>
                <select
                  className="form-select form-select-sm"
                  value={mp.parameter_type}
                  onChange={(e) => setMp({ ...mp, parameter_type: e.target.value })}
                >
                  {PARAM_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {t(`materiality.types.${p}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-auto">
                <label className="form-label">{t("materiality.value")}</label>
                <input
                  className="form-control form-control-sm"
                  value={mp.value}
                  onChange={(e) => setMp({ ...mp, value: e.target.value })}
                />
              </div>
              <div className="col-auto">
                <label className="form-label">{t("materiality.percentage")}</label>
                <input
                  className="form-control form-control-sm"
                  value={mp.percentage}
                  onChange={(e) => setMp({ ...mp, percentage: e.target.value })}
                />
              </div>
              <div className="col-auto">
                <button className="btn btn-sm btn-primary">{t("common.save")}</button>
              </div>
            </form>
          )}
          <table className="table table-sm table-striped mb-0">
            <thead>
              <tr>
                <th>{t("materiality.slot")}</th>
                <th>{t("materiality.param")}</th>
                <th>{t("materiality.value")}</th>
                <th>{t("materiality.percentage")}</th>
                <th>{t("materiality.threshold")}</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.id}>
                  <td>{p.slot}</td>
                  <td>{t(`materiality.types.${p.parameter_type}`)}</td>
                  <td>{p.value}</td>
                  <td>{p.percentage}</td>
                  <td className="fw-bold">{p.computed_threshold}</td>
                </tr>
              ))}
              {params.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted text-center py-2">
                    —
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* subsidiaries */}
      <div className="card">
        <div className="card-header fw-bold">{t("subsidiaries.title")}</div>
        <div className="card-body">
          <form className="row g-2 align-items-end mb-3" onSubmit={addSub}>
            <div className="col-auto">
              <label className="form-label">{t("subsidiaries.name")}</label>
              <input
                className="form-control form-control-sm"
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
              />
            </div>
            <div className="col-auto">
              <button className="btn btn-sm btn-primary">{t("subsidiaries.add")}</button>
            </div>
          </form>
          <table className="table table-sm table-striped mb-0">
            <thead>
              <tr>
                <th>{t("subsidiaries.name")}</th>
                <th>{t("subsidiaries.qualitative")}</th>
                <th>{t("subsidiaries.significant")}</th>
                <th>{t("subsidiaries.approved")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.qualitative_result ?? "—"}</td>
                  <td>{s.is_significant ? "✓" : "—"}</td>
                  <td>{s.scope_approved ? "✓" : "—"}</td>
                  <td className="text-end">
                    <Link
                      to={`/clients/${clientId}/years/${yearId}/subs/${s.id}`}
                      className="btn btn-sm btn-outline-primary me-2"
                    >
                      {t("subsidiaries.manage")}
                    </Link>
                    {canManage && (
                      <button
                        className="btn btn-sm btn-outline-success"
                        onClick={async () => {
                          await scopeDecision(s.id, true, true);
                          refresh();
                        }}
                      >
                        {t("subsidiaries.approve_scope")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {subs.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted text-center py-2">
                    {t("subsidiaries.empty")}
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
