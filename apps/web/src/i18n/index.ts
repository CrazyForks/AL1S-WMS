import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";

export const supportedLocales = ["zh-CN", "en-US"] as const;
export type Locale = (typeof supportedLocales)[number];
export const localeStorageKey = "al1s-wms-locale";

function normalizeLocale(value?: string | null): Locale | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "zh-cn" || normalized.startsWith("zh")) return "zh-CN";
  if (normalized === "en-us" || normalized.startsWith("en")) return "en-US";
  return null;
}

export function detectLocale(): Locale {
  const navigatorLocale = (navigator.languages ?? [navigator.language])
    .map(normalizeLocale)
    .find((locale): locale is Locale => locale !== null);
  return (
    normalizeLocale(localStorage.getItem(localeStorageKey)) ??
    navigatorLocale ??
    "zh-CN"
  );
}

export function setLocale(locale: Locale) {
  localStorage.setItem(localeStorageKey, locale);
  document.documentElement.lang = locale;
  return i18n.changeLanguage(locale);
}

const initialLocale = detectLocale();
document.documentElement.lang = initialLocale;

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
  lng: initialLocale,
  fallbackLng: "zh-CN",
  supportedLngs: supportedLocales,
  initImmediate: false,
  interpolation: { escapeValue: false },
});

export function localeForDates() {
  return (i18n.resolvedLanguage ?? i18n.language) === "en-US"
    ? "en-US"
    : "zh-CN";
}

const storedUnits = [
  "个",
  "瓶",
  "盒",
  "包",
  "箱",
  "袋",
  "千克",
  "克",
  "市斤",
  "升",
  "米",
  "其他",
  "件",
] as const;

export function displayUnit(unit?: string | null) {
  if (!unit) return "";
  return storedUnits.includes(unit as (typeof storedUnits)[number])
    ? i18n.t(unit)
    : unit;
}

export default i18n;
