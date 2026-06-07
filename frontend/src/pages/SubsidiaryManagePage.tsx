import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import {
  type BankItem,
  type Control,
  type ControlTest,
  type Evidence,
  type ProcessSelection,
  type RiskSelection,
  createBankProcess,
  createBankRisk,
  createControl,
  createProcessSelection,
  createRiskSelection,
  listControls,
  listEvidences,
  listProcessBank,
  listProcessSelections,
  listRiskBank,
  listRiskSelections,
  listTestsForControl,
  requestEvidence,
  requestValidation,
  transitionControl,
  transitionTest,
  updateRiskSelection,
  uploadEvidence,
} from "../api/sox";

const PURPOSES = ["preventive", "directive", "detective", "compensating"];
const CTRL_TYPES = ["manual", "automatic", "hybrid"];
const CTRL_FREQ = ["ongoing", "automatic", "monthly", "quarterly", "semiannual", "annual"];

const RISK_CLASS = ["financial", "operational"];
const RISK_COMPLEXITY = ["medium", "medium_high", "high"];
const RISK_FREQ = ["daily", "multiple_daily", "multiple_monthly", "multiple_yearly", "annual_plus"];
const RISK_PROB = ["low", "medium", "high", "very_high"];
const RISK_RATING = ["low", "medium", "high", "very_high"];
const ONE_TO_FIVE = [1, 2, 3, 4, 5];

