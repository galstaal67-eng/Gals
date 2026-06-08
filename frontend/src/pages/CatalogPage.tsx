import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { listClients } from "../api/clients";
import {
  type AuditYear,
  type BankItem,
  type CatalogControl,
  type Subsidiary,
  importControlFromCatalog,
  listAuditYears,
  listControlCatalog,
  listProcessBank,
  listSubsidiaries,
  syncCatalog,
} from "../api/sox";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { NextStep } from "../components/NextStep";
import { StatusBadge } from "../components/StatusBadge";

export function CatalogPage() {
  const { t } = useTranslation();
  const { claims } = useAuth();
  const canManage = claims?.role === "admin" || claims?.role === "manager";
  const [controls, setControls] = useState<CatalogControl[]>([]);
  const [processes, setProcesses] = useState<BankItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [keyOnly, setKeyOnly] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const [importing, setImporting] = useState<CatalogControl | null>(null);

  const reload = () => {
    listControlCatalog().then(setControls).catch((e) => setError(String(e)));
    listProcessBank().then(setProcesses).catch(() => {});
  };
  useEffect(reload, []);

  const onSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const c = await syncCatalog();
      const added = (c.controls_added ?? 0) + (c.controls_updated ?? 0);
      setSyncMsg(t("catalog.sync_done", { count: added }));
      reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  };

  const procName = useMemo(() => {
    const m = new Map<string, string>();
    processes.forEach((p) => m.set(p.id, p.name_he));
    return m;
  }, [processes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return controls.filter((c) => {
      if (processFilter && c.process_id !== processFilter) return false;
      if (keyOnly && !c.is_key_default) return false;
      if (!q) return true;
      return (
        (c.name_he || "").toLowerCase().includes(q) ||
        (c.code || "").toLowerCase().includes(q) ||
        (c.risk_description || "").toLowerCase().includes(q) ||
        (c.desired_description || "").toLowerCase().includes(q)
      );
    });
  }, [controls, search, processFilter, keyOnly]);

  // Group filtered controls by process, then by flow step within each process —
  // mirroring the dashboard's "process → step → controls" structure.
  const groups = useMemo(() => {
    const byProc = new Map<string, { count: number; steps: Map<string, CatalogControl[]> }>();
    for (const c of filtered) {
      const pk = c.process_id ?? "_none";
      const sk = c.step ?? "—";
      if (!byProc.has(pk)) byProc.set(pk, { count: 0, steps: new Map() });
      const g = byProc.get(pk)!;
      g.count += 1;
      if (!g.steps.has(sk)) g.steps.set(sk, []);
      g.steps.get(sk)!.push(c);
    }
    return [...byProc.entries()].map(
      ([pk, g]) => [pk, g.count, [...g.steps.entries()]] as const,
    );
  }, [filtered]);

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start mb-1">
        <h1 className="page-title">{t("catalog.title")}</h1>
        {canManage && (
          <button className="btn btn-sm btn-outline-primary" disabled={syncing} onClick={onSync}>
            {syncing ? t("catalog.syncing") : `🔄 ${t("catalog.sync")}`}
          </button>
        )}
      </div>
      <p className="text-muted mb-3">{t("catalog.subtitle")}</p>
      <NextStep text={t("nextstep.catalog")} />
      {error && <div className="alert alert-danger">{error}</div>}
      {syncMsg && <div className="alert alert-success py-2">{syncMsg}</div>}

      <div className="card mb-4">
        <div className="card-body">
          <div className="row g-2 align-items-center">
            <div className="col-12 col-md">
              <input
                className="form-control"
                placeholder={t("catalog.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="col-6 col-md-auto">
              <select
                className="form-select"
                value={processFilter}
                onChange={(e) => setProcessFilter(e.target.value)}
              >
                <option value="">{t("catalog.all_processes")}</option>
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name_he}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-auto">
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="keyOnly"
                  checked={keyOnly}
                  onChange={(e) => setKeyOnly(e.target.checked)}
                />
                <label className="form-check-label" htmlFor="keyOnly">
                  {t("catalog.key_only")}
                </label>
              </div>
            </div>
          </div>
          <div className="text-muted small mt-2">
            {t("catalog.total_count", { count: filtered.length, procs: groups.length })}
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-5">
            <div className="mb-2" style={{ fontSize: "2rem" }}>
              📚
            </div>
            <p className="text-muted">
              {controls.length === 0 && canManage ? t("catalog.empty_sync") : t("catalog.empty")}
            </p>
            {controls.length === 0 && canManage && (
              <button className="btn btn-primary" disabled={syncing} onClick={onSync}>
                {syncing ? t("catalog.syncing") : t("catalog.sync")}
              </button>
            )}
          </div>
        </div>
      ) : (
        groups.map(([pid, count, steps]) => (
          <div className="card mb-4" key={pid}>
            <div className="card-header d-flex justify-content-between align-items-center">
              <span className="fw-bold">{procName.get(pid) ?? "—"}</span>
              <span className="badge text-bg-light">
                {t("catalog.controls_count", { count })}
              </span>
            </div>
            <div className="card-body p-0">
              {steps.map(([step, items]) => (
                <div key={step}>
                  <div className="catalog-step px-3 py-1 small fw-semibold">
                    🔹 {step}
                    <span className="text-muted fw-normal ms-2">({items.length})</span>
                  </div>
                  <table className="table table-hover align-middle mb-0">
                    <tbody>
                      {items.map((c) => (
                        <tr key={c.id}>
                          <td className="ps-3" style={{ width: 90 }}>
                            <span className="badge text-bg-secondary">{c.code}</span>
                          </td>
                          <td>
                            <div className="fw-semibold">
                              {c.name_he}
                              {c.is_key_default && (
                                <span className="badge text-bg-warning ms-2">
                                  {t("catalog.key_badge")}
                                </span>
                              )}
                            </div>
                            {c.risk_description && (
                              <div className="small text-muted">
                                {t("catalog.risk")}: {c.risk_description}
                              </div>
                            )}
                            <div className="mt-1 d-flex flex-wrap gap-1">
                              {c.default_purpose && (
                                <StatusBadge
                                  value={c.default_purpose}
                                  prefix="control_fields.purposes"
                                />
                              )}
                              {c.default_type && (
                                <span className="badge text-bg-light">
                                  {t(`control_fields.types.${c.default_type}`)}
                                </span>
                              )}
                              {c.default_frequency && (
                                <span className="badge text-bg-light">
                                  {t(`control_fields.freqs.${c.default_frequency}`)}
                                </span>
                              )}
                              {c.owner_hint && (
                                <span className="badge text-bg-light">👤 {c.owner_hint}</span>
                              )}
                            </div>
                          </td>
                          <td className="text-end pe-3" style={{ width: 160 }}>
                            <button
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => setImporting(c)}
                            >
                              {t("catalog.import")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {importing && (
        <ImportModal
          control={importing}
          onClose={() => setImporting(null)}
        />
      )}
    </div>
  );
}

function ImportModal({ control, onClose }: { control: CatalogControl; onClose: () => void }) {
  const { t } = useTranslation();
  const [clients, setClients] = useState<Client[]>([]);
  const [years, setYears] = useState<AuditYear[]>([]);
  const [subs, setSubs] = useState<Subsidiary[]>([]);
  const [clientId, setClientId] = useState("");
  const [yearId, setYearId] = useState("");
  const [subId, setSubId] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listClients().then(setClients).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    setYearId("");
    setSubs([]);
    setSubId("");
    if (clientId) listAuditYears(clientId).then(setYears).catch(() => setYears([]));
    else setYears([]);
  }, [clientId]);

  useEffect(() => {
    setSubId("");
    if (yearId) listSubsidiaries(yearId).then(setSubs).catch(() => setSubs([]));
    else setSubs([]);
  }, [yearId]);

  const onImport = async () => {
    if (!yearId || !subId) return;
    setBusy(true);
    setErr(null);
    try {
      await importControlFromCatalog(yearId, subId, control.id);
      setDone(true);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog">
        <div className="modal-dialog modal-dialog-centered" role="document">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{t("catalog.import_title")}</h5>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
            <div className="modal-body">
              <div className="alert alert-light border mb-3">
                <span className="badge text-bg-secondary me-2">{control.code}</span>
                {control.name_he}
              </div>
              {done ? (
                <div className="alert alert-success mb-0">{t("catalog.imported")}</div>
              ) : (
                <>
                  {err && <div className="alert alert-danger">{err}</div>}
                  <div className="mb-2">
                    <label className="form-label">{t("catalog.pick_client")}</label>
                    <select
                      className="form-select"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                    >
                      <option value="">—</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mb-2">
                    <label className="form-label">{t("catalog.pick_year")}</label>
                    <select
                      className="form-select"
                      value={yearId}
                      onChange={(e) => setYearId(e.target.value)}
                      disabled={!clientId}
                    >
                      <option value="">—</option>
                      {years.map((y) => (
                        <option key={y.id} value={y.id} disabled={y.status !== "open"}>
                          {y.year}
                          {y.status !== "open" ? ` (${y.status})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mb-2">
                    <label className="form-label">{t("catalog.pick_sub")}</label>
                    <select
                      className="form-select"
                      value={subId}
                      onChange={(e) => setSubId(e.target.value)}
                      disabled={!yearId}
                    >
                      <option value="">—</option>
                      {subs.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="small text-muted mb-0">{t("catalog.import_hint")}</p>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline-secondary" onClick={onClose}>
                {done ? t("common.close") : t("catalog.cancel")}
              </button>
              {!done && (
                <button
                  className="btn btn-primary"
                  onClick={onImport}
                  disabled={!subId || busy}
                >
                  {t("catalog.import_confirm")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}
