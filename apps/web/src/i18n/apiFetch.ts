import i18n from "./index.js";

export function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.set(
    "Accept-Language",
    (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith("en")
      ? "en-US"
      : "zh-CN",
  );
  return fetch(input, { ...init, headers });
}
