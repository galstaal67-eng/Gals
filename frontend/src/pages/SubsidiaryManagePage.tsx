import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { type ControlSuggestion, suggestControls } from "../api/ai";
import { type Contact, listContacts } from "../api/contacts";
import { StatusBadge } from "../components/StatusBadge";
import {
  type BankItem,
  type Control,
  type ControlTest,
  type Evidence,
  type ProcessSelection,
  type QualitativeAnswer,
  type RiskSelection,
  createBankProcess,
  createBankRisk,
  createControl,
  createProcessSelection,
  createRiskSelection,
  getQualitative,
  listControls,
  listEvidences,
  listProcessBank,
  listProcessSelections,
  listRiskBank,
  listRiskSelections,
  listTestsForControl,
  requestEvidence,
  requestValidation,
  setQualitative,
  transitionControl,
  transitionTest,
  updateRiskSelection,
  updateTest,
  uploadEvidence,
} from "../api/sox";

const QUALITATIVE_QUESTIONS = [
  "separate_location",
  "separate_management",
  "separate_systems",
  "unique_reporting_risk",
  "fraud_or_error",
];

const PURPOSES = ["preventive", "directive", "detective", "compensating"];
const CTRL_TYPES = ["manual", "automatic", "hybrid"];
const CTRL_FREQ = ["ongoing", "automatic", "monthly", "quarterly", "semiannual", "annual"];

const RISK_CLASS = ["financial", "operational"];
const RISK_COMPLEXITY = ["medium", "medium_high", "high"];
const RISK_FREQ = ["daily", "multiple_daily", "multiple_monthly", "multiple_yearly", "annual_plus"];
const RISK_PROB = ["low", "medium", "high", "very_high"];
const RISK_RATING = ["low", "medium", "high", "very_high"];
const ONE_TO_FIVE = [1, 2, 3, 4, 5];

// Test FSM (mirrors backend state_machine.py). Manual overrides
// (needs_attention/round_b_pending/not_relevant) are reachable from any
// non-terminal state and appended below. The backend remains the authority.
const TEST_TERMINAL = ["internally_closed", "deficiency_closed", "not_relevant"];
const TEST_MANUAL = ["needs_attention", "round_b_pending", "not_relevant"];
const SEVERITIES = ["deficiency", "material_deficiency", "material_weakness"];
const TEST_DEFICIENCY = ["deficiency_open", "deficiency_compensated", "deficiency_closed"];
const TEST_NEXT: Record<string, string[]> = {
  pending_receipt: ["consultant_handling"],
  consultant_handling: ["company_completion", "reviewed_approved", "deficiency_open"],
  company_completion: ["consultant_handling", "additional_evidence"],
  additional_evidence: ["consultant_handling", "company_completion", "reviewed_approved", "deficiency_open"],
  reviewed_approved: ["consultant_handling", "internally_closed", "deficiency_open"],
  deficiency_open: ["additional_evidence", "deficiency_compensated", "deficiency_closed"],
  deficiency_compensated: ["deficiency_closed"],
};
const testTargets = (status: string): string[] => {
  if (TEST_TERMINAL.includes(status)) return [];
  const base = TEST_NEXT[status] ?? [];
  return [...base, ...TEST_MANUAL.filter((m) => !base.includes(m))];
};

