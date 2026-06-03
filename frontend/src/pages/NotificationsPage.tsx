import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { listNotifications, markAllRead, markRead, type Notification } from "../api/notifications";

export function NotificationsPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => listNotifications().then(setItems).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 mb-0">{t("notifications.title")}</h1>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={async () => {
            await markAllRead();
            refresh();
          }}
        >
          {t("notifications.mark_all")}
        </button>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {items.length === 0 ? (
        <p className="text-muted">{t("notifications.empty")}</p>
      ) : (
        <ul className="list-group">
          {items.map((n) => (
            <li
              key={n.id}
              className={`list-group-item d-flex justify-content-between align-items-start ${
                n.read_at ? "" : "fw-bold"
              }`}
            >
              <div>
                <div>{n.title}</div>
                {n.body && <small className="text-muted">{n.body}</small>}
              </div>
              {!n.read_at && (
                <button
                  className="btn btn-sm btn-link"
                  onClick={async () => {
                    await markRead(n.id);
                    refresh();
                  }}
                >
                  {t("notifications.mark_read")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
