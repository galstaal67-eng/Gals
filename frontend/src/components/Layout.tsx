import { useTranslation } from "react-i18next";
import { Link, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";

export function Layout() {
  const { t, i18n } = useTranslation();
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const toggleLang = () => i18n.changeLanguage(i18n.language === "he" ? "en" : "he");

  const onLogout = () => {
    signOut();
    navigate("/login");
  };

  return (
    <div className="d-flex flex-column min-vh-100">
      <nav className="navbar navbar-expand bg-light border-bottom px-3">
        <span className="navbar-brand">{t("app.title")}</span>
        <div className="navbar-nav me-auto">
          <Link className="nav-link" to="/clients">
            {t("nav.clients")}
          </Link>
          <Link className="nav-link" to="/users">
            {t("nav.users")}
          </Link>
        </div>
        <button className="btn btn-sm btn-outline-secondary mx-2" onClick={toggleLang}>
          {t("common.language")}
        </button>
        <button className="btn btn-sm btn-outline-danger" onClick={onLogout}>
          {t("nav.logout")}
        </button>
      </nav>
      <main className="container py-4 flex-grow-1">
        <Outlet />
      </main>
    </div>
  );
}
