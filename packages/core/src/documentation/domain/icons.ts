// The site's icons: a small built-in set, drawn inline so the site makes no request. A process,
// a capability or an employee task names one with `icon:`; an unknown name gets the page icon.
const PATHS: Readonly<Record<string, string>> = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  phone:
    "M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
  cart: "M3 4h2l2.4 11h11l2-8H6.3M9 20h.01M18 20h.01",
  check: "M4 12l5 5L20 6",
  book: "M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h8",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  doc: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8",
  chat: "M4 4h16v12H8l-4 4z",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  refresh: "M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4",
  database:
    "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  flame: "M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8a7 7 0 0 0 7 7z",
  inbox: "M3 13l3-9h12l3 9v7H3zM3 13h5l1 3h6l1-3h5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  menu: "M4 6h16M4 12h16M4 18h16",
};

export const ICON_NAMES = Object.keys(PATHS);

export function iconName(name: string | undefined, fallback = "doc"): string {
  return name !== undefined && name in PATHS ? name : fallback;
}

export function iconSvg(name: string | undefined, fallback = "doc"): string {
  const known = iconName(name, fallback);
  return (
    `<svg class="icon" data-icon="${known}" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" ` +
    `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${PATHS[known] ?? ""}"/></svg>`
  );
}
