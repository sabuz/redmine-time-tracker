import type { Theme } from "./settings";

// "System" is plain CSS (prefers-color-scheme), so it needs no script and never flashes. Only an
// explicit Light or Dark sets `data-theme` on <html>, and the stylesheet does the rest.
//
// The choice itself lives in preferences.json, which loads asynchronously. A copy in localStorage
// lets the next launch apply it before the first render instead of flashing the system theme.
const MIRROR = "redmine-time:theme";

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(MIRROR, theme);
  } catch {
    /* private mode or blocked storage: the saved preference still applies once it loads */
  }
}

/** Called once at startup, before anything is drawn. */
export function applySavedTheme(): void {
  try {
    const saved = localStorage.getItem(MIRROR);
    if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
  } catch {
    /* see applyTheme */
  }
}
