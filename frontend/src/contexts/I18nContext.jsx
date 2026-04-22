"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { translations, detectLocale, LOCALES } from "@/lib/i18n";

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState("fr");

  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  function setLocale(lang) {
    if (!LOCALES.includes(lang)) return;
    setLocaleState(lang);
    localStorage.setItem("lyricus-lang", lang);
  }

  const t = useCallback(
    (key) => translations[locale]?.[key] ?? translations.fr[key] ?? key,
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
