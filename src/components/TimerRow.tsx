import { useEffect, useState } from "preact/hooks";
import { dayLong, iso, monthDay, parseIso } from "../dates";
import { elapsedMs, formatClock, isRunning, type TimerState } from "../timer";

/** A clock face that re-renders every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const timeOfDay = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function pausedText(t: TimerState): string {
  const p = t.paused;
  if (!p) return "";
  const at = timeOfDay(p.at);
  switch (p.reason) {
    case "idle":
      return `Paused: no keyboard or mouse activity since ${at}`;
    case "asleep":
      return `Paused: your Mac was asleep after ${at}`;
    case "closed":
      return `Paused: the app was closed at ${at}`;
    default:
      return `Paused at ${at}`;
  }
}

/** The running timer in the header, visible whichever day is open. */
export function TimerPill({ timer, onClick }: { timer: TimerState; onClick: () => void }) {
  const running = isRunning(timer);
  const now = useNow(running);
  // A timer logging to another day says so: that is the easy thing to forget.
  const elsewhere = timer.date !== iso(new Date(now));
  const day = dayLong(parseIso(timer.date));
  return (
    <button
      class={`pill ${running ? "running" : "paused"}`}
      onClick={onClick}
      title={`${running ? "Running" : "Paused"}: #${timer.issue.id} ${timer.issue.subject}${elsewhere ? `, logging to ${day}` : ""}`}
    >
      <span class="live-dot" aria-hidden="true" />
      <span class="pill-clock">{formatClock(elapsedMs(timer, now))}</span>
      <span class="pill-id">#{timer.issue.id}</span>
      {elsewhere && <span class="pill-day">{monthDay(parseIso(timer.date))}</span>}
    </button>
  );
}

interface RowProps {
  timer: TimerState;
  /** Stop is saving to Redmine. */
  busy: boolean;
  /** A timer can only be resumed on the day it was started. */
  canResume: boolean;
  onPause: () => void;
  onResume: () => void;
  onNotes: (notes: string) => void;
  /** Right-click (or the keyboard's context-menu key): Stop and Discard are in that menu. */
  onMenu: (x: number, y: number) => void;
}

/**
 * The timer as the first line of its day, in the same shape as an entry: the ticket, the time, and
 * one button at the end (pause, or resume). Stopping and discarding are in the right-click menu,
 * as they are for an entry.
 */
export function TimerRow({ timer, busy, canResume, onPause, onResume, onNotes, onMenu }: RowProps) {
  const running = isRunning(timer);
  const now = useNow(running);
  const hint = "Right-click to stop and log, or discard";

  return (
    <li
      class={`row timer-row ${running ? "running" : "paused"}`}
      tabIndex={0}
      onContextMenu={(e) => {
        // The notes box keeps the system's text menu (Copy, Paste…).
        if ((e.target as Element).closest("input")) return;
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        onMenu(e.clientX || box.left + 24, e.clientY || box.bottom);
      }}
    >
      <div class="row-main">
        <div class="row-title">
          <span class="live-dot" aria-hidden="true" /> <span class="id">#{timer.issue.id}</span> {timer.issue.subject}
        </div>
        <input
          class="timer-notes"
          type="text"
          maxLength={1024}
          placeholder="Notes (optional)"
          aria-label="Notes for the timer"
          value={timer.notes}
          onInput={(e) => onNotes(e.currentTarget.value)}
        />
        <div class="timer-status">
          {busy ? "Saving to Redmine…" : running ? hint : `${pausedText(timer)} · ${hint}`}
        </div>
        {!canResume && <div class="timer-status">Its day is in a previous month now. Right-click it and stop it to log the time counted so far.</div>}
      </div>

      <div class="timer-clock" aria-live="off">
        {formatClock(elapsedMs(timer, now))}
      </div>

      {running ? (
        <button class="toggle" aria-label="Pause" title="Pause" onClick={onPause} disabled={busy}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>
        </button>
      ) : canResume ? (
        <button class="toggle play" aria-label="Resume" title="Resume" onClick={onResume} disabled={busy}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4 2.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L4.9 2.1a.6.6 0 0 0-.9.5Z" /></svg>
        </button>
      ) : (
        <span class="toggle-slot" aria-hidden="true" />
      )}
    </li>
  );
}
