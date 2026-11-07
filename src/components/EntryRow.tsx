import type { Entry } from "../api";
import { fmt } from "../hours";

interface Props {
  entry: Entry;
  /** Right-click (or the keyboard's context-menu key): show the row's menu here. */
  onMenu: (x: number, y: number) => void;
  /** Enter on the focused row. A click does nothing; editing starts from the menu. */
  onEdit: () => void;
  /** This row's menu is open. */
  menuOpen?: boolean;
  /** Present when the timer can be started for this entry. */
  onPlay?: () => void;
  /** Keep room for the start button at the end of the row even without one, so the hours line up. */
  playSlot?: boolean;
  /** Read-only (an earlier month): no menu, no editing. */
  locked?: boolean;
  /** Stretches the timer has logged to this entry, as [start, end] epoch ms. */
  timed?: [number, number][];
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function timedText(sessions: [number, number][]): string {
  const shown = sessions.slice(-4).map(([a, b]) => `${clock(a)}–${clock(b)}`);
  const more = sessions.length - shown.length;
  return `Timed: ${more > 0 ? `+${more} earlier, ` : ""}${shown.join(", ")}`;
}

export function EntryRow({ entry, onMenu, onEdit, menuOpen, onPlay, playSlot, locked, timed }: Props) {
  const title = entry.issueSubject ?? (entry.issueId ? "(ticket not visible)" : entry.projectName);
  return (
    <li
      class={`row${menuOpen ? " menu-open" : ""}${locked ? " locked" : ""}`}
      tabIndex={locked ? undefined : 0}
      title={locked ? `${entry.projectName} · read-only` : entry.projectName}
      onContextMenu={(e) => {
        e.preventDefault();
        if (locked) return;
        const box = e.currentTarget.getBoundingClientRect();
        // The keyboard's context-menu key reports no pointer position.
        onMenu(e.clientX || box.left + 24, e.clientY || box.bottom);
      }}
      onKeyDown={(e) => {
        if (!locked && e.target === e.currentTarget && e.key === "Enter") {
          e.preventDefault();
          onEdit();
        }
      }}
    >
      <div class="row-main">
        <div class="row-title">
          {entry.issueId && <span class="id">#{entry.issueId}</span>} {title}
          {timed && (
            <span class="timed" title={timedText(timed)} aria-label={timedText(timed)}>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.2 1.4" /></svg>
            </span>
          )}
        </div>
        <div class="row-note">{entry.comments || <span class="faint">No notes</span>}</div>
      </div>
      <div class="row-hours" aria-label={`${fmt(entry.hours)} hours`}>
        {fmt(entry.hours)}
      </div>
      {onPlay ? (
        <button class="toggle play" aria-label={`Start timer for ${title}`} title="Start timer" onClick={onPlay}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4 2.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L4.9 2.1a.6.6 0 0 0-.9.5Z" /></svg>
        </button>
      ) : (
        playSlot && <span class="toggle-slot" aria-hidden="true" />
      )}
    </li>
  );
}