export function SubsidiaryManagePage() {
  const { t } = useTranslation();
  const { clientId = "", yearId = "", subId = "" } = useParams();
  const [contacts, setContacts] = useState<Contact[]>([]);

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
    owner_contact_id: "",
    operator_contact_id: "",
  });

  const [tests, setTests] = useState<ControlTest[]>([]);
  const [evidence, setEvidence] = useState<Record<string, Evidence[]>>({});
  const [suggestions, setSuggestions] = useState<ControlSuggestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [qual, setQual] = useState<Record<string, boolean>>({});
  const [qualResult, setQualResult] = useState<string | null>(null);
  const [qualSaved, setQualSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bankName = (bank: BankItem[], id: string) => bank.find((b) => b.id === id)?.name_he ?? id;

  const loadProcs = () => {
    listProcessSelections(yearId, subId).then(setProcs).catch((e) => setError(String(e)));
    listProcessBank().then(setProcBank).catch(() => {});
  };
  const loadQual = () => {
    if (!subId) return;
    getQualitative(subId)
      .then((rows: QualitativeAnswer[]) => {
        const map: Record<string, boolean> = {};
        for (const r of rows) map[r.question_key] = r.answer;
        setQual(map);
      })
      .catch(() => {});
  };
  useEffect(() => {
    loadProcs();
    loadQual();
    if (clientId) listContacts(clientId).then(setContacts).catch(() => {});
  }, [yearId, subId, clientId]);

  const saveQual = async () => {
    setError(null);
    try {
      const answers: QualitativeAnswer[] = QUALITATIVE_QUESTIONS.map((q) => ({
        question_key: q,
        answer: !!qual[q],
      }));
      const sub = await setQualitative(subId, answers);
      setQualResult(sub.qualitative_result);
      setQualSaved(true);
      setTimeout(() => setQualSaved(false), 1500);
    } catch (e) {
      setError(String(e));
    }
  };

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
    setSuggestions([]);
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
    setRiskBank((prev) => (prev.some((b) => b.id === bank.id) ? prev : [...prev, bank]));
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
    if (ctrl.owner_contact_id) body.owner_contact_id = ctrl.owner_contact_id;
    if (ctrl.operator_contact_id) body.operator_contact_id = ctrl.operator_contact_id;
    await createControl(selRisk, body);
    setCtrl({
      control_name: "",
      is_key_control: false,
      purpose: "",
      control_type: "",
      frequency: "",
      owner_contact_id: "",
      operator_contact_id: "",
    });
    listControls(selRisk).then(setControls);
  };

  const loadSuggestions = async () => {
    if (!selectedRisk) return;
    setAiLoading(true);
    setError(null);
    try {
      const out = await suggestControls(
        bankName(riskBank, selectedRisk.risk_id),
        selectedRisk.description,
      );
      setSuggestions(out);
    } catch (e) {
      setError(String(e));
    } finally {
      setAiLoading(false);
    }
  };
  const applySuggestion = (s: ControlSuggestion) =>
    setCtrl({ ...ctrl, control_name: s.name, control_type: s.control_type ?? "" });

  const col = "col-12 col-xl-3";

  return (
    <div>
      <nav className="mb-3">
        <Link to={`/clients/${clientId}/years/${yearId}`} className="text-decoration-none">
          ← {t("subsidiaries.title")}
        </Link>
      </nav>
      <h1 className="page-title mb-3">{t("manage.title")}</h1>
      {error && <div className="alert alert-danger">{error}</div>}

      {/* qualitative significance questions (C8) */}
      <div className="card mb-3">
        <div className="card-header fw-bold d-flex justify-content-between align-items-center">
          <span>{t("qualitative.title")}</span>
          {qualResult && (
            <span className={`badge ${qualResult === "PASS" ? "bg-success" : "bg-secondary"}`}>
              {t(`qualitative.result_${qualResult.toLowerCase()}`)}
            </span>
          )}
        </div>
        <div className="card-body">
          <div className="row g-2">
            {QUALITATIVE_QUESTIONS.map((q) => (
              <div className="col-12 col-md-6" key={q}>
                <div className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`qual-${q}`}
                    checked={!!qual[q]}
                    onChange={(e) => setQual({ ...qual, [q]: e.target.checked })}
                  />
                  <label className="form-check-label" htmlFor={`qual-${q}`}>
                    {t(`qualitative.questions.${q}`)}
                  </label>
                </div>
              </div>
            ))}
          </div>
          <div className="d-flex align-items-center gap-2 mt-2">
            <button className="btn btn-sm btn-primary" onClick={saveQual}>
              {t("common.save")}
            </button>
            {qualSaved && <span className="text-success small">✓</span>}
            <span className="form-text mb-0 ms-auto">{t("qualitative.hint")}</span>
          </div>
        </div>
      </div>

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
                  <div className="col-6">
                    <select
                      className="form-select form-select-sm"
                      value={ctrl.owner_contact_id}
                      disabled={!selRisk}
                      onChange={(e) => setCtrl({ ...ctrl, owner_contact_id: e.target.value })}
                    >
                      <option value="">{t("control_fields.owner")}</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-6">
                    <select
                      className="form-select form-select-sm"
                      value={ctrl.operator_contact_id}
                      disabled={!selRisk}
                      onChange={(e) => setCtrl({ ...ctrl, operator_contact_id: e.target.value })}
                    >
                      <option value="">{t("control_fields.operator")}</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button className="btn btn-sm btn-primary w-100 mt-1" disabled={!selRisk}>
                  {t("manage.new_control")}
                </button>
              </form>
              <button
                className="btn btn-sm btn-outline-info w-100 mt-1"
                disabled={!selRisk || aiLoading}
                onClick={loadSuggestions}
              >
                {aiLoading ? t("manage.ai_loading") : t("manage.ai_suggest")}
              </button>
              {suggestions.length > 0 && (
                <ul className="list-unstyled small mt-2 mb-0">
                  {suggestions.map((s, i) => (
                    <li key={i} className="border rounded p-1 mb-1">
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-start fw-bold"
                        onClick={() => applySuggestion(s)}
                      >
                        ✨ {s.name}
                      </button>
                      {s.description && <div className="text-muted">{s.description}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <ul className="list-group list-group-flush">
              {controls.map((c) => (
                <li key={c.id} className={`list-group-item ${selControl === c.id ? "active" : ""}`}>
                  <div role="button" onClick={() => setSelControl(c.id)}>
                    {c.control_name}{" "}
                    <StatusBadge value={c.status} prefix="control_status" />
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
                  <StatusBadge value={tst.status} prefix="test_status" />
                  {testTargets(tst.status).length > 0 && (
                    <select
                      className="form-select form-select-sm mt-1"
                      value=""
                      onChange={async (e) => {
                        const target = e.target.value;
                        if (!target) return;
                        await transitionTest(tst.id, target).catch((err) => setError(String(err)));
                        loadTests(selControl!);
                      }}
                    >
                      <option value="">{t("manage.advance_status")}</option>
                      {testTargets(tst.status).map((s) => (
                        <option key={s} value={s}>
                          {t(`test_status.${s}`)}
                        </option>
                      ))}
                    </select>
                  )}
                  {TEST_DEFICIENCY.includes(tst.status) && (
                    <select
                      className="form-select form-select-sm mt-1"
                      value={tst.severity ?? ""}
                      onChange={async (e) => {
                        await updateTest(tst.id, { severity: e.target.value || null }).catch(
                          (err) => setError(String(err)),
                        );
                        loadTests(selControl!);
                      }}
                    >
                      <option value="">{t("severity.label")}</option>
                      {SEVERITIES.map((s) => (
                        <option key={s} value={s}>
                          {t(`severity.${s}`)}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="btn btn-sm btn-outline-info mt-1 w-100"
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
