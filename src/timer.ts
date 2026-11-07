// The timer's rules, kept free of UI and storage so they can be tested on their own.
//
// A timer never talks to Redmine while it runs. It is a list of start/end timestamps
// kept on this Mac; Redmine gets one write when the timer is stopped.

import { iso, addDays } from "./dates.ts";
import { DEFAULT_INCREMENT, clamp, roundUp, smallest } from "./hours.ts";

export type PauseReason = "manual" | "idle" | "asleep" | "closed";

/** Epoch milliseconds. `end` is null while that stretch is still running. */
export interface Segment {
  start: number;
  end: number | null;
}

export interface TimedIssue {
  id: number;
  subject: string;
  projectId?: number;
  projectName: string;
}

export interface TimerState {
  issue: TimedIssue;
  /** The day the time is logged to: the day the timer was started. */
  date: string;
  activityId?: number;
  notes: string;
  segments: Segment[];
  /** Present while paused, absent while running. */
  paused?: { reason: PauseReason; at: number };
  /** Last moment the app saw the timer running; tells a crash or quit apart from time worked. */
  seenAt: number;
}

/** What is remembered about a ticket on a day once its timer has been stopped. */
export interface LedgerItem {
  date: string;
  entryId?: number;
  /** Seconds timed but not written yet (negative when a short stop was rounded up). */
  carry: number;
  /** Stretches worked, as [start, end] epoch ms. */
  sessions: [number, number][];
  updated: number;
}

export type Ledger = Record<string, LedgerItem>;

/** How long stopped-timer history is kept. The entry in Redmine is the record; this only
 *  serves same-day merges, the "timed" tooltip, and fixing something up the next morning. */
export const KEEP_DAYS = 7;
const MAX_SESSIONS = 50;

export const TICK_MS = 5_000;
/** The app wasn't running for this long between two checks: the Mac slept or the app was frozen. */
export const SLEEP_GAP_MS = 60_000;
/** How often a running timer records that the app is still alive. */
export const HEARTBEAT_MS = 15_000;

// --- which days a timer can log to ----------------------------------------------

/** A timer can log to today or an earlier day of the current month: never a future day, never a previous month. */
export const canTrackOn = (date: string, today: string): boolean =>
  date <= today && date.slice(0, 7) === today.slice(0, 7);

// --- the clock ---------------------------------------------------------------

export const isRunning = (t: TimerState): boolean => !t.paused;

/**
 * A timer left paused for `limitMinutes` is stopped and logged for the user, so a forgotten one
 * isn't lost. The pause is counted from when time stopped counting (a pause by idleness is dated
 * at the last keyboard or mouse input), not from when the app noticed. 0 = never. A timer that a stop
 * would drop for being too short (`minSeconds`) is left alone: logging for you must never delete.
 */
export const dueForAutoLog = (t: TimerState, now: number, limitMinutes: number, minSeconds = 0): boolean =>
  limitMinutes > 0 && !!t.paused && now - t.paused.at >= limitMinutes * 60_000 && elapsedMs(t, now) / 1000 >= minSeconds;

export function elapsedMs(t: TimerState, now: number): number {
  return t.segments.reduce((sum, s) => sum + Math.max(0, (s.end ?? now) - s.start), 0);
}

export function startTimer(
  issue: TimedIssue,
  date: string,
  now: number,
  extra: { activityId?: number; notes?: string } = {},
): TimerState {
  return {
    issue,
    date,
    activityId: extra.activityId,
    notes: extra.notes ?? "",
    segments: [{ start: now, end: null }],
    seenAt: now,
  };
}

/** Stops counting at `at`. A stretch that would end up empty is dropped. */
export function pauseTimer(t: TimerState, at: number, reason: PauseReason): TimerState {
  if (t.paused) return t;
  const segments = t.segments.flatMap((s) => {
    if (s.end !== null) return [s];
    const end = Math.max(s.start, at);
    return end > s.start ? [{ start: s.start, end }] : [];
  });
  return { ...t, segments, paused: { reason, at } };
}

export function resumeTimer(t: TimerState, now: number): TimerState {
  if (!t.paused) return t;
  const { paused: _paused, ...rest } = t;
  return { ...rest, segments: [...t.segments, { start: now, end: null }], seenAt: now };
}

/** A timer that was still "running" when the app started was cut off by a quit or a crash. */
export const recoverTimer = (t: TimerState): TimerState => pauseTimer(t, t.seenAt, "closed");

export const closedSessions = (t: TimerState): [number, number][] =>
  t.segments.flatMap((s): [number, number][] => (s.end === null ? [] : [[s.start, s.end]]));

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// --- noticing that nobody is working -------------------------------------------

export interface WatchInput {
  now: number;
  /** When the previous check ran. */
  lastTick: number;
  /** Seconds since the last keyboard or mouse input anywhere on the system, if known. */
  idleSecs: number | null;
  /** Pause after this many idle seconds; null turns idle detection off. */
  idleLimitSecs: number | null;
}

