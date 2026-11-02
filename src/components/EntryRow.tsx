import type { Entry } from "../api";
import { HoursInput } from "./HoursInput";

interface Props {
  entry: Entry;
  onOpen: () => void;
  onHours: (hours: number) => void;
}

export function EntryRow({ entry, onOpen, onHours }: Props) {
  const title = entry.issueSubject ?? (entry.issueId ? "(ticket not visible)" : entry.projectName);
  return (
    <li
      class="row"
      tabIndex={0}
      title={entry.projectName}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div class="row-main">
        <div class="row-title">
          {entry.issueId && <span class="id">#{entry.issueId}</span>} {title}
        </div>
        <div class="row-note">{entry.comments || <span class="faint">No notes</span>}</div>
      </div>
      <HoursInput value={entry.hours} onCommit={onHours} class="row-hours" label={`Hours for ${title}`} />
    </li>
  );
}
