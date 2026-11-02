import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { api, errMsg, type Activity, type Entry, type IssueHit } from "../api";
import { STEP, clamp, snap } from "../hours";
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
  onDelete?: () => Promise<void>;
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

export function EntryEditor({ entry, onSave, onCancel, onDelete }: Props) {
  const [issue, setIssue] = useState<IssueHit | null>(entry ? issueOf(entry) : null);
  const [comments, setComments] = useState(entry?.comments ?? "");
  const [hours, setHours] = useState(entry?.hours ?? 0);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityId, setActivityId] = useState<number | undefined>(entry?.activityId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
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
        setActivityId((current) => current ?? list.find((a) => a.isDefault)?.id ?? list[0]?.id);
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
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!onDelete) return;
    setBusy(true);
    try {
      await onDelete();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const bump = (dir: 1 | -1) => setHours((h) => snap(clamp(h + dir * STEP)));

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
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
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
                void submit();
              }
            }}
          />

          <div class="editor-row">
            <div class="stepper">
              <button type="button" class="icon" aria-label="Subtract 15 minutes" onClick={() => bump(-1)} disabled={hours <= 0}>
                −
              </button>
              <HoursInput value={hours} onCommit={setHours} onLive={(h) => setHours(h ?? 0)} class="hours-field" />
              <button type="button" class="icon" aria-label="Add 15 minutes" onClick={() => bump(1)}>
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

            {onDelete &&
              (confirmDelete ? (
                <>
                  <span class="muted small-text">Delete this entry?</span>
                  <button type="button" class="danger" onClick={remove} disabled={busy}>
                    Delete
                  </button>
                  <button type="button" class="ghost" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" class="ghost danger-text" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Delete
                </button>
              ))}
            {!confirmDelete && (
              <>
                <button type="button" class="ghost" onClick={onCancel}>
                  Cancel
                </button>
                <button type="button" class="primary" onClick={submit} disabled={!canSave}>
                  {entry ? "Save" : "Add entry"}
                </button>
              </>
            )}
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
