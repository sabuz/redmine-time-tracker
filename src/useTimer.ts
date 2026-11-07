import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, errMsg, type Entry } from "./api";
import { dayLong, iso, parseIso } from "./dates";
import { fmt, smallest, stepHint } from "./hours";
import {
  HEARTBEAT_MS,
  TICK_MS,
  canTrackOn,
  dueForAutoLog,
  elapsedMs,
  findTarget,
  hoursAfter,
  isRunning,
  ledgerKey,
  mergeNotes,
  pauseTimer,
  planStop,
  pruneLedger,
  recordStop,
  recoverTimer,
  resumeTimer,
  startTimer,
  watch,
  type Ledger,
  type TimedIssue,
  type TimerState,
} from "./timer";
import { loadTimerData, saveTimerData } from "./timerStore";

interface Options {
  /** The timer belongs to one Redmine instance. */
  url: string;
  /** The timer is switched on in Settings. */
  enabled: boolean;
  idleMinutes: number;
  minSessionMinutes: number;
  /** The step time is logged in, in hours; 0 for none (Settings → Time increments). */
  increment: number;
  /** A timer paused this many minutes is stopped and logged for you (0 = never). */
  autoLogMinutes: number;
  /** A message for the user. */
  notify: (message: string) => void;
  /** Time was written to Redmine, so what's on screen is out of date. */
  onLogged: () => void;
}

/**
 * One timer at a time. It lives on this Mac (see timerStore.ts) and Redmine is only
 * contacted by `stop`: one request to look at the day's entries, one to add the time.
 */
