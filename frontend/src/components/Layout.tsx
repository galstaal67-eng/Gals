import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

const NAV = [
  { to: "/dashboard", key: "dashboard", ico: "📊" },
  { to: "/clients", key: "clients", ico: "🏢" },
  { to: "/catalog", key: "catalog", ico: "📚" },
  { to: "/users", key: "users", ico: "👥" },
  { to: "/outbox", key: "outbox", ico: "✉️" },
  { to: "/notifications", key: "notifications", ico: "🔔" },
];

export function Layout() {
  const { t, i18n } = useTranslation();
  const { signOut, claims } = useAuth();
  const navigate = useNavigate();

  const toggleLang = () => i18n.changeLanguage(i18n.language === "he" ? "en" : "he");

  const onLogout = () => {
    signOut();
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <span className="brand-badge">✓</span>
          <span>{t("app.title")}</span>
        </div>
        <nav className="app-nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to}>
              <span className="nav-ico">{item.ico}</span>
              <span>{t(`nav.${item.key}`)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="app-sidebar-foot">
          <button className="btn btn-sm btn-outline-light w-100" onClick={onLogout}>
            {t("nav.logout")}
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <button className="btn btn-sm btn-outline-secondary ms-auto" onClick={toggleLang}>
            {t("common.language")}
          </button>
          {claims?.role && (
            <span className="badge rounded-pill text-bg-light ms-2">
              {t(`roles.${claims.role}`)}
            </span>
          )}
        </header>
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
