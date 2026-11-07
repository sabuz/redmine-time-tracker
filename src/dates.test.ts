import { test } from "node:test";
import assert from "node:assert/strict";
import { canChangeOn, canLogOn, loggableRange } from "./dates.ts";

// 2026-11-01 is a Sunday, so 2026-11-06 is a Friday.
const FRI = "2026-11-06";

test("new time: this month, up to the end of the current week (Sunday weeks)", () => {
  assert.deepEqual(loggableRange(FRI, 0), { from: "2026-11-01", to: "2026-11-07" });
  assert.equal(canLogOn("2026-11-06", FRI, 0), true, "today");
  assert.equal(canLogOn("2026-11-01", FRI, 0), true, "the first of the month");
  assert.equal(canLogOn("2026-11-07", FRI, 0), true, "later this week");
  assert.equal(canLogOn("2026-11-08", FRI, 0), false, "the first day of next week");
  assert.equal(canLogOn("2026-11-20", FRI, 0), false, "a later week");
  assert.equal(canLogOn("2026-10-31", FRI, 0), false, "the last day of the previous month");
  assert.equal(canLogOn("2025-11-06", FRI, 0), false, "the same day last year");
});

test("the week start decides where 'this week' ends", () => {
  assert.equal(canLogOn("2026-11-08", FRI, 1), true, "Sunday is the last day of a Monday week");
  assert.equal(canLogOn("2026-11-09", FRI, 1), false, "next Monday");
});

test("a week that straddles two months: the earlier month's days stay closed", () => {
  // Monday weeks: Sun 2026-11-01 sits in the week of Mon 2026-10-26.
  assert.equal(canLogOn("2026-11-01", "2026-11-01", 1), true, "today");
  assert.equal(canLogOn("2026-10-31", "2026-11-01", 1), false, "same week, previous month");
  assert.equal(canLogOn("2026-11-02", "2026-11-01", 1), false, "the next week");
  // The week of Mon 2026-11-30 runs into December, and those days are still this week.
  assert.equal(canLogOn("2026-12-06", "2026-11-30", 1), true, "same week, next month");
  assert.equal(canLogOn("2026-12-07", "2026-11-30", 1), false, "the week after");
});

test("year boundaries", () => {
  assert.equal(canLogOn("2027-01-02", "2026-12-31", 0), true, "the rest of the week, in January");
  assert.equal(canLogOn("2027-01-03", "2026-12-31", 0), false);
  assert.equal(canLogOn("2026-11-30", "2026-12-31", 0), false, "last month");
  assert.equal(canLogOn("2026-12-01", "2026-12-31", 0), true);
});

test("entries of earlier months are read-only; this month and later stay editable", () => {
  const today = "2026-11-18";
  assert.equal(canChangeOn("2026-11-18", today), true, "today");
  assert.equal(canChangeOn("2026-11-01", today), true, "the first of the month");
  assert.equal(canChangeOn("2026-10-31", today), false, "the last day of the previous month");
  assert.equal(canChangeOn("2025-11-18", today), false, "the same day last year");
  assert.equal(canChangeOn("2026-11-25", today), true, "a later week");
  // On the first, yesterday is already last month.
  assert.equal(canChangeOn("2026-11-30", "2026-12-01"), false);
  assert.equal(canChangeOn("2026-12-01", "2026-12-01"), true);
});
