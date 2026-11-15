import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, formatSpan } from "./timeline.ts";

const at = (h: number, m = 0, day = 6) => new Date(2026, 10, day, h, m).getTime();

test("no usable stretches, no chart", () => {
  assert.equal(buildTimeline([]), null);
  assert.equal(buildTimeline([[at(9), at(9)]]), null, "an empty stretch");
});

test("the line climbs while working and stays flat in the gaps", () => {
  // 9:00–9:30 (30m), a 30m break, then 10:00–11:00 (60m): 90m in 2h.
  const t = buildTimeline([[at(9), at(9, 30)], [at(10), at(11)]])!;
  assert.equal(t.totalMs, 90 * 60_000);
  assert.deepEqual(
    t.points.map((p) => [Math.round(p.x * 120), Math.round(p.y * 90)]),
    [[0, 0], [30, 30], [60, 30], [120, 90]],
  );
  assert.equal(t.points[0].y, 0);
  assert.equal(t.points.at(-1)!.y, 1);
  assert.deepEqual(t.starts.map((x) => Math.round(x * 120)), [0, 60]);
  assert.equal(t.multiDay, false);
  assert.deepEqual(t.breaks, []);
});

test("stretches given out of order are laid out in order", () => {
  const t = buildTimeline([[at(10), at(11)], [at(9), at(9, 30)]])!;
  assert.deepEqual(t.sessions[0], [at(9), at(9, 30)]);
  assert.equal(t.firstStart, at(9));
  assert.equal(t.lastEnd, at(11));
});

test("sessions days apart squeeze the gap between them", () => {
  const t = buildTimeline([[at(9, 0, 4), at(10, 0, 4)], [at(9, 0, 6), at(10, 0, 6)]])!;
  assert.equal(t.multiDay, true);
  assert.equal(t.breaks.length, 1);
  // Two hours worked plus a one-hour (capped) gap: the second stretch starts a third of the way... two thirds in.
  assert.equal(Math.round(t.starts[1] * 3), 2);
});

test("spans read as a person would say them", () => {
  assert.equal(formatSpan(40_000), "40s");
  assert.equal(formatSpan(25 * 60_000), "25m");
  assert.equal(formatSpan(60 * 60_000), "1h");
  assert.equal(formatSpan(80 * 60_000), "1h 20m");
});