export function useTimer(options: Options) {
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [ledger, setLedger] = useState<Ledger>({});
  const [busy, setBusy] = useState(false);

  // The latest values, for callbacks that outlive a render (intervals, async work).
  const opts = useRef(options);
  opts.current = options;
  const timerRef = useRef<TimerState | null>(null);
  const ledgerRef = useRef<Ledger>({});
  const busyRef = useRef(false);
  const loaded = useRef(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>();

  const persist = (delay = 0): Promise<void> => {
    clearTimeout(saveTimeout.current);
    const write = () => saveTimerData(opts.current.url, { timer: timerRef.current, ledger: ledgerRef.current });
    if (delay <= 0) return write();
    saveTimeout.current = setTimeout(write, delay);
    return Promise.resolve();
  };

  const commit = (next: TimerState | null, nextLedger?: Ledger, saveIn = 0) => {
    timerRef.current = next;
    setTimer(next);
    if (nextLedger) {
      ledgerRef.current = nextLedger;
      setLedger(nextLedger);
    }
    return persist(saveIn);
  };

  // --- restore what was there when the app last closed ----------------------
  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    loadTimerData(options.url).then((data) => {
      if (cancelled) return;
      const now = new Date();
      // Still "running" on disk means the app was closed or crashed: count up to the last heartbeat only.
      const restored = data.timer && isRunning(data.timer) ? recoverTimer(data.timer) : data.timer;
      const pruned = pruneLedger(data.ledger, now);
      timerRef.current = restored;
      ledgerRef.current = pruned;
      setTimer(restored);
      setLedger(pruned);
      loaded.current = true;
      if (restored !== data.timer || Object.keys(pruned).length !== Object.keys(data.ledger).length) void persist();
      const logsItself = !!restored && opts.current.enabled && dueForAutoLog(restored, now.getTime(), opts.current.autoLogMinutes, opts.current.minSessionMinutes * 60);
      if (restored && restored.date !== iso(now) && !logsItself) {
        opts.current.notify(`A timer for #${restored.issue.id} on ${dayLong(parseIso(restored.date))} is waiting.`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [options.url]);

  // Leaving the timesheet (an expired company sign-in sends you to the sign-in screen) must not leave a timer
  // "running" with nothing watching it: it is paused here, and says so, not "closed" as after a crash.
  useEffect(
    () => () => {
      const t = timerRef.current;
      if (!loaded.current || !t || !isRunning(t)) return;
      timerRef.current = pauseTimer(t, Date.now(), "manual");
      void persist();
    },
    [],
  );

  // Switching the timer off in Settings pauses one that is running.
  useEffect(() => {
    const t = timerRef.current;
    if (!options.enabled && t && isRunning(t)) void commit(pauseTimer(t, Date.now(), "manual"));
  }, [options.enabled]);

  // --- a timer left paused is logged for you ---------------------------------
  // One attempt per pause: if Redmine refuses (offline, a locked month), the timer is kept and nothing
  // retries until it is paused again or the app is reopened, so a failure can't repeat every few seconds.
  const pausedAt = timer?.paused?.at;
  useEffect(() => {
    if (!options.enabled || options.autoLogMinutes <= 0 || pausedAt === undefined) return;
    const wait = Math.max(0, pausedAt + options.autoLogMinutes * 60_000 - Date.now());
    const id = setTimeout(() => {
      const t = timerRef.current;
      if (!t || t.paused?.at !== pausedAt || busyRef.current) return;
      if (dueForAutoLog(t, Date.now(), opts.current.autoLogMinutes, opts.current.minSessionMinutes * 60)) void stop(true);
    }, wait);
    return () => clearTimeout(id);
  }, [pausedAt, options.autoLogMinutes, options.enabled]);

  // --- watch a running timer: idle, sleep, heartbeat --------------------------
  const running = !!timer && isRunning(timer);
  useEffect(() => {
    if (!running) return;
    let lastTick = Date.now();
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const idleSecs = await api.idleSeconds().catch(() => null);
        const now = Date.now();
        const t = timerRef.current;
        if (!t || !isRunning(t)) return;
        const minutes = opts.current.idleMinutes;
        const hit = watch(t, { now, lastTick, idleSecs, idleLimitSecs: minutes > 0 ? minutes * 60 : null });
        lastTick = now;
        if (hit) void commit(pauseTimer(t, hit.at, hit.reason));
        else if (now - t.seenAt >= HEARTBEAT_MS) void commit({ ...t, seenAt: now });
      } finally {
        checking = false;
      }
    };
    const id = setInterval(check, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  // --- controls ---------------------------------------------------------------
  const pause = () => {
    const t = timerRef.current;
    if (t && isRunning(t)) void commit(pauseTimer(t, Date.now(), "manual"));
  };

  const resume = () => {
    const t = timerRef.current;
    // Once its day has slipped into a previous month it can only be stopped, so that time is still logged.
    if (t && t.paused && canTrackOn(t.date, iso(new Date()))) void commit(resumeTimer(t, Date.now()));
  };

  const setNotes = (notes: string) => {
    const t = timerRef.current;
    if (t) void commit({ ...t, notes }, undefined, 400);
  };

  const discard = () => void commit(null);

  /**
   * Stops the timer and writes its time to Redmine. Returns false if that didn't work; the timer is kept.
   * `auto` is for a timer logged because it sat paused (see below), and says so in the message.
   */
  const stop = async (auto = false): Promise<boolean> => {
    const current = timerRef.current;
    if (!current || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    let attempted = 0; // the entry's total this stop tried to write, for the hint if Redmine refuses it
    try {
      const now = Date.now();
      // The clock stands still while Redmine is asked.
      const frozen = isRunning(current) ? pauseTimer(current, now, "manual") : current;
      await commit(frozen);

      const { issue, date, notes } = frozen;
      const key = ledgerKey(issue.id, date, frozen.activityId);
      const item = ledgerRef.current[key];
      const seconds = elapsedMs(frozen, now) / 1000;

      const dayEntries = await api.listEntries(date, date);
      const target = findTarget(dayEntries, frozen, item);
      const plan = planStop({
        seconds,
        carry: target ? (item?.carry ?? 0) : 0,
        hasEntry: !!target,
        minSeconds: opts.current.minSessionMinutes * 60,
        increment: opts.current.increment,
      });
      if (plan.kind === "write") attempted = hoursAfter(target?.hours ?? 0, plan.addHours);

      if (plan.kind === "discard") {
        await commit(null);
        const m = opts.current.minSessionMinutes;
        opts.current.notify(`Under ${m} minute${m === 1 ? "" : "s"}, so it wasn't logged.`);
        return true;
      }

      let saved: Entry | undefined = target;
      let message: string;
      if (plan.kind === "write") {
        if (target) {
          const comments = mergeNotes(target.comments, notes);
          saved = await api.updateEntry(target.id, {
            hours: hoursAfter(target.hours, plan.addHours),
            ...(comments !== target.comments ? { comments } : {}),
          });
          message = `Logged ${fmt(plan.addHours)}h to #${issue.id} (${fmt(saved.hours)}h in total).`;
        } else {
          saved = await api.createEntry({
            issueId: issue.id,
            projectId: issue.projectId,
            spentOn: date,
            hours: plan.addHours,
            comments: notes.trim(),
            activityId: frozen.activityId,
          });
          message = `Logged ${fmt(plan.addHours)}h to #${issue.id}.`;
        }
      } else {
        // Not enough for another step yet; only a new note is worth a request.
        const comments = target ? mergeNotes(target.comments, notes) : "";
        if (target && comments !== target.comments) saved = await api.updateEntry(target.id, { comments });
        const m = Math.max(1, Math.round(seconds / 60));
        // Rounding up leaves time already credited; with no step, a few seconds are kept until they add up to 0.01h.
        message =
          opts.current.increment > 0
            ? `${m} min on #${issue.id} was already covered by the time logged earlier.`
            : `${m} min on #${issue.id} kept; it counts once it adds up to ${fmt(smallest(0))}h.`;
      }

      await commit(null, recordStop(ledgerRef.current, key, frozen, now, { entryId: saved?.id, carry: plan.carry }));
      opts.current.notify(auto ? `It was paused for a while, so it was logged. ${message}` : message);
      opts.current.onLogged();
      return true;
    } catch (e) {
      opts.current.notify(`Couldn't log the time: ${stepHint(errMsg(e), attempted, opts.current.increment)} The timer is kept; right-click it to try again.`);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  /**
   * Starts timing a ticket, logging to `extra.date` (default: today). A timer already running for
   * another ticket or day is stopped (and logged) first.
   */
  const start = async (
    issue: TimedIssue,
    extra: { activityId?: number; notes?: string; date?: string } = {},
  ): Promise<boolean> => {
    if (busyRef.current || !loaded.current) return false;
    const today = iso(new Date());
    const date = extra.date ?? today;
    if (!canTrackOn(date, today)) {
      opts.current.notify("A timer can log to today or an earlier day of this month, not a future day or a previous month.");
      return false;
    }
    const current = timerRef.current;
    if (current && current.issue.id === issue.id && current.date === date) {
      resume();
      return true;
    }
    if (current && !(await stop())) return false;
    const now = Date.now();
    await commit(startTimer(issue, date, now, { activityId: extra.activityId, notes: extra.notes }));
    return true;
  };

  /** Stretches timed for each entry the timer has written to, for the row tooltip. */
  const sessionsByEntry = useMemo(() => {
    const map = new Map<number, [number, number][]>();
    for (const item of Object.values(ledger)) {
      if (item.entryId !== undefined && item.sessions.length) map.set(item.entryId, item.sessions);
    }
    return map;
  }, [ledger]);

  return { timer, busy, start, pause, resume, stop, discard, setNotes, flush: () => persist(0), sessionsByEntry };
}
