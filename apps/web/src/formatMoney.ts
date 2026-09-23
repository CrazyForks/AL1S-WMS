import { localeForDates } from "./i18n/index.js";

export const formatMoney = (value: number, currency = "CNY") =>
  new Intl.NumberFormat(localeForDates(), {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
