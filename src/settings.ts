import { LazyStore } from "@tauri-apps/plugin-store";
import type { WeekStart } from "./dates";

// UI preferences are plain JSON via tauri-plugin-store, so they behave the same on
// every OS and in dev and release builds (localStorage is per-origin and isn't).
// Secrets never go here; they stay in the OS secure store (see src-tauri/src/store.rs).
// In a plain browser (`npm run dev` with the fake backend) localStorage stands in.
const store = "__TAURI_INTERNALS__" in window ? new LazyStore("preferences.json") : undefined;

const WEEK_START = "weekStart";

export async function loadWeekStart(): Promise<WeekStart> {
  try {
    const saved = store ? await store.get<number>(WEEK_START) : Number(localStorage.getItem(WEEK_START));
    return saved === 1 ? 1 : 0;
  } catch {
    return 0;
  }
}

export async function saveWeekStart(value: WeekStart): Promise<void> {
  try {
    if (store) {
      await store.set(WEEK_START, value);
      await store.save();
    } else {
      localStorage.setItem(WEEK_START, String(value));
    }
  } catch {
    /* the preference just won't persist */
  }
}
