import type { OpenedConsumable } from "./webTypes.js";
export function formatDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function openedExpiryForDisplay(
  opened: Pick<OpenedConsumable, "openedExpiryDate" | "expiryDate">,
) {
  const dates = [opened.openedExpiryDate, opened.expiryDate]
    .filter((value): value is string => Boolean(value))
    .map((value) => ({
      value,
      time: /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T23:59:59`).getTime()
        : new Date(value).getTime(),
    }))
    .filter((value) => Number.isFinite(value.time));
  if (!dates.length) return null;
  const earliest = dates.reduce((result, date) =>
    date.time < result.time ? date : result,
  );
  return /^\d{4}-\d{2}-\d{2}$/.test(earliest.value)
    ? earliest.value
    : formatDateTime(earliest.value);
}
