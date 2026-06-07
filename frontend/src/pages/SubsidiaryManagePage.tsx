import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import {
  type BankItem,
  type Control,
  type ControlTest,
  type ProcessSelection,
  type RiskSelection,
  createBankProcess,
  createBankRisk,
  createControl,
  createProcessSelection,
  createRiskSelection,
  listControls,
  listProcessBank,
  listProcessSelections,
  listRiskBank,
  listRiskSelections,
  listTestsForControl,
  transitionControl,
  transitionTest,
} from "../api/sox";

export function SubsidiaryManagePage() {
  const { t } = useTranslation();
  const { yearId = "", subId = "" } = useParams();

  const [procs, setProcs] = useState<ProcessSelection[]>([]);
  const [procBank, setProcBank] = useState<BankItem[]>([]);
  const [selProc, setSelProc] = useState<string | null>(null);

  const [risks, setRisks] = useState<RiskSelection[]>([]);
  const [riskBank, setRiskBank] = useState<BankItem[]>([]);
  const [selRisk, setSelRisk] = useState<string | null>(null);

  const [controls, setControls] = useState<Control[]>([]);
  const [selControl, setSelControl] = useState<string | null>(null);
  const [tests, setTests] = useState<ControlTest[]>([]);
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

  useEffect(() => {
    if (!selControl) return;
    listTestsForControl(selControl).then(setTests).catch((e) => setError(String(e)));
  }, [selControl]);

  const addProc = async () => {
    const name = prompt(t("manage.new_process") ?? "Process name");
    if (!name) return;
    const bank = await createBankProcess(name, "business");
    await createProcessSelection(yearId, subId, bank.id);
    loadProcs();
  };
  const addRisk = async () => {
    if (!selProc) return;
    const name = prompt(t("manage.new_risk") ?? "Risk name");
    if (!name) return;
    const bank = await createBankRisk(name);
    await createRiskSelection(selProc, bank.id);
    listRiskSelections(selProc).then(setRisks);
  };
  const addControl = async () => {
    if (!selRisk) return;
    const name = prompt(t("manage.new_control") ?? "Control name");
    if (!name) return;
    await createControl(selRisk, name);
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
            <div className="card-header d-flex justify-content-between align-items-center">
              <span className="fw-bold">{t("nav_tabs.processes")}</span>
              <button className="btn btn-sm btn-primary" onClick={addProc}>
                +
              </button>
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
              {procs.length === 0 && <li className="list-group-item text-muted">—</li>}
            </ul>
          </div>
        </div>

        {/* risks */}
        <div className={col}>
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span className="fw-bold">{t("nav_tabs.risks")}</span>
              <button className="btn btn-sm btn-primary" disabled={!selProc} onClick={addRisk}>
                +
              </button>
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
              {selProc && risks.length === 0 && <li className="list-group-item text-muted">—</li>}
            </ul>
          </div>
        </div>

        {/* controls */}
        <div className={col}>
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span className="fw-bold">{t("nav_tabs.controls")}</span>
              <button className="btn btn-sm btn-primary" disabled={!selRisk} onClick={addControl}>
                +
              </button>
            </div>
            <ul className="list-group list-group-flush">
              {controls.map((c) => (
                <li
                  key={c.id}
                  className={`list-group-item ${selControl === c.id ? "active" : ""}`}
                >
                  <div role="button" onClick={() => setSelControl(c.id)}>
                    {c.control_name}
                    <span className="badge bg-secondary ms-2">{t(`control_status.${c.status}`)}</span>
                  </div>
                  <div className="mt-1">
                    {c.status === "draft" && (
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={async () => {
                          await transitionControl(c.id, "needs_validation");
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
              {selRisk && controls.length === 0 && (
                <li className="list-group-item text-muted">—</li>
              )}
            </ul>
          </div>
        </div>

        {/* tests */}
        <div className={col}>
          <div className="card h-100">
            <div className="card-header fw-bold">{t("nav_tabs.tests")}</div>
            <ul className="list-group list-group-flush">
              {tests.map((tst) => (
                <li key={tst.id} className="list-group-item">
                  <span className="badge bg-info text-dark">
                    {t(`test_status.${tst.status}`)}
                  </span>
                  {tst.status === "pending_receipt" && (
                    <button
                      className="btn btn-sm btn-outline-secondary ms-2"
                      onClick={async () => {
                        await transitionTest(tst.id, "consultant_handling");
                        listTestsForControl(selControl!).then(setTests);
                      }}
                    >
                      {t("manage.start_test")}
                    </button>
                  )}
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
    </div>
  );
}
