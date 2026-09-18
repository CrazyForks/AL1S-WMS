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

const unitLabels = {
  "zh-CN": {个:"个",瓶:"瓶",盒:"盒",包:"包",箱:"箱",袋:"袋",罐:"罐",桶:"桶",卷:"卷",支:"支",根:"根",条:"条",片:"片",张:"张",块:"块",颗:"颗",把:"把",双:"双",套:"套",份:"份",克:"克",市斤:"市斤",千克:"千克",毫升:"毫升",升:"升",厘米:"厘米",米:"米",其他:"其他",件:"件"},
  "en-US": {个:"unit",瓶:"bottle(s)",盒:"box(es)",包:"pack(s)",箱:"carton(s)",袋:"bag(s)",罐:"can(s)",桶:"bucket(s)",卷:"roll(s)",支:"piece(s)",根:"piece(s)",条:"strip(s)",片:"slice(s)",张:"sheet(s)",块:"piece(s)",颗:"piece(s)",把:"bunch(es)",双:"pair(s)",套:"set(s)",份:"serving(s)",克:"g",市斤:"jin",千克:"kg",毫升:"mL",升:"L",厘米:"cm",米:"m",其他:"other",件:"piece(s)"},
} as const;

export function displayUnit(unit?: string | null) {
  if (!unit) return "";
  const locale=(i18n.resolvedLanguage ?? i18n.language)==="en-US"?"en-US":"zh-CN";
  return (unitLabels[locale] as Record<string,string>)[unit] ?? unit;
}

export default i18n;
