import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTrackOn,
  closedSessions,
  dueForAutoLog,
  elapsedMs,
  findTarget,
  formatClock,
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
  SLEEP_GAP_MS,
  type Ledger,
} from "./timer.ts";

const issue = { id: 1042, subject: "Login loop", projectId: 1, projectName: "Atlas" };
const T0 = 1_000_000_000_000;
const min = (n: number) => n * 60_000;
const timer = () => startTimer(issue, "2026-11-06", T0);

test("a timer can log to today or an earlier day of this month, nothing else", () => {
  const today = "2026-11-18";
  assert.equal(canTrackOn("2026-11-18", today), true, "today");
  assert.equal(canTrackOn("2026-11-17", today), true, "yesterday");
  assert.equal(canTrackOn("2026-11-01", today), true, "the first of the month");
  assert.equal(canTrackOn("2026-10-31", today), false, "the last day of the previous month");
  assert.equal(canTrackOn("2026-10-18", today), false, "the same day last month");
  assert.equal(canTrackOn("2025-11-18", today), false, "the same month last year");
  assert.equal(canTrackOn("2026-11-19", today), false, "tomorrow");
  assert.equal(canTrackOn("2026-12-01", today), false, "next month");
  // On the first, only today is open.
  assert.equal(canTrackOn("2026-12-01", "2026-12-01"), true);
  assert.equal(canTrackOn("2026-11-30", "2026-12-01"), false);
});

test("elapsed time counts only the stretches that ran", () => {
  let t = timer();
  assert.equal(elapsedMs(t, T0 + min(10)), min(10)); // still running
  t = pauseTimer(t, T0 + min(10), "manual");
  assert.equal(elapsedMs(t, T0 + min(500)), min(10)); // paused: the clock stands still
  t = resumeTimer(t, T0 + min(30));
  assert.equal(elapsedMs(t, T0 + min(35)), min(15));
  assert.deepEqual(closedSessions(t), [[T0, T0 + min(10)]]);
});

test("pausing in the past, and pausing an empty stretch", () => {
  const t = timer();
  assert.equal(pauseTimer(t, T0 - 5, "idle").segments.length, 0, "can't end before it started");
  const p = pauseTimer(t, T0 + min(3), "idle");
  assert.deepEqual(p.paused, { reason: "idle", at: T0 + min(3) });
  assert.equal(pauseTimer(p, T0 + min(9), "manual"), p, "already paused");
  assert.equal(resumeTimer(t, T0 + 1), t, "already running");
});

test("a timer found running at launch is cut off where the app was last seen", () => {
  const t = { ...timer(), seenAt: T0 + min(7) };
  const r = recoverTimer(t);
  assert.equal(r.paused?.reason, "closed");
  assert.equal(elapsedMs(r, T0 + min(600)), min(7));
});

test("idle: pauses at the last input, not when the limit was noticed", () => {
  const t = timer();
  const now = T0 + min(10);
  const hit = watch(t, { now, lastTick: now - 5000, idleSecs: 150, idleLimitSecs: 120 });
  assert.deepEqual(hit, { at: now - 150_000, reason: "idle" });
  assert.equal(watch(t, { now, lastTick: now - 5000, idleSecs: 119, idleLimitSecs: 120 }), null);
  assert.equal(watch(t, { now, lastTick: now - 5000, idleSecs: 9999, idleLimitSecs: null }), null, "detection off");
  assert.equal(watch(t, { now, lastTick: now - 5000, idleSecs: null, idleLimitSecs: 120 }), null, "unknown on this OS");
  assert.equal(watch(pauseTimer(t, now, "manual"), { now, lastTick: now, idleSecs: 999, idleLimitSecs: 60 }), null);
});

test("sleep: a long gap between checks pauses at the last check", () => {
  const t = timer();
  const now = T0 + min(120);
  const hit = watch(t, { now, lastTick: T0 + min(20), idleSecs: 0, idleLimitSecs: 120 });
  assert.deepEqual(hit, { at: T0 + min(20), reason: "asleep" });
  assert.equal(watch(t, { now, lastTick: now - SLEEP_GAP_MS, idleSecs: 0, idleLimitSecs: 120 }), null, "exactly the limit is fine");
  // Idle before the lid closed: the earlier moment wins.
  const both = watch(t, { now, lastTick: T0 + min(20), idleSecs: 110 * 60, idleLimitSecs: 120 });
  assert.equal(both?.reason, "idle");
  assert.equal(both?.at, T0 + min(10));
});

