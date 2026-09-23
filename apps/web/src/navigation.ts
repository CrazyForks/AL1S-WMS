export const pagePaths = {
  home: "/",
  count: "/count",
  shopping: "/shopping",
  finance: "/finance",
  locations: "/locations",
  categories: "/categories",
  profile: "/profile",
} as const;

export type Page = keyof typeof pagePaths;

export function pageFromUrl(): Page {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return (
    (Object.keys(pagePaths) as Page[]).find(
      (page) => pagePaths[page] === path,
    ) ?? "home"
  );
}

export function itemDetailIdFromUrl() {
  const match = window.location.pathname.match(
    /^\/items\/([0-9a-f-]{36})\/?$/i,
  );
  return match?.[1] ?? null;
}

export function itemDetailSourcePage(): Page | null {
  const source = window.history.state?.itemDetailSource;
  return typeof source === "string" && Object.keys(pagePaths).includes(source)
    ? (source as Page)
    : null;
}
