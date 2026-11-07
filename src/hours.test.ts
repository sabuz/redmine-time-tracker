import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHours, snap, fmt, smallest, stepHint, stepOf } from "./hours.ts";

test("parses plain decimals and snaps to quarters", () => {
  assert.equal(parseHours("1.5"), 1.5);
  assert.equal(parseHours("1,5"), 1.5);
  assert.equal(parseHours(".25"), 0.25);
  assert.equal(parseHours("2"), 2);
  assert.equal(parseHours("1.1"), 1);
  assert.equal(parseHours("1.13"), 1.25);
});

test("parses h:mm and h/m forms", () => {
  assert.equal(parseHours("1:30"), 1.5);
  assert.equal(parseHours("0:20"), 0.25);
  assert.equal(parseHours("1h"), 1);
  assert.equal(parseHours("1h30"), 1.5);
  assert.equal(parseHours("1h 30m"), 1.5);
  assert.equal(parseHours("90m"), 1.5);
  assert.equal(parseHours("45 min"), 0.75);
});

test("rejects non-times", () => {
  assert.equal(parseHours(""), null);
  assert.equal(parseHours("abc"), null);
  assert.equal(parseHours("1.2.3"), null);
});

test("formats with two decimals", () => {
  assert.equal(fmt(snap(0.3)), "0.25");
  assert.equal(fmt(3), "3.00");
});

test("fixed steps: 25 minutes worked is logged as 30", () => {
  assert.equal(parseHours("25m"), 0.5, "quarter hours (the default)");
  assert.equal(parseHours("25m", 0.25), 0.5);
  assert.equal(parseHours("25m", 0.5), 0.5, "half hours");
  assert.equal(parseHours("40m", 1), 1, "whole hours");
  assert.equal(parseHours("20m", 0.25), 0.25);
  assert.equal(parseHours("1.1", 0.25), 1);
});

test("no step: exact time, to hundredths of an hour", () => {
  assert.equal(parseHours("25m", 0), 0.42);
  assert.equal(parseHours("1.1", 0), 1.1);
  assert.equal(parseHours("1:10", 0), 1.17);
  assert.equal(snap(1 / 3, 0), 0.33);
  assert.equal(snap(0.37, 0.25), 0.25);
});

test("the + and − buttons use the step, or a quarter hour when there is none", () => {
  assert.equal(stepOf(0.5), 0.5);
  assert.equal(stepOf(0), 0.25);
  assert.equal(smallest(0.5), 0.5);
  assert.equal(smallest(0), 0.01);
});

test("a refusal of an off-step time points at the setting, once, and only when it may be the cause", () => {
  const refused = "Hours is invalid";
  assert.match(stepHint(refused, 0.42, 0), /Time increments/);
  assert.equal(stepHint(refused, 0.42, 0.25), refused, "a step is already set");
  assert.equal(stepHint(refused, 0.5, 0), refused, "0.5 is on the quarter-hour grid");
  assert.equal(stepHint("Redmine refused the request (403).", 0.42, 0), "Redmine refused the request (403).", "unrelated error");
});
