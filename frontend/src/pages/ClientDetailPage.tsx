import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { getClient, updateClient } from "../api/clients";
import { type Contact, createContact, deleteContact, listContacts } from "../api/contacts";
import {
  type AuditYear,
  createAuditYear,
  listAuditYears,
  lockAuditYear,
} from "../api/sox";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { NextStep } from "../components/NextStep";

const SECTORS = [
  "hitech",
  "credit",
  "education",
  "insurance",
  "finance",
  "banking",
  "health",
  "retail",
  "government",
];
const REGULATIONS = ["SOX", "ISOX", "CSOX"];

export function ClientDetailPage() {
  const { t } = useTranslation();
  const { clientId = "" } = useParams();
  const { claims } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [years, setYears] = useState<AuditYear[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [contact, setContact] = useState({ full_name: "", role_title: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canManage = claims?.role === "admin" || claims?.role === "manager";

  const refresh = () => {
    getClient(clientId).then(setClient).catch((e) => setError(String(e)));
    listAuditYears(clientId).then(setYears).catch((e) => setError(String(e)));
    listContacts(clientId).then(setContacts).catch(() => {});
  };
  useEffect(() => {
    refresh();
  }, [clientId]);

  const saveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client) return;
    setError(null);
    try {
      await updateClient(clientId, {
        industry: client.industry,
        address: client.address,
        is_public: client.is_public,
        activity_description: client.activity_description,
        regulations: client.regulations,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleReg = (reg: string) => {
    if (!client) return;
    const cur = client.regulations ?? [];
    const next = cur.includes(reg) ? cur.filter((r) => r !== reg) : [...cur, reg];
    setClient({ ...client, regulations: next });
  };

  const addYear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createAuditYear(clientId, year);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const addContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contact.full_name.trim()) return;
    await createContact(clientId, {
      full_name: contact.full_name,
      role_title: contact.role_title || null,
      email: contact.email || null,
      phone: contact.phone || null,
    });
    setContact({ full_name: "", role_title: "", email: "", phone: "" });
    refresh();
  };

  if (!client) return <p className="text-muted">…</p>;

  return (
    <div>
      <nav className="mb-3">
        <Link to="/clients" className="text-decoration-none">
          ← {t("clients.title")}
        </Link>
      </nav>
      <h1 className="page-title mb-3">{client.name}</h1>
      <NextStep
        text={t(years.length === 0 ? "nextstep.client_no_years" : "nextstep.client_pick_year")}
      />
      {error && <div className="alert alert-danger">{error}</div>}
      {saved && <div className="alert alert-success py-2">{t("common.save")} ✓</div>}

      {/* client info — מידע כללי */}
      <div className="card mb-4">
        <div className="card-header fw-bold">{t("client_info.title")}</div>
        <div className="card-body">
          <form className="row g-3" onSubmit={saveClient}>
            <div className="col-md-4">
              <label className="form-label">{t("clients.industry")}</label>
              <select
                className="form-select form-select-sm"
                value={client.industry ?? ""}
                disabled={!canManage}
                onChange={(e) => setClient({ ...client, industry: e.target.value })}
              >
                <option value="">—</option>
                {SECTORS.map((s) => (
                  <option key={s} value={s}>
                    {t(`sectors.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">{t("clients.address")}</label>
              <input
                className="form-control form-control-sm"
                value={client.address ?? ""}
                disabled={!canManage}
                onChange={(e) => setClient({ ...client, address: e.target.value })}
              />
            </div>
            <div className="col-md-4 d-flex align-items-end">
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={client.is_public}
                  disabled={!canManage}
                  onChange={(e) => setClient({ ...client, is_public: e.target.checked })}
                />
                <label className="form-check-label">{t("clients.is_public")}</label>
              </div>
            </div>
            <div className="col-12">
              <label className="form-label">{t("client_info.activity")}</label>
              <textarea
                className="form-control form-control-sm"
                rows={2}
                value={client.activity_description ?? ""}
                disabled={!canManage}
                onChange={(e) => setClient({ ...client, activity_description: e.target.value })}
              />
            </div>
            <div className="col-12">
              <label className="form-label d-block">{t("client_info.regulations")}</label>
              {REGULATIONS.map((r) => (
                <div className="form-check form-check-inline" key={r}>
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={(client.regulations ?? []).includes(r)}
                    disabled={!canManage}
                    onChange={() => toggleReg(r)}
                  />
                  <label className="form-check-label">{r}</label>
                </div>
              ))}
            </div>
            {canManage && (
              <div className="col-12">
                <button className="btn btn-sm btn-primary">{t("common.save")}</button>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* contacts — בנק אנשי קשר */}
      <div className="card mb-4">
        <div className="card-header fw-bold">{t("contacts.title")}</div>
        <div className="card-body">
          {canManage && (
            <form className="row g-2 align-items-end mb-3" onSubmit={addContact}>
              <div className="col-auto">
                <label className="form-label">{t("contacts.name")}</label>
                <input
                  className="form-control form-control-sm"
                  value={contact.full_name}
                  onChange={(e) => setContact({ ...contact, full_name: e.target.value })}
                />
              </div>
              <div className="col-auto">
                <label className="form-label">{t("contacts.role")}</label>
                <input
                  className="form-control form-control-sm"
                  value={contact.role_title}
                  onChange={(e) => setContact({ ...contact, role_title: e.target.value })}
                />
              </div>
              <div className="col-auto">
                <label className="form-label">{t("contacts.email")}</label>
                <input
                  className="form-control form-control-sm"
                  value={contact.email}
                  onChange={(e) => setContact({ ...contact, email: e.target.value })}
                />
              </div>
              <div className="col-auto">
                <label className="form-label">{t("contacts.phone")}</label>
                <input
                  className="form-control form-control-sm"
                  value={contact.phone}
                  onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                />
              </div>
              <div className="col-auto">
                <button className="btn btn-sm btn-primary">{t("contacts.add")}</button>
              </div>
            </form>
          )}
          <table className="table table-sm table-striped mb-0">
            <thead>
              <tr>
                <th>{t("contacts.name")}</th>
                <th>{t("contacts.role")}</th>
                <th>{t("contacts.email")}</th>
                <th>{t("contacts.phone")}</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>{c.full_name}</td>
                  <td>{c.role_title ?? "—"}</td>
                  <td>{c.email ?? "—"}</td>
                  <td>{c.phone ?? "—"}</td>
                  {canManage && (
                    <td className="text-end">
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={async () => {
                          await deleteContact(clientId, c.id);
                          refresh();
                        }}
                      >
                        {t("clients.delete")}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 5 : 4} className="text-muted text-center py-2">
                    {t("contacts.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* audit years */}
      <div className="card">
        <div className="card-header fw-bold">{t("audit_years.title")}</div>
        <div className="card-body">
          {canManage && (
            <form className="row g-2 align-items-end mb-3" onSubmit={addYear}>
              <div className="col-auto">
                <label className="form-label">{t("audit_years.year")}</label>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                />
              </div>
              <div className="col-auto">
                <button className="btn btn-sm btn-primary">{t("audit_years.add")}</button>
              </div>
            </form>
          )}
          <table className="table table-sm table-striped mb-0">
            <thead>
              <tr>
                <th>{t("audit_years.year")}</th>
                <th>{t("audit_years.status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id}>
                  <td>{y.year}</td>
                  <td>
                    <span
                      className={`badge ${y.status === "open" ? "bg-success" : "bg-secondary"}`}
                    >
                      {t(`audit_years.status_${y.status}`)}
                    </span>
                  </td>
                  <td className="text-end">
                    <Link
                      to={`/clients/${clientId}/years/${y.id}`}
                      className="btn btn-sm btn-outline-primary me-2"
                    >
                      {t("audit_years.open")}
                    </Link>
                    {canManage && y.status === "open" && (
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={async () => {
                          await lockAuditYear(y.id);
                          refresh();
                        }}
                      >
                        {t("audit_years.lock")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {years.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-muted text-center py-3">
                    {t("audit_years.empty")}
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
