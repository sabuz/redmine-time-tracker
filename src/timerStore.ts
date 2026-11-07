import { LazyStore } from "@tauri-apps/plugin-store";
import type { Ledger, TimerState } from "./timer";

// The running timer and the recent history of stopped ones, per Redmine instance, in
// `timer.json` next to the other preferences. It holds ticket numbers, titles and your
// notes, which are all in Redmine anyway; no credentials.

export interface TimerData {
  timer: TimerState | null;
  ledger: Ledger;
}

const KEY = "timers";
const store = "__TAURI_INTERNALS__" in window ? new LazyStore("timer.json") : undefined;

type All = Record<string, TimerData>;

let cache: Promise<All> | undefined;
const all = (): Promise<All> =>
  (cache ??= (async () => {
    try {
      const raw = store ? await store.get<All>(KEY) : JSON.parse(localStorage.getItem(KEY) ?? "null");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  })());

export async function loadTimerData(url: string): Promise<TimerData> {
  const saved = (await all())[url];
  return { timer: saved?.timer ?? null, ledger: saved?.ledger ?? {} };
}

// Saves are queued so two quick ones can't overwrite each other out of order.
let queue: Promise<void> = Promise.resolve();

export function saveTimerData(url: string, data: TimerData): Promise<void> {
  queue = queue.then(async () => {
    try {
      const map = await all();
      map[url] = data;
      if (store) {
        await store.set(KEY, map);
        await store.save();
      } else {
        localStorage.setItem(KEY, JSON.stringify(map));
      }
    } catch {
      /* the timer keeps running; it just won't survive a restart */
    }
  });
  return queue;
}
