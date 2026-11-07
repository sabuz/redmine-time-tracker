import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseActivity } from "./activity.ts";

const list = [
  { id: 8, name: "Design", isDefault: false },
  { id: 9, name: "Development", isDefault: true },
  { id: 10, name: "Testing", isDefault: false },
];

test("a new entry starts on the project's default activity", () => {
  assert.equal(chooseActivity(list, undefined), 9);
  assert.equal(chooseActivity(list.map((a) => ({ ...a, isDefault: false })), undefined), 8, "no default: the first");
  assert.equal(chooseActivity([], undefined), undefined, "Redmine listed nothing");
});

test("the activity already chosen stays while the project offers it", () => {
  assert.equal(chooseActivity(list, 10), 10);
});

test("an activity from another ticket's project is not carried over", () => {
  // Ticket A (project 1) had activity 21; the user picked ticket B, whose project has its own ids.
  assert.equal(chooseActivity(list, 21), 9);
  assert.equal(chooseActivity([], 21), undefined);
});

test("an existing entry keeps its own activity even if Redmine no longer lists it", () => {
  assert.equal(chooseActivity(list, 5, 5), 5);
  assert.equal(chooseActivity([], 5, 5), 5);
});
