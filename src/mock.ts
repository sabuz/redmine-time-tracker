// Development-only stand-in for the Rust backend, used when the UI runs in a
// plain browser (`npm run dev`, no Tauri). Mirrors the commands in
// src-tauri/src/lib.rs against an in-memory dataset. Not shipped: api.ts only
// imports this behind `import.meta.env.DEV`.
import type { Activity, Entry, IssueHit, NewEntry, Restore, SessionInfo } from "./api";
import { addDays, iso, startOfWeek } from "./dates";

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

const project = { id: 1, name: "Atlas Platform" };
const project2 = { id: 2, name: "Customer Portal" };

const issues: IssueHit[] = [
  { id: 1042, subject: "Login redirect loops after session timeout", projectId: 1, projectName: project.name, tracker: "Bug", status: "In Progress" },
  { id: 1051, subject: "Add CSV export to the invoices list", projectId: 2, projectName: project2.name, tracker: "Feature", status: "New" },
  { id: 1063, subject: "Upgrade Rails to 7.1", projectId: 1, projectName: project.name, tracker: "Task", status: "In Progress" },
  { id: 1077, subject: "Weekly sync with design", projectId: 2, projectName: project2.name, tracker: "Support", status: "New" },
  { id: 1088, subject: "Investigate slow dashboard query", projectId: 1, projectName: project.name, tracker: "Bug", status: "Feedback" },
  { id: 1101, subject: "Write onboarding documentation", projectId: 2, projectName: project2.name, tracker: "Task", status: "New" },
];

const activities: Activity[] = [
  { id: 8, name: "Design", isDefault: false },
  { id: 9, name: "Development", isDefault: true },
  { id: 10, name: "Testing", isDefault: false },
];

const monday = startOfWeek(new Date(), 1);
let nextId = 500;
const entries: Entry[] = [
  [0, 1042, 2.5, "Reproduced the redirect loop and traced it to the session middleware."],
  [0, 1063, 1.75, "Bumped gems, fixed deprecations in the mailers"],
  [0, 1077, 0.5, ""],
  [1, 1051, 3, "Streaming CSV writer with column selection; added specs for the encoding edge cases and a very long note to prove that the line is trimmed with an ellipsis."],
  [1, 1088, 2.25, "Added index on events(account_id, created_at)"],
  [2, 1042, 4, "Fix + regression test"],
].map(([day, issueId, hours, comments]) => {
  const issue = issues.find((i) => i.id === issueId)!;
  return {
    id: nextId++,
    issueId: issue.id,
    issueSubject: issue.subject,
    projectId: issue.projectId,
    projectName: issue.projectName,
    activityId: 9,
    activityName: "Development",
    hours: hours as number,
    comments: comments as string,
    spentOn: iso(addDays(monday, day as number)),
  };
});

// Two entries on the last days of the previous month, to try the read-only rule on.
{
  const now = new Date();
  for (const [back, issueId, hours, comments] of [
    [0, 1042, 3.5, "Investigated the session timeout"],
    [1, 1063, 2, "Rails upgrade spike"],
  ] as const) {
    const issue = issues.find((i) => i.id === issueId)!;
    entries.push({
      id: nextId++,
      issueId: issue.id,
      issueSubject: issue.subject,
      projectId: issue.projectId,
      projectName: issue.projectName,
      activityId: 9,
      activityName: "Development",
      hours,
      comments,
      spentOn: iso(new Date(now.getFullYear(), now.getMonth(), -back)), // day 0 = the last day of last month
    });
  }
}

const session: SessionInfo = { url: "https://redmine.example.com", user: { id: 1, login: "alex", name: "Alex Rivera" } };

export async function mock<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await delay();
  return handle(cmd, args) as T;
}

function handle(cmd: string, args: Record<string, unknown>): unknown {
  switch (cmd) {
    case "restore_session": {
      const q = new URLSearchParams(location.search);
      if (q.has("expired")) return { url: session.url, ssoRequired: true, hasKey: true, error: "sso" } satisfies Restore;
      // `?offline`: the Mac had no connection at launch. A key is saved, so one click on Sign in retries.
      if (q.has("offline")) return { url: session.url, hasKey: true, error: `Can't connect to ${session.url} (dns error).` } satisfies Restore;
      return (q.has("login") ? { url: session.url } : { url: session.url, session, hasKey: true }) satisfies Restore;
    }
    case "login":
      // Like the backend: a blank key reuses the saved one, and there is none after `?login`.
      if (!args.apiKey && new URLSearchParams(location.search).has("login")) throw { kind: "error", message: "Enter your API key." };
      if (args.apiKey === "bad") throw { kind: "error", message: "Redmine rejected the API key. Check the key, and that the REST API is enabled (Administration → Settings → API)." };
      // A URL containing "sso" behaves like a Redmine behind Pomerium.
      if (String(args.url).includes("sso") && !args.sso) throw { kind: "sso", message: "Your company sign-in (Pomerium) is needed or has expired." };
      return args.sso ? new Promise((resolve) => setTimeout(() => resolve(session), 2500)) : session;
    case "cancel_sso":
      return null;
    case "logout":
      return null;
    case "list_time_entries":
      return entries.filter((e) => e.spentOn >= (args.from as string) && e.spentOn <= (args.to as string)).map((e) => ({ ...e }));
    case "search_issues": {
      const q = String(args.query).trim().replace(/^#/, "").toLowerCase();
      // Searching for "expired-sso" behaves like the company sign-in expiring in the middle of a session.
      if (q === "expired-sso") throw { kind: "sso", message: "Your company sign-in (Pomerium) is needed or has expired." };
      if (!q) return issues.slice(0, 4);
      return issues.filter((i) => String(i.id).includes(q) || i.subject.toLowerCase().includes(q));
    }
    case "list_activities":
      return activities;
    case "create_time_entry": {
      const input = args.input as NewEntry;
      const issue = issues.find((i) => i.id === input.issueId)!;
      const activity = activities.find((a) => a.id === input.activityId) ?? activities[1];
      const created: Entry = {
        id: nextId++,
        issueId: issue.id,
        issueSubject: issue.subject,
        projectId: issue.projectId,
        projectName: issue.projectName,
        activityId: activity.id,
        activityName: activity.name,
        hours: Math.round(input.hours * 100) / 100,
        comments: input.comments,
        spentOn: input.spentOn,
      };
      entries.push(created);
      return { ...created };
    }
    case "update_time_entry": {
      const e = entries.find((x) => x.id === args.id)!;
      if (typeof args.hours === "number") e.hours = Math.round(args.hours * 100) / 100;
      if (typeof args.comments === "string") e.comments = args.comments;
      if (typeof args.activityId === "number") {
        e.activityId = args.activityId;
        e.activityName = activities.find((a) => a.id === args.activityId)?.name ?? e.activityName;
      }
      return { ...e };
    }
    case "delete_time_entry":
      entries.splice(entries.findIndex((x) => x.id === args.id), 1);
      return null;
    case "idle_seconds":
      // Set `window.__idle = 150` in the console to pretend nobody has touched the machine for 150 s.
      return (window as unknown as { __idle?: number }).__idle ?? 0;
    case "report_bug":
      window.open("https://github.com/sabuz/redmine-desktop/issues", "_blank", "noopener");
      return null;
    case "open_profile":
      window.open(args.site === "wordpress" ? "https://profiles.wordpress.org/nazsabuz/" : "https://github.com/sabuz", "_blank", "noopener");
      return null;
    default:
      throw `Unknown command ${cmd}`;
  }
}