test("stop: the total is rounded UP to the next quarter hour", () => {
  const plan = (seconds: number) => planStop({ seconds, carry: 0, hasEntry: false, minSeconds: 60 });
  assert.deepEqual(plan(40 * 60), { kind: "write", addHours: 0.75, carry: 40 * 60 - 2700 });
  assert.deepEqual(plan(3600), { kind: "write", addHours: 1, carry: 0 }, "an exact step stays exact");
  assert.deepEqual(plan(8 * 60), { kind: "write", addHours: 0.25, carry: 8 * 60 - 900 });
  assert.deepEqual(plan(20 * 60), { kind: "write", addHours: 0.5, carry: 20 * 60 - 1800 }, "nearest would have said 0.25");
  assert.deepEqual(plan(15 * 60 + 1), { kind: "write", addHours: 0.5, carry: 15 * 60 + 1 - 1800 }, "any part of a step counts");
});

test("stop: a few minutes is a whole step, on a new entry and on an existing one", () => {
  for (const hasEntry of [false, true]) {
    assert.deepEqual(planStop({ seconds: 3 * 60, carry: 0, hasEntry, minSeconds: 60 }), {
      kind: "write",
      addHours: 0.25,
      carry: 3 * 60 - 900,
    });
  }
});

test("stop: timers under the minimum are dropped", () => {
  assert.equal(planStop({ seconds: 45, carry: 0, hasEntry: false, minSeconds: 60 }).kind, "discard");
  assert.equal(planStop({ seconds: 60, carry: 0, hasEntry: false, minSeconds: 60 }).kind, "write");
  assert.equal(planStop({ seconds: 5, carry: 0, hasEntry: false, minSeconds: 0 }).kind, "write", "0 keeps everything");
});

test("stop: carried time is applied once and never subtracts", () => {
  // The floor over-credited 12 minutes; a 2-minute stop must not remove hours.
  const plan = planStop({ seconds: 120, carry: -720, hasEntry: true, minSeconds: 60 });
  assert.deepEqual(plan, { kind: "carry", carry: -600 });
});

test("many short stops on one ticket add up to what was worked", () => {
  // Six 10-minute stops = 1 hour. Rounding each on its own would give 1.50h (or 0h).
  let carry = 0;
  let hasEntry = false;
  let hours = 0;
  for (let i = 0; i < 6; i++) {
    const p = planStop({ seconds: 600, carry: hasEntry ? carry : 0, hasEntry, minSeconds: 60 });
    carry = p.carry;
    if (p.kind === "write") {
      hours += p.addHours;
      hasEntry = true;
    }
  }
  assert.equal(hours, 1);
  assert.equal(Math.round(carry), 0);
});

test("notes from the timer are appended, once", () => {
  assert.equal(mergeNotes("", "Fixed the loop"), "Fixed the loop");
  assert.equal(mergeNotes("Reproduced it", "Fixed the loop"), "Reproduced it; Fixed the loop");
  assert.equal(mergeNotes("Reproduced it; Fixed the loop", "Fixed the loop"), "Reproduced it; Fixed the loop");
  assert.equal(mergeNotes("Reproduced it", "  "), "Reproduced it");
  assert.equal(mergeNotes("x".repeat(1000), "y".repeat(100)).length, 1024);
});

test("the target entry: the timer's own, else the same ticket and activity", () => {
  const entries = [
    { id: 1, issueId: 7, activityId: 9, hours: 1, comments: "" },
    { id: 2, issueId: 1042, activityId: 8, hours: 1, comments: "" },
    { id: 3, issueId: 1042, activityId: 9, hours: 2, comments: "" },
    { id: 4, issueId: 1042, activityId: 9, hours: 3, comments: "" },
  ];
  assert.equal(findTarget(entries, { issue, activityId: 9 })?.id, 3);
  assert.equal(findTarget(entries, { issue, activityId: 9 }, { entryId: 4 })?.id, 4);
  assert.equal(findTarget(entries, { issue, activityId: 9 }, { entryId: 99 })?.id, 3, "the timer's entry was deleted");
  assert.equal(findTarget(entries, { issue }, undefined)?.id, 2, "no activity chosen: any for the ticket");
  assert.equal(findTarget(entries, { issue: { ...issue, id: 5 }, activityId: 9 }), undefined);
});