export function SubsidiaryManagePage() {
  const { t } = useTranslation();
  const { yearId = "", subId = "" } = useParams();

  const [procs, setProcs] = useState<ProcessSelection[]>([]);
  const [procBank, setProcBank] = useState<BankItem[]>([]);
  const [selProc, setSelProc] = useState<string | null>(null);
  const [newProc, setNewProc] = useState("");

  const [risks, setRisks] = useState<RiskSelection[]>([]);
  const [riskBank, setRiskBank] = useState<BankItem[]>([]);
  const [selRisk, setSelRisk] = useState<string | null>(null);
  const [newRisk, setNewRisk] = useState("");

  const [controls, setControls] = useState<Control[]>([]);
  const [selControl, setSelControl] = useState<string | null>(null);
  const [ctrl, setCtrl] = useState({
    control_name: "",
    is_key_control: false,
    purpose: "",
    control_type: "",
    frequency: "",
  });

  const [tests, setTests] = useState<ControlTest[]>([]);
  const [evidence, setEvidence] = useState<Record<string, Evidence[]>>({});
  const [error, setError] = useState<string | null>(null);

  const bankName = (bank: BankItem[], id: string) => bank.find((b) => b.id === id)?.name_he ?? id;

  const loadProcs = () => {
    listProcessSelections(yearId, subId).then(setProcs).catch((e) => setError(String(e)));
    listProcessBank().then(setProcBank).catch(() => {});
  };
  useEffect(() => {
    loadProcs();
  }, [yearId, subId]);

  useEffect(() => {
    if (!selProc) return;
    listRiskSelections(selProc).then(setRisks).catch((e) => setError(String(e)));
    listRiskBank().then(setRiskBank).catch(() => {});
    setSelRisk(null);
    setControls([]);
    setSelControl(null);
    setTests([]);
  }, [selProc]);

  useEffect(() => {
    if (!selRisk) return;
    listControls(selRisk).then(setControls).catch((e) => setError(String(e)));
    setSelControl(null);
    setTests([]);
  }, [selRisk]);

  const selectedRisk = risks.find((r) => r.id === selRisk) ?? null;
  const patchRisk = async (field: string, value: string | number | null) => {
    if (!selRisk) return;
    const updated = await updateRiskSelection(selRisk, { [field]: value }).catch((e) => {
      setError(String(e));
      return null;
    });
    if (updated && selProc) listRiskSelections(selProc).then(setRisks);
  };

  const loadTests = (cid: string) =>
    listTestsForControl(cid).then(async (ts) => {
      setTests(ts);
      const map: Record<string, Evidence[]> = {};
      for (const tst of ts) map[tst.id] = await listEvidences(tst.id).catch(() => []);
      setEvidence(map);
    });
  useEffect(() => {
    if (selControl) loadTests(selControl);
  }, [selControl]);

  const addProc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProc.trim()) return;
    const bank = await createBankProcess(newProc, "business");
    await createProcessSelection(yearId, subId, bank.id);
    setNewProc("");
    loadProcs();
  };
  const addRisk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selProc || !newRisk.trim()) return;
    const bank = await createBankRisk(newRisk);
    await createRiskSelection(selProc, bank.id);
    setNewRisk("");
    listRiskSelections(selProc).then(setRisks);
  };
  const addControl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selRisk || !ctrl.control_name.trim()) return;
    const body: Record<string, unknown> = {
      control_name: ctrl.control_name,
      is_key_control: ctrl.is_key_control,
    };
    if (ctrl.purpose) body.purpose = ctrl.purpose;
    if (ctrl.control_type) body.control_type = ctrl.control_type;
    if (ctrl.frequency) body.frequency = ctrl.frequency;
    await createControl(selRisk, body);
    setCtrl({ control_name: "", is_key_control: false, purpose: "", control_type: "", frequency: "" });
    listControls(selRisk).then(setControls);
  };

  const col = "col-12 col-xl-3";

  return (
    <div>
      <nav className="mb-3">
        <Link to={`/audit-years/${yearId}`} className="text-decoration-none">
          ← {t("subsidiaries.title")}
        </Link>
      </nav>
      <h1 className="h4 mb-3">{t("manage.title")}</h1>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-3">
        {/* processes */}
        <div className={col}>
          <div className="card h-100">
            <div className="card-header fw-bold">{t("nav_tabs.processes")}</div>
            <div className="card-body py-2">
              <form className="input-group input-group-sm mb-2" onSubmit={addProc}>
                <input
                  className="form-control"
                  placeholder={t("manage.new_process") ?? ""}
                  value={newProc}
                  onChange={(e) => setNewProc(e.target.value)}
                />
                <button className="btn btn-primary">+</button>
              </form>
            </div>
            <ul className="list-group list-group-flush">
              {procs.map((p) => (
                <li
                  key={p.id}
                  role="button"
                  className={`list-group-item ${selProc === p.id ? "active" : ""}`}
                  onClick={() => setSelProc(p.id)}
                >
                  {bankName(procBank, p.process_id)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* risks */}
        <div className={col}>
          <div className="card h-100">
            <div className="card-header fw-bold">{t("nav_tabs.risks")}</div>
            <div className="card-body py-2">
              <form className="input-group input-group-sm mb-2" onSubmit={addRisk}>
                <input
                  className="form-control"
                  placeholder={t("manage.new_risk") ?? ""}
                  value={newRisk}
                  disabled={!selProc}
                  onChange={(e) => setNewRisk(e.target.value)}
                />
                <button className="btn btn-primary" disabled={!selProc}>
                  +
                </button>
              </form>
            </div>
            <ul className="list-group list-group-flush">
              {risks.map((r) => (
                <li
                  key={r.id}
                  role="button"
                  className={`list-group-item ${selRisk === r.id ? "active" : ""}`}
                  onClick={() => setSelRisk(r.id)}
                >
                  {bankName(riskBank, r.risk_id)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* controls */}
        <div className={col}>
          <div className="card h-100">
            <div className="card-header fw-bold">{t("nav_tabs.controls")}</div>
            <div className="card-body py-2">
              <form onSubmit={addControl}>
                <input
                  className="form-control form-control-sm mb-1"
                  placeholder={t("manage.new_control") ?? ""}
                  value={ctrl.control_name}
                  disabled={!selRisk}
                  onChange={(e) => setCtrl({ ...ctrl, control_name: e.target.value })}
                />
                <div className="row g-1">
                  <div className="col-6">
                    <select
                      className="form-select form-select-sm"
                      value={ctrl.purpose}
                      disabled={!selRisk}
                      onChange={(e) => setCtrl({ ...ctrl, purpose: e.target.value })}
                    >
                      <option value="">{t("control_fields.purpose")}</option>
                      {PURPOSES.map((p) => (
                        <option key={p} value={p}>
                          {t(`control_fields.purposes.${p}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-6">
                    <select
                      className="form-select form-select-sm"
                      value={ctrl.control_type}
                      disabled={!selRisk}
                      onChange={(e) => setCtrl({ ...ctrl, control_type: e.target.value })}
                    >
                      <option value="">{t("control_fields.type")}</option>
                      {CTRL_TYPES.map((c) => (
                        <option key={c} value={c}>
                          {t(`control_fields.types.${c}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-8">
                    <select
                      className="form-select form-select-sm"
                      value={ctrl.frequency}
                      disabled={!selRisk}
                      onChange={(e) => setCtrl({ ...ctrl, frequency: e.target.value })}
                    >
                      <option value="">{t("control_fields.frequency")}</option>
                      {CTRL_FREQ.map((f) => (
                        <option key={f} value={f}>
                          {t(`control_fields.freqs.${f}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-4 d-flex align-items-center">
                    <div className="form-check m-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={ctrl.is_key_control}
                        disabled={!selRisk}
                        onChange={(e) => setCtrl({ ...ctrl, is_key_control: e.target.checked })}
                      />
                      <label className="form-check-label small">{t("control_fields.key")}</label>
                    </div>
                  </div>
                </div>
                <button className="btn btn-sm btn-primary w-100 mt-1" disabled={!selRisk}>
                  {t("manage.new_control")}
                </button>
              </form>
            </div>
            <ul className="list-group list-group-flush">
              {controls.map((c) => (
                <li key={c.id} className={`list-group-item ${selControl === c.id ? "active" : ""}`}>
                  <div role="button" onClick={() => setSelControl(c.id)}>
                    {c.control_name}
                    <span className="badge bg-secondary ms-2">
                      {t(`control_status.${c.status}`)}
                    </span>
                  </div>
                  <div className="mt-1">
                    {c.status === "draft" && (
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={async () => {
                          // Try the email-queueing flow; fall back to a plain
                          // transition when the control has no owner contact.
                          try {
                            await requestValidation(c.id);
                          } catch {
                            await transitionControl(c.id, "needs_validation");
                          }
                          listControls(selRisk!).then(setControls);
                        }}
                      >
                        {t("manage.request_validation")}
                      </button>
                    )}
                    {c.status === "needs_validation" && (
                      <button
                        className="btn btn-sm btn-outline-success"
                        onClick={async () => {
                          await transitionControl(c.id, "validated");
                          listControls(selRisk!).then(setControls);
                        }}
                      >
                        {t("manage.validate")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* tests + evidence */}
        <div className={col}>
          <div className="card h-100">
            <div className="card-header fw-bold">{t("nav_tabs.tests")}</div>
            <ul className="list-group list-group-flush">
              {tests.map((tst) => (
                <li key={tst.id} className="list-group-item">
                  <span className="badge bg-info text-dark">{t(`test_status.${tst.status}`)}</span>
                  {tst.status === "pending_receipt" && (
                    <button
                      className="btn btn-sm btn-outline-secondary ms-2"
                      onClick={async () => {
                        await transitionTest(tst.id, "consultant_handling");
                        loadTests(selControl!);
                      }}
                    >
                      {t("manage.start_test")}
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-outline-info ms-2"
                    onClick={() =>
                      requestEvidence(tst.id).catch((err) => setError(String(err)))
                    }
                  >
                    {t("manage.request_evidence")}
                  </button>

                  {/* evidence */}
                  <div className="mt-2">
                    <label className="form-label small mb-1">{t("manage.evidence")}</label>
                    <input
                      type="file"
                      className="form-control form-control-sm"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        await uploadEvidence(tst.id, f).catch((err) => setError(String(err)));
                        loadTests(selControl!);
                      }}
                    />
                    <ul className="small mt-1 mb-0 ps-3">
                      {(evidence[tst.id] ?? []).map((ev) => (
                        <li key={ev.id}>📎 {ev.filename}</li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
              {selControl && tests.length === 0 && (
                <li className="list-group-item text-muted">{t("manage.no_tests_hint")}</li>
              )}
              {!selControl && (
                <li className="list-group-item text-muted">{t("manage.pick_control")}</li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* full risk fields editor */}
      {selectedRisk && (
        <div className="card mt-3">
          <div className="card-header fw-bold">{t("risk_fields.title")}</div>
          <div className="card-body">
            <div className="row g-2">
              {[
                ["classification", RISK_CLASS, "risk_fields.classification", "risk_class"],
                ["complexity", RISK_COMPLEXITY, "risk_fields.complexity", "risk_complexity"],
                ["frequency", RISK_FREQ, "risk_fields.frequency", "risk_freq"],
                ["inherent_probability", RISK_PROB, "risk_fields.probability", "risk_prob"],
                ["inherent_rating", RISK_RATING, "risk_fields.inherent", "risk_rating"],
                ["residual_rating", RISK_RATING, "risk_fields.residual", "risk_rating"],
              ].map(([field, opts, label, tkey]) => (
                <div className="col-6 col-md-4 col-xl-2" key={field as string}>
                  <label className="form-label small">{t(label as string)}</label>
                  <select
                    className="form-select form-select-sm"
                    value={(selectedRisk[field as keyof typeof selectedRisk] as string) ?? ""}
                    onChange={(e) => patchRisk(field as string, e.target.value || null)}
                  >
                    <option value="">—</option>
                    {(opts as string[]).map((o) => (
                      <option key={o} value={o}>
                        {t(`${tkey}.${o}`)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {[
                ["financial_damage", "risk_fields.financial_damage"],
                ["reputation", "risk_fields.reputation"],
                ["regulation", "risk_fields.regulation"],
              ].map(([field, label]) => (
                <div className="col-6 col-md-4 col-xl-2" key={field}>
                  <label className="form-label small">{t(label)}</label>
                  <select
                    className="form-select form-select-sm"
                    value={(selectedRisk[field as keyof typeof selectedRisk] as number) ?? ""}
                    onChange={(e) =>
                      patchRisk(field, e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">—</option>
                    {ONE_TO_FIVE.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="col-12">
                <label className="form-label small">{t("risk_fields.description")}</label>
                <textarea
                  className="form-control form-control-sm"
                  rows={2}
                  defaultValue={selectedRisk.description ?? ""}
                  onBlur={(e) => patchRisk("description", e.target.value || null)}
                />
              </div>
            </div>
            <div className="form-text mt-2">{t("risk_fields.itgc_hint")}</div>
          </div>
        </div>
      )}
    </div>
  );
}
