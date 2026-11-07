import type { Activity } from "./api.ts";

/**
 * Which activity to select once a project's list has loaded. The one already chosen stays if this project
 * offers it, or if it is the entry's own (which Redmine may no longer list). Otherwise it is the project's
 * default, else the first. Activities can be set per project with ids of their own, so one picked for another
 * ticket's project must not be sent along: Redmine refuses an activity that isn't in the project's list.
 */
export function chooseActivity(list: Activity[], current: number | undefined, own?: number): number | undefined {
  if (current !== undefined && (current === own || list.some((a) => a.id === current))) return current;
  return list.find((a) => a.isDefault)?.id ?? list[0]?.id;
}
