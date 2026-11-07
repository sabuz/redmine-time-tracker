import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { chooseActivity } from "../activity";
import { api, errMsg, type Activity, type Entry, type IssueHit } from "../api";
import { clamp, snap, stepHint, stepOf } from "../hours";
import { HoursInput } from "./HoursInput";
import { IssuePicker } from "./IssuePicker";

export interface SaveValues {
  issue: IssueHit;
  hours: number;
  comments: string;
  activityId?: number;
}

interface Props {
  /** Present when editing an existing entry; absent when creating one. */
  entry?: Entry;
  onSave: (values: SaveValues) => Promise<void>;
  onCancel: () => void;
  /** Asks to delete this entry. The caller shows the confirmation. */
  onDelete?: () => void;
  /** The step time is logged in, in hours; 0 for none (Settings → Time increments). */
  increment: number;
  /** Offered when adding an entry on a day the timer can run: with no hours set, the main button starts timing the ticket. */
  onStartTimer?: (values: SaveValues) => Promise<void>;
}

function issueOf(entry: Entry): IssueHit {
  return {
    id: entry.issueId ?? 0,
    subject: entry.issueSubject ?? entry.projectName,
    projectId: entry.projectId,
    projectName: entry.projectName,
    tracker: "",
    status: "",
  };
}

export function EntryEditor({ entry, onSave, onCancel, onDelete, onStartTimer, increment }: Props) {
  const [issue, setIssue] = useState<IssueHit | null>(entry ? issueOf(entry) : null);
  const [comments, setComments] = useState(entry?.comments ?? "");
  const [hours, setHours] = useState(entry?.hours ?? 0);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityId, setActivityId] = useState<number | undefined>(entry?.activityId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notes = useRef<HTMLTextAreaElement>(null);

  const projectId = issue?.projectId;
  useEffect(() => {
    if (!issue) return;
    let stale = false;
    api
      .activities(projectId)
      .then((list) => {
        if (stale) return;
        setActivities(list);
        setActivityId((current) => chooseActivity(list, current, entry?.activityId));
      })
      .catch(() => {}); // the dropdown is optional; Redmine applies its default
    return () => {
      stale = true;
    };
  }, [issue?.id, projectId]);

  // Layout effect: focus lands before the next keystroke can be dropped on the
  // picker input that just unmounted.
  useLayoutEffect(() => {
    if (issue && !entry) notes.current?.focus();
  }, [issue?.id]);

  const canSave = !!issue && hours > 0 && !busy;

  const submit = async () => {
    if (!canSave || !issue) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ issue, hours, comments: comments.trim(), activityId });
    } catch (e) {
      setError(stepHint(errMsg(e), hours, increment));
      setBusy(false);
    }
  };

  const startTimer = async () => {
    if (!issue || !onStartTimer || busy) return;
    setBusy(true);
    setError("");
    try {
      await onStartTimer({ issue, hours, comments: comments.trim(), activityId });
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  // A new entry with no hours has nothing to add, so the main button tracks time instead.
  const tracking = !entry && !!onStartTimer && hours <= 0;
  const primary = () => (tracking ? startTimer() : submit());

  const bump = (dir: 1 | -1) => setHours((h) => snap(clamp(h + dir * stepOf(increment)), increment));

  // Show the entry's current activity even if Redmine no longer lists it as active.
  const options =
    entry?.activityId && !activities.some((a) => a.id === entry.activityId)
      ? [{ id: entry.activityId, name: entry.activityName, isDefault: false }, ...activities]
      : activities;

  return (
    <div
      class="editor"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void primary();
      }}
    >
      {issue ? (
        <div class="chip">
          <div class="chip-text">
            {issue.id > 0 && <span class="id">#{issue.id}</span>} {issue.subject}
            <span class="chip-project"> · {issue.projectName}</span>
          </div>
          {!entry && (
            <button class="icon small" type="button" aria-label="Choose a different ticket" onClick={() => setIssue(null)}>
              ✕
            </button>
          )}
        </div>
      ) : (
        <IssuePicker onPick={setIssue} />
      )}

      {issue && (
        <>
          <textarea
            ref={notes}
            class="notes"
            rows={2}
            maxLength={1024}
            placeholder="Notes (optional)"
            value={comments}
            onInput={(e) => setComments(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                void primary();
              }
            }}
          />

          <div class="editor-row">
            <div class="stepper">
              <button type="button" class="icon" aria-label="Subtract one step" onClick={() => bump(-1)} disabled={hours <= 0}>
                −
              </button>
              <HoursInput value={hours} onCommit={setHours} onLive={(h) => setHours(h ?? 0)} increment={increment} class="hours-field" />
              <button type="button" class="icon" aria-label="Add one step" onClick={() => bump(1)}>
                +
              </button>
            </div>

            {options.length > 0 && (
              <select
                class="activity"
                aria-label="Activity"
                value={activityId}
                onChange={(e) => setActivityId(Number(e.currentTarget.value))}
              >
                {options.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}

            <div class="spacer" />

            {onDelete && (
              <button type="button" class="ghost danger-text" onClick={onDelete} disabled={busy}>
                Delete
              </button>
            )}
            <button type="button" class="ghost" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" class="primary with-icon" onClick={primary} disabled={tracking ? busy : !canSave}>
              {tracking && (
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M4 2.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L4.9 2.1a.6.6 0 0 0-.9.5Z" /></svg>
              )}
              {entry ? "Save" : tracking ? "Start tracking" : "Add time"}
            </button>
          </div>
        </>
      )}

      {!issue && (
        <div class="editor-row">
          <div class="spacer" />
          <button type="button" class="ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
      {error && <div class="error" role="alert">{error}</div>}
    </div>
  );
}