/**
 * Decides whether a running timer should stop counting, and from when. The time spent
 * idle is not counted: the pause is dated at the last keyboard or mouse input.
 */
export function watch(t: TimerState, o: WatchInput): { at: number; reason: PauseReason } | null {
  if (t.paused) return null;
  let hit: { at: number; reason: PauseReason } | null = null;
  // Checks are seconds apart; a long silence means the Mac was asleep (or the app frozen).
  if (o.now - o.lastTick > SLEEP_GAP_MS) hit = { at: o.lastTick, reason: "asleep" };
  if (o.idleLimitSecs !== null && o.idleSecs !== null && o.idleSecs >= o.idleLimitSecs) {
    const at = o.now - o.idleSecs * 1000;
    if (!hit || at < hit.at) hit = { at, reason: "idle" };
  }
  return hit;
}

// --- what a stop writes to Redmine ---------------------------------------------

export interface StopInput {
  /** Seconds in the timer being stopped. */
  seconds: number;
  /** Timed seconds not yet written for this ticket and day. Pass 0 when there is no entry to add to. */
  carry: number;
  /** An entry for this ticket and day already exists. */
  hasEntry: boolean;
  /** Timers shorter than this are dropped. */
  minSeconds: number;
  /** The step time is logged in, in hours; 0 for none. Quarter hours if left out. */
  increment?: number;
}

export type StopPlan =
  | { kind: "discard"; carry: number }
  /** Too little to reach the next step: remembered here, nothing sent. */
  | { kind: "carry"; carry: number }
  | { kind: "write"; addHours: number; carry: number };

/**
 * Hours are logged in steps (quarter hours by default) and the total is rounded UP to the next
 * step, so no minute worked is left out. Rounding each stop on its own would add up to too much
 * (three 5-minute stops are not 0.75h), so what the rounding gave extra is carried, as a negative
 * amount, into the next stop on the same ticket and day: six 10-minute stops come to exactly 1h.
 * A carry is therefore never time that is owed, only time already credited, so letting it expire
 * loses nothing. With no step the rounding is only to hundredths, and the carry is a few seconds.
 */
export function planStop({ seconds, carry, hasEntry, minSeconds, increment = DEFAULT_INCREMENT }: StopInput): StopPlan {
  if (seconds < minSeconds) return { kind: "discard", carry };
  const pending = carry + seconds;
  let addHours = Math.max(0, roundUp(pending / 3600, increment));
  if (addHours === 0) {
    if (hasEntry) return { kind: "carry", carry: pending };
    addHours = smallest(increment); // a new entry never rounds down to nothing
  }
  return { kind: "write", addHours, carry: pending - addHours * 3600 };
}

export const MAX_NOTES = 1024; // Redmine's limit for an entry's comment

/** Notes from the timer are appended to what the entry already says. */
export function mergeNotes(existing: string, added: string): string {
  const a = existing.trim();
  const b = added.trim();
  if (!b || a.includes(b)) return a;
  return (a ? `${a}; ${b}` : b).slice(0, MAX_NOTES);
}

interface EntryLike {
  id: number;
  issueId?: number;
  activityId?: number;
  hours: number;
  comments: string;
}

/** The entry a stop adds to: the one the timer made earlier, else any for the same ticket (and activity). */
export function findTarget<E extends EntryLike>(
  dayEntries: E[],
  t: Pick<TimerState, "issue" | "activityId">,
  item?: Pick<LedgerItem, "entryId">,
): E | undefined {
  const mine = dayEntries.filter(
    (e) => e.issueId === t.issue.id && (t.activityId === undefined || e.activityId === t.activityId),
  );
  return mine.find((e) => e.id === item?.entryId) ?? mine[0];
}

export const hoursAfter = (current: number, add: number): number => Math.round(clamp(current + add) * 100) / 100;

// --- the ledger ----------------------------------------------------------------

export const ledgerKey = (issueId: number, date: string, activityId?: number): string =>
  `${issueId}|${date}|${activityId ?? 0}`;

export function recordStop(
  ledger: Ledger,
  key: string,
  t: TimerState,
  now: number,
  result: { entryId?: number; carry: number },
): Ledger {
  const before = ledger[key];
  const sessions = [...(before?.sessions ?? []), ...closedSessions(t)].slice(-MAX_SESSIONS);
  return {
    ...ledger,
    [key]: { date: t.date, entryId: result.entryId ?? before?.entryId, carry: result.carry, sessions, updated: now },
  };
}

/** Drops history older than KEEP_DAYS. */
export function pruneLedger(ledger: Ledger, today: Date): Ledger {
  const oldest = iso(addDays(today, -KEEP_DAYS));
  return Object.fromEntries(Object.entries(ledger).filter(([, item]) => item.date >= oldest));
}
