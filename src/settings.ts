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
  /** Time is logged in steps of this many hours (0 = no steps). Redmine can't report such a policy, so it is chosen here. */
  increment: number;
  /** A timer paused this many minutes is stopped and logged for you, so a forgotten one isn't lost. 0 = never. */
  autoLogMinutes: number;
  weekStart: WeekStart;
  /** The timer is off until it is switched on. */
  timerEnabled: boolean;
  /** A running timer pauses after this many minutes without keyboard or mouse input. 0 = never. */
  idleMinutes: number;
  /** A timer shorter than this many minutes is dropped instead of logged. 0 = keep everything. */
  minSessionMinutes: number;
}

export const INCREMENT_CHOICES = [0, 0.25, 0.5, 1];
export const IDLE_CHOICES = [0, 1, 2, 5, 10, 15];
export const AUTOLOG_CHOICES = [0, 15, 30, 60, 120];
export const MIN_SESSION_CHOICES = [0, 1, 2, 5];

export const DEFAULT_PREFS: Prefs = { theme: "system", increment: 0.25, weekStart: 0, timerEnabled: false, idleMinutes: 5, autoLogMinutes: 30, minSessionMinutes: 5 };

const oneOf = (choices: number[], value: unknown, fallback: number): number =>
  typeof value === "number" && choices.includes(value) ? value : fallback;

function clean(raw: Partial<Record<keyof Prefs, unknown>>): Prefs {
  return {
    theme: THEMES.find((t) => t === raw.theme) ?? DEFAULT_PREFS.theme,
    increment: oneOf(INCREMENT_CHOICES, raw.increment, DEFAULT_PREFS.increment),
    weekStart: raw.weekStart === 1 ? 1 : 0,
    timerEnabled: raw.timerEnabled === true,
    idleMinutes: oneOf(IDLE_CHOICES, raw.idleMinutes, DEFAULT_PREFS.idleMinutes),
    autoLogMinutes: oneOf(AUTOLOG_CHOICES, raw.autoLogMinutes, DEFAULT_PREFS.autoLogMinutes),
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
