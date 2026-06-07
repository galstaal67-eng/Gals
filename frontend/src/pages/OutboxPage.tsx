import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { type EmailMessage, dispatchEmails, listOutbox } from "../api/email";

export function OutboxPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<EmailMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<EmailMessage | null>(null);

  const refresh = () => listOutbox().then(setItems).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
  }, []);

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">{t("outbox.title")}</h1>
        <button
          className="btn btn-sm btn-primary"
          onClick={async () => {
            await dispatchEmails().catch((e) => setError(String(e)));
            refresh();
          }}
        >
          {t("outbox.dispatch")}
        </button>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-3">
        <div className="col-12 col-lg-7">
          <div className="card">
            <div className="card-body p-0">
              <table className="table table-sm table-striped mb-0">
                <thead>
                  <tr>
                    <th>{t("outbox.to")}</th>
                    <th>{t("outbox.subject")}</th>
                    <th>{t("outbox.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((m) => (
                    <tr key={m.id} role="button" onClick={() => setSel(m)}>
                      <td>{m.to_email}</td>
                      <td>{m.subject}</td>
                      <td>
                        <span
                          className={`badge ${m.status === "sent" ? "bg-success" : "bg-warning text-dark"}`}
                        >
                          {m.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-muted text-center py-3">
                        {t("outbox.empty")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="col-12 col-lg-5">
          {sel && (
            <div className="card">
              <div className="card-header fw-bold">{sel.subject}</div>
              <div className="card-body">
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{sel.body}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
