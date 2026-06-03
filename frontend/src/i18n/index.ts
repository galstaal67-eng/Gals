import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./en.json";
import he from "./he.json";

const DIRECTIONS: Record<string, "rtl" | "ltr"> = { he: "rtl", en: "ltr" };

export function applyDirection(lang: string): void {
  const dir = DIRECTIONS[lang] ?? "rtl";
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
}

i18n.use(initReactI18next).init({
  resources: { he: { translation: he }, en: { translation: en } },
  lng: localStorage.getItem("lang") ?? "he",
  fallbackLng: "he",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lang) => {
  localStorage.setItem("lang", lang);
  applyDirection(lang);
});

applyDirection(i18n.language);

export default i18n;
