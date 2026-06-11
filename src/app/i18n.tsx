import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { LANGUAGES, TRANSLATIONS, type Language, type MessageKey } from "./translations";

export type { Language, MessageKey };

export type LanguagePreference = "auto" | Language;

// Mirrored by the pre-paint script in index.html (language detection + dir).
const LANGUAGE_KEY = "sing-box-dashboard.language";

export function loadLanguagePreference(): LanguagePreference {
  const value = localStorage.getItem(LANGUAGE_KEY);
  if (value && LANGUAGES.some((language) => language.value === value)) {
    return value as Language;
  }
  return "auto";
}

export function saveLanguagePreference(preference: LanguagePreference) {
  if (preference === "auto") {
    localStorage.removeItem(LANGUAGE_KEY);
  } else {
    localStorage.setItem(LANGUAGE_KEY, preference);
  }
}

export function detectSystemLanguage(): Language {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const lower = tag.toLowerCase();
    if (lower.startsWith("zh")) {
      // Script subtag wins; otherwise infer it from the region as CLDR does.
      if (/hant|tw|hk|mo/.test(lower)) {
        return "zh-Hant";
      }
      return "zh-Hans";
    }
    if (lower.startsWith("fa")) {
      return "fa";
    }
    if (lower.startsWith("ru")) {
      return "ru";
    }
    if (lower.startsWith("en")) {
      return "en";
    }
  }
  return "en";
}

function applyLanguage(language: Language) {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "fa" ? "rtl" : "ltr";
}

export type TranslateParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: TranslateParams) => string;

function translate(language: Language, key: MessageKey, params?: TranslateParams): string {
  let text: string = language === "en" ? key : (TRANSLATIONS[key]?.[language] ?? key);
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

interface I18n {
  language: Language;
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
  t: Translate;
}

const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) {
    throw new Error("missing i18n context");
  }
  return i18n;
}

export function I18nProvider(props: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LanguagePreference>(() =>
    loadLanguagePreference(),
  );
  const [systemLanguage, setSystemLanguage] = useState<Language>(() => detectSystemLanguage());

  useEffect(() => {
    const onChange = () => setSystemLanguage(detectSystemLanguage());
    window.addEventListener("languagechange", onChange);
    return () => window.removeEventListener("languagechange", onChange);
  }, []);

  const language = preference === "auto" ? systemLanguage : preference;

  useEffect(() => {
    applyLanguage(language);
  }, [language]);

  const value = useMemo<I18n>(
    () => ({
      language,
      preference,
      setPreference: (next) => {
        saveLanguagePreference(next);
        setPreferenceState(next);
      },
      t: (key, params) => translate(language, key, params),
    }),
    [language, preference],
  );

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

// Shared between Settings preferences and the first-run setup screen; the
// "auto" entry is labelled in the active language, the languages themselves
// in their own.
export function LanguageSelect(props: { className?: string }) {
  const { t, preference, setPreference } = useI18n();
  return (
    <select
      className={props.className ?? "select"}
      value={preference}
      onChange={(event) => setPreference(event.target.value as LanguagePreference)}
    >
      <option value="auto">{t("System")}</option>
      {LANGUAGES.map((language) => (
        <option key={language.value} value={language.value}>
          {language.label}
        </option>
      ))}
    </select>
  );
}
