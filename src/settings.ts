import { LazyStore } from "@tauri-apps/plugin-store";
import type { WeekStart } from "./dates";

// UI preferences are plain JSON via tauri-plugin-store, so they behave the same on
// every OS and in dev and release builds (localStorage is per-origin and isn't).
// Secrets never go here; they stay in the encrypted file (see src-tauri/src/secrets.rs).
// In a plain browser (`npm run dev` with the fake backend) localStorage stands in.
const store = "__TAURI_INTERNALS__" in window ? new LazyStore("preferences.json") : undefined;

/** "system" follows the OS appearance. */
export type Theme = "system" | "light" | "dark";
export const THEMES: Theme[] = ["system", "light", "dark"];

export interface Prefs {
  theme: Theme;
  /**
   * Time is logged in steps of this many hours (0 = no steps, the start). Redmine can't report such a policy, so
   * the app learns it: when Redmine refuses an off-step time it is set to 0.25 (see useTimer.ts, Timesheet.tsx).
   * You can only set it back to none, never to a step of your own.
   */
  increment: number;
  /** A paused timer is stopped and logged this many minutes after it was paused, so a forgotten one isn't lost. 0 = the moment it is paused. */
  logPausedAfter: number;
  weekStart: WeekStart;
  /** The timer is off until it is switched on. */
  timerEnabled: boolean;
  /** A timer shorter than this many minutes is dropped instead of logged. 0 = keep everything. */
  minSessionMinutes: number;
}

/** The steps a stored value may have: none, or the one Redmine's rule is learned as. */
const INCREMENT_CHOICES = [0, 0.25];
/** Minutes. 0 is "after the timer is stopped" (right away); otherwise 1 to 6 hours. There is no "never". */
export const AUTOLOG_CHOICES = [0, 60, 120, 180, 240, 300, 360];
export const MIN_SESSION_CHOICES = [0, 1, 2, 5];

export const DEFAULT_PREFS: Prefs = { theme: "system", increment: 0, weekStart: 0, timerEnabled: false, logPausedAfter: 60, minSessionMinutes: 5 };

const oneOf = (choices: number[], value: unknown, fallback: number): number =>
  typeof value === "number" && choices.includes(value) ? value : fallback;

function clean(raw: Partial<Record<keyof Prefs, unknown>>): Prefs {
  return {
    theme: THEMES.find((t) => t === raw.theme) ?? DEFAULT_PREFS.theme,
    increment: oneOf(INCREMENT_CHOICES, raw.increment, DEFAULT_PREFS.increment),
    weekStart: raw.weekStart === 1 ? 1 : 0,
    timerEnabled: raw.timerEnabled === true,
    logPausedAfter: oneOf(AUTOLOG_CHOICES, raw.logPausedAfter, DEFAULT_PREFS.logPausedAfter),
    minSessionMinutes: oneOf(MIN_SESSION_CHOICES, raw.minSessionMinutes, DEFAULT_PREFS.minSessionMinutes),
  };
}

const KEYS = Object.keys(DEFAULT_PREFS) as (keyof Prefs)[];

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw: Partial<Record<keyof Prefs, unknown>> = {};
    for (const key of KEYS) {
      if (store) raw[key] = await store.get(key);
      else {
        const text = localStorage.getItem(key);
        raw[key] = text === null ? undefined : JSON.parse(text);
      }
    }
    return clean(raw);
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (store) await store.set(key, value);
      else localStorage.setItem(key, JSON.stringify(value));
    }
    if (store) await store.save();
  } catch {
    /* the preference just won't persist */
  }
}