test("the ledger remembers sessions and forgets old days", () => {
  const key = ledgerKey(1042, "2026-11-06", 9);
  const t = pauseTimer(timer(), T0 + min(20), "manual");
  const once = recordStop({}, key, t, T0 + min(21), { entryId: 5, carry: -300 });
  assert.deepEqual(once[key].sessions, [[T0, T0 + min(20)]]);
  const twice = recordStop(once, key, t, T0 + min(22), { carry: 60 });
  assert.equal(twice[key].entryId, 5, "keeps the entry it already knew");
  assert.equal(twice[key].sessions.length, 2);

  const ledger: Ledger = {
    old: { date: "2026-10-28", carry: 0, sessions: [], updated: 0 },
    edge: { date: "2026-10-30", carry: 0, sessions: [], updated: 0 },
    fresh: { date: "2026-11-06", carry: 0, sessions: [], updated: 0 },
  };
  assert.deepEqual(Object.keys(pruneLedger(ledger, new Date(2026, 10, 6))), ["edge", "fresh"]);
});

test("the clock reads h:mm:ss", () => {
  assert.equal(formatClock(0), "0:00:00");
  assert.equal(formatClock(61_000), "0:01:01");
  assert.equal(formatClock(3_725_000), "1:02:05");
  assert.equal(formatClock(-5), "0:00:00");
});

test("stop: 25 minutes is logged as 30 when time goes in quarter hours (or halves)", () => {
  const at = (increment: number) => planStop({ seconds: 25 * 60, carry: 0, hasEntry: false, minSeconds: 60, increment });
  assert.deepEqual(at(0.25), { kind: "write", addHours: 0.5, carry: 25 * 60 - 1800 });
  assert.deepEqual(at(0.5), { kind: "write", addHours: 0.5, carry: 25 * 60 - 1800 });
});

test("stop: with no step it logs the exact time, to hundredths", () => {
  const p = planStop({ seconds: 25 * 60, carry: 0, hasEntry: false, minSeconds: 60, increment: 0 });
  assert.equal(p.kind, "write");
  assert.equal(p.kind === "write" && p.addHours, 0.42);
  // The few seconds the rounding left over are carried, not lost.
  assert.ok(Math.abs(p.carry) <= 18, `carry ${p.carry}`);
});

test("stop: with a one-hour step, five minutes is one hour (the rest is credited, not owed)", () => {
  for (const hasEntry of [false, true]) {
    assert.deepEqual(planStop({ seconds: 5 * 60, carry: 0, hasEntry, minSeconds: 60, increment: 1 }), { kind: "write", addHours: 1, carry: 300 - 3600 });
  }
  // ...and the next five minutes on the same ticket and day are already covered.
  assert.deepEqual(planStop({ seconds: 5 * 60, carry: 300 - 3600, hasEntry: true, minSeconds: 60, increment: 1 }), { kind: "carry", carry: 600 - 3600 });
});

test("stop: a carry is never time owed, so dropping it loses nothing", () => {
  // Whatever happened before, a rounded-up stop leaves the carry at or below zero.
  for (const seconds of [1, 59, 60, 301, 899, 900, 901, 3599, 5400]) {
    for (const increment of [0.25, 0.5, 1]) {
      const p = planStop({ seconds, carry: 0, hasEntry: false, minSeconds: 0, increment });
      assert.ok(p.carry <= 1e-6, `${seconds}s @${increment}: carry ${p.carry}`);
    }
  }
});

test("a paused timer is logged for you once it has been paused long enough", () => {
  const paused = pauseTimer(timer(), T0, "manual");
  assert.equal(dueForAutoLog(paused, T0 + min(29), 30), false);
  assert.equal(dueForAutoLog(paused, T0 + min(30), 30), true);
  assert.equal(dueForAutoLog(paused, T0 + min(500), 0), false, "0 means never");
  assert.equal(dueForAutoLog(timer(), T0 + min(500), 30), false, "a running timer is never logged for you");
  // A pause by idleness is dated at the last input, so the wait is counted from there.
  const idle = pauseTimer(timer(), T0 + min(10), "idle");
  assert.equal(dueForAutoLog(idle, T0 + min(40), 30), true);
});

test("logging for you never deletes: a timer under the minimum is left for you to decide", () => {
  // 4 minutes counted, then paused: a stop would drop it (minimum 5), so it just waits.
  const short = pauseTimer(startTimer(issue, "2026-11-06", T0), T0 + min(4), "manual");
  assert.equal(dueForAutoLog(short, T0 + min(600), 30, min(5) / 1000), false);
  assert.equal(dueForAutoLog(short, T0 + min(600), 30, min(4) / 1000), true, "at the minimum it is kept");
});

test("stop: with no step, a tiny timer on a new entry is the smallest entry, 0.01h", () => {
  const p = planStop({ seconds: 5, carry: 0, hasEntry: false, minSeconds: 0, increment: 0 });
  assert.equal(p.kind === "write" && p.addHours, 0.01);
});
