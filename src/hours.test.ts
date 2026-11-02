import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHours, snap, fmt } from "./hours.ts";

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
