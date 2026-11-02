import { useEffect, useRef, useState } from "preact/hooks";
import { api, errMsg, type IssueHit } from "../api";

interface Props {
  onPick: (issue: IssueHit) => void;
}

/** Search tickets by number or title. With nothing typed it suggests the
 *  user's open assigned tickets. */
export function IssuePicker({ onPick }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<IssueHit[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const latest = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const id = ++latest.current;
    setBusy(true);
    const timer = setTimeout(
      async () => {
        try {
          const found = await api.searchIssues(query);
          if (id !== latest.current) return; // a newer search superseded this one
          setHits(found);
          setActive(0);
          setError("");
        } catch (e) {
          if (id === latest.current) setError(errMsg(e));
        } finally {
          if (id === latest.current) setBusy(false);
        }
      },
      query ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[active]) onPick(hits[active]);
    }
  };

  return (
    <div class="picker">
      <input
        class="picker-input"
        type="text"
        ref={input}
        value={query}
        placeholder="Search by ticket number or title…"
        autocapitalize="off"
        spellcheck={false}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <div class="picker-status error-text">{error}</div>
      ) : (
        <>
          {!query && !busy && hits.length > 0 && <div class="picker-status">Assigned to you</div>}
          <ul class="picker-list" ref={list} role="listbox">
            {hits.map((h, i) => (
              <li
                key={h.id}
                role="option"
                aria-selected={i === active}
                class={i === active ? "active" : ""}
                onMouseMove={() => setActive(i)}
                onClick={() => onPick(h)}
              >
                <div class="picker-title">
                  <span class="id">#{h.id}</span> {h.subject}
                </div>
                <div class="picker-meta">
                  {h.projectName} · {h.tracker} · {h.status}
                </div>
              </li>
            ))}
          </ul>
          {busy && <div class="picker-status">Searching…</div>}
          {!busy && hits.length === 0 && <div class="picker-status">{query ? "No tickets found." : "Type a ticket number or title."}</div>}
        </>
      )}
    </div>
  );
}
