import { invoke } from "@tauri-apps/api/core";

export interface User {
  id: number;
  login: string;
  name: string;
}

export interface SessionInfo {
  url: string;
  user: User;
}

export interface Restore {
  url?: string;
  session?: SessionInfo;
  error?: string;
  /** A proxy in front of Redmine (Pomerium) wants a company sign-in. */
  ssoRequired?: boolean;
}

export interface Entry {
  id: number;
  issueId?: number;
  issueSubject?: string;
  projectId?: number;
  projectName: string;
  activityId?: number;
  activityName: string;
  hours: number;
  comments: string;
  spentOn: string; // YYYY-MM-DD
}

export interface IssueHit {
  id: number;
  subject: string;
  projectId?: number;
  projectName: string;
  tracker: string;
  status: string;
}

export interface Activity {
  id: number;
  name: string;
  isDefault: boolean;
}

export interface NewEntry {
  issueId: number;
  projectId?: number;
  spentOn: string;
  hours: number;
  comments: string;
  activityId?: number;
}

export interface EntryPatch {
  hours?: number;
  comments?: string;
  activityId?: number;
}

const inTauri = "__TAURI_INTERNALS__" in window;

/** Commands are implemented in Rust (src-tauri). In a plain browser during
 *  development they're served by an in-memory fake so the UI can be worked on
 *  without a Redmine instance. */
function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const result =
    import.meta.env.DEV && !inTauri ? import("./mock").then((m) => m.mock<T>(cmd, args)) : invoke<T>(cmd, args);
  return result.catch((e) => {
    if (isSso(e)) ssoListener?.();
    throw e;
  });
}

/** Rust errors arrive as `{ kind, message }`. */
export const errMsg = (e: unknown): string => {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return "Something went wrong.";
};

/** The proxy in front of Redmine needs a (new) company sign-in. */
export const isSso = (e: unknown): boolean => !!e && typeof e === "object" && "kind" in e && e.kind === "sso";

let ssoListener: (() => void) | undefined;

/** Called whenever any request finds the company sign-in missing or expired. */
export const onSsoRequired = (fn: (() => void) | undefined) => {
  ssoListener = fn;
};

export const api = {
  restore: () => call<Restore>("restore_session"),
  /** `sso` runs the browser sign-in for a Redmine behind Pomerium first. */
  login: (url: string, apiKey: string, sso = false) => call<SessionInfo>("login", { url, apiKey, sso }),
  cancelSso: () => call<void>("cancel_sso"),
  logout: () => call<void>("logout"),
  listEntries: (from: string, to: string) => call<Entry[]>("list_time_entries", { from, to }),
  searchIssues: (query: string) => call<IssueHit[]>("search_issues", { query }),
  activities: (projectId?: number) => call<Activity[]>("list_activities", { projectId }),
  createEntry: (input: NewEntry) => call<Entry>("create_time_entry", { input }),
  updateEntry: (id: number, patch: EntryPatch) => call<Entry>("update_time_entry", { id, ...patch }),
  deleteEntry: (id: number) => call<void>("delete_time_entry", { id }),
};
