import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, errMsg, type Entry, type EntryPatch, type SessionInfo } from "../api";
import { addDays, dayLong, iso, parseIso, startOfWeek, weekDays, weekRange, weekdayShort, type WeekStart } from "../dates";
import { fmt } from "../hours";
import { EntryEditor, type SaveValues } from "./EntryEditor";
import { EntryRow } from "./EntryRow";

interface Props {
  session: SessionInfo;
  weekStart: WeekStart;
  onWeekStartChange: (value: WeekStart) => void;
  onSignedOut: () => void;
}

const sum = (entries: Entry[] | undefined) => (entries ?? []).reduce((total, e) => total + e.hours, 0);

export function Timesheet({ session, weekStart, onWeekStartChange, onSignedOut }: Props) {
  const [selected, setSelected] = useState(() => iso(new Date()));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [toast, setToast] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const today = iso(new Date());
  const start = startOfWeek(parseIso(selected), weekStart);
  const days = weekDays(start);
  const from = iso(days[0]);
  const to = iso(days[6]);

  // --- loading -------------------------------------------------------------
  const request = useRef(0);
  const loadedAt = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      const id = ++request.current;
      if (!silent) setLoading(true);
      try {
        const list = await api.listEntries(from, to);
        if (id !== request.current) return; // the user already moved to another week
        setEntries(list);
        loadedAt.current = Date.now();
      } catch (e) {
        if (id === request.current) setToast(errMsg(e));
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [from, to],
  );

  useEffect(() => {
    setEditing(null);
    setEntries((es) => es.filter((e) => e.spentOn >= from && e.spentOn <= to));
    void load();
  }, [load]);

  // Pick up edits made in Redmine's web UI when the window regains focus.
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - loadedAt.current > 30_000) void load(true);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // The native "Account → Sign Out" menu item (⇧⌘O) is handled in Rust and forwarded here.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen("sign-out", () => onSignedOut()).then((off) => (disposed ? off() : (unlisten = off)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  // --- derived -------------------------------------------------------------
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const list = map.get(e.spentOn);
      if (list) list.push(e);
      else map.set(e.spentOn, [e]);
    }
    for (const list of map.values()) list.sort((a, b) => a.id - b.id);
    return map;
  }, [entries]);

  const dayEntries = byDay.get(selected) ?? [];
  const weekTotal = days.reduce((total, d) => total + sum(byDay.get(iso(d))), 0);

  // --- mutations -----------------------------------------------------------
  const replace = (updated: Entry) => setEntries((es) => es.map((e) => (e.id === updated.id ? updated : e)));

  const add = async (v: SaveValues) => {
    const created = await api.createEntry({
      issueId: v.issue.id,
      projectId: v.issue.projectId,
      spentOn: selected,
      hours: v.hours,
      comments: v.comments,
      activityId: v.activityId,
    });
    setEntries((es) => [...es, created]);
    setEditing(null);
  };

  const save = (entry: Entry) => async (v: SaveValues) => {
    const patch: EntryPatch = {};
    if (v.hours !== entry.hours) patch.hours = v.hours;
    if (v.comments !== entry.comments) patch.comments = v.comments;
    if (v.activityId !== undefined && v.activityId !== entry.activityId) patch.activityId = v.activityId;
    if (Object.keys(patch).length) replace(await api.updateEntry(entry.id, patch));
    setEditing(null);
  };

  const remove = (entry: Entry) => async () => {
    await api.deleteEntry(entry.id);
    setEntries((es) => es.filter((e) => e.id !== entry.id));
    setEditing(null);
  };

  /** Inline edit of the hours column: show the new value at once, roll back if Redmine refuses. */
  const quickHours = async (entry: Entry, hours: number) => {
    replace({ ...entry, hours });
    try {
      replace(await api.updateEntry(entry.id, { hours }));
    } catch (e) {
      replace(entry);
      setToast(errMsg(e));
    }
  };

  // --- navigation ----------------------------------------------------------
  const go = (date: string) => {
    setSelected(date);
    setEditing(null);
  };
  const shiftWeek = (weeks: number) => go(iso(addDays(parseIso(selected), weeks * 7)));

  const host = session.url.replace(/^https?:\/\//, "");

  return (
    <div class="app">
      <header class="topbar" data-tauri-drag-region>
        <div class="nav">
          <button class="icon" aria-label="Previous week" onClick={() => shiftWeek(-1)}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5" /></svg>
          </button>
          <div class="range">{weekRange(start)}</div>
          <button class="icon" aria-label="Next week" onClick={() => shiftWeek(1)}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5" /></svg>
          </button>
          <button class="ghost" onClick={() => go(today)} disabled={selected === today}>
            Today
          </button>
        </div>
        <div class="spacer" data-tauri-drag-region />
        <button class={`icon ${loading ? "spin" : ""}`} aria-label="Refresh" title="Refresh" onClick={() => load()}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" /></svg>
        </button>
        <div class="menu-wrap">
          <button
            class="account"
            aria-label="Account menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
          >
            <span class="avatar">{session.user.name.charAt(0).toUpperCase()}</span>
            <span class="account-name">{session.user.name.split(" ")[0]}</span>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4" /></svg>
          </button>
          {menuOpen && (
            <div class="menu" onClick={(e) => e.stopPropagation()}>
              <div class="menu-user">
                <b>{session.user.name}</b>
                <span class="muted">{host}</span>
              </div>
              <div class="menu-group">
                <span class="muted small-text">Week starts on</span>
                <div class="segmented">
                  <button class={weekStart === 0 ? "on" : ""} onClick={() => onWeekStartChange(0)}>Sunday</button>
                  <button class={weekStart === 1 ? "on" : ""} onClick={() => onWeekStartChange(1)}>Monday</button>
                </div>
              </div>
              <button class="menu-item" onClick={onSignedOut}>Sign out</button>
            </div>
          )}
        </div>
      </header>

      <nav class="days" role="tablist" aria-label="Days of the week">
        {days.map((d) => {
          const key = iso(d);
          const total = sum(byDay.get(key));
          const cls = ["day", key === selected && "on", !total && "empty", key === today && "today", (d.getDay() === 0 || d.getDay() === 6) && "weekend"];
          return (
            <button key={key} role="tab" aria-selected={key === selected} class={cls.filter(Boolean).join(" ")} onClick={() => go(key)}>
              <span class="dow">{weekdayShort(d)}</span>
              <span class="sum">{total ? fmt(total) : "–"}</span>
            </button>
          );
        })}
        <div class="week-total" title="Total for the week">
          <span class="dow">Week</span>
          <b class="sum">{fmt(weekTotal)}</b>
        </div>
      </nav>

      <main class="day-panel" role="tabpanel">
        <div class="day-head">
          <div>
            <h2>{dayLong(parseIso(selected))}</h2>
            <div class="day-total">
              <b>{fmt(sum(dayEntries))}</b> hours
            </div>
          </div>
          <button class="add" aria-label="Add time entry" title="Add time entry" onClick={() => setEditing("new")} disabled={editing === "new"}>
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10" /></svg>
          </button>
        </div>

        {editing === "new" && <EntryEditor onSave={add} onCancel={() => setEditing(null)} />}

        <ul class="entries">
          {dayEntries.map((entry) =>
            editing === entry.id ? (
              <li key={entry.id} class="editing">
                <EntryEditor entry={entry} onSave={save(entry)} onCancel={() => setEditing(null)} onDelete={remove(entry)} />
              </li>
            ) : (
              <EntryRow key={entry.id} entry={entry} onOpen={() => setEditing(entry.id)} onHours={(h) => quickHours(entry, h)} />
            ),
          )}
        </ul>

        {dayEntries.length === 0 && editing !== "new" && (
          <div class="empty-state">{loading ? "Loading…" : "No time logged for this day. Press + to add an entry."}</div>
        )}
      </main>

      {toast && (
        <div class="toast" role="alert" onClick={() => setToast("")}>
          {toast}
        </div>
      )}
    </div>
  );
}
