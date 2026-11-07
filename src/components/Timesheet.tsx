import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, errMsg, type Entry, type EntryPatch, type SessionInfo } from "../api";
import { addDays, canChangeOn, canLogOn, dayLong, iso, loggableRange, parseIso, startOfWeek, weekDays, weekdayShort } from "../dates";
import { useTauriEvent } from "../events";
import { fmt } from "../hours";
import type { Prefs } from "../settings";
import { canTrackOn, elapsedMs, formatClock } from "../timer";
import { useTimer } from "../useTimer";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { EntryEditor, type SaveValues } from "./EntryEditor";
import { EntryRow } from "./EntryRow";
import { Settings } from "./Settings";
import { TimerPill, TimerRow } from "./TimerRow";

interface Props {
  session: SessionInfo;
  prefs: Prefs;
  onPrefsChange: (patch: Partial<Prefs>) => void;
  onSignedOut: () => void;
}

const sum = (entries: Entry[] | undefined) => (entries ?? []).reduce((total, e) => total + e.hours, 0);

export function Timesheet({ session, prefs, onPrefsChange, onSignedOut }: Props) {
  const weekStart = prefs.weekStart;
  const [selected, setSelected] = useState(() => iso(new Date()));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  // What the confirmation dialog is asking about, if open.
  const [confirm, setConfirm] = useState<{ kind: "entry"; entry: Entry } | { kind: "timer" } | null>(null);
  // The right-click menu of an entry, where it was asked for.
  const [rowMenu, setRowMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  // The right-click menu of the running timer (Stop and log, Discard).
  const [timerMenu, setTimerMenu] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The app can stay open for days. "Today" moves on with the calendar (checked each minute and when the window
  // gets focus), and a view that was on the old today follows it, so the morning shows the new day.
  const [today, setToday] = useState(() => iso(new Date()));
  const todayRef = useRef(today);
  useEffect(() => {
    const sync = () => {
      const now = iso(new Date());
      const before = todayRef.current;
      if (now === before) return;
      todayRef.current = now;
      setToday(now);
      setSelected((s) => (s === before ? now : s));
    };
    const id = setInterval(sync, 60_000);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", sync);
    };
  }, []);

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

  // --- timer ---------------------------------------------------------------
  const timer = useTimer({
    url: session.url,
    enabled: prefs.timerEnabled,
    idleMinutes: prefs.idleMinutes,
    minSessionMinutes: prefs.minSessionMinutes,
    increment: prefs.increment,
    autoLogMinutes: prefs.autoLogMinutes,
    notify: setToast,
    onLogged: () => void load(true),
  });

  // A running timer is paused and saved before leaving, so it is still there at the next sign-in.
  const signOut = async () => {
    timer.pause();
    await timer.flush();
    onSignedOut();
  };

  // A dialog or menu about the timer must not outlive it (it logged itself while the menu was open, say), or the
  // next timer would find it open.
  useEffect(() => {
    if (confirm?.kind === "timer" && !timer.timer) setConfirm(null);
    if (!timer.timer) setTimerMenu(null);
  }, [confirm, timer.timer]);

  // The native "Account" menu items (Settings… ⌘, and Sign Out ⇧⌘O) are handled in Rust and forwarded here.
  useTauriEvent("sign-out", () => void signOut());
  useTauriEvent("open-settings", () => setSettingsOpen(true));

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
  const liveHere = timer.timer?.date === selected;
  const weekTotal = days.reduce((total, d) => total + sum(byDay.get(iso(d))), 0);

  // --- mutations -----------------------------------------------------------
  const replace = (updated: Entry) => setEntries((es) => es.map((e) => (e.id === updated.id ? updated : e)));

  // New time goes on this month's days up to the end of this week; earlier months and later weeks are closed.
  const canAdd = canLogOn(selected, today, weekStart);
  const closedWhy = canAdd
    ? ""
    : selected < loggableRange(today, weekStart).from
      ? "Previous months are read-only"
      : "Time can't be added to upcoming weeks";
  // Entries of previous months can't be edited or deleted either.
  const canChange = canChangeOn(selected, today);
  const lockedWhy = "Previous months are read-only";

  const add = async (v: SaveValues) => {
    if (!canAdd) throw `${closedWhy}.`;
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
    if (!canChange) throw `${lockedWhy}.`;
    const patch: EntryPatch = {};
    if (v.hours !== entry.hours) patch.hours = v.hours;
    if (v.comments !== entry.comments) patch.comments = v.comments;
    if (v.activityId !== undefined && v.activityId !== entry.activityId) patch.activityId = v.activityId;
    if (Object.keys(patch).length) replace(await api.updateEntry(entry.id, patch));
    setEditing(null);
  };

  const remove = (entry: Entry) => async () => {
    if (!canChange) throw `${lockedWhy}.`;
    await api.deleteEntry(entry.id);
    setEntries((es) => es.filter((e) => e.id !== entry.id));
    setEditing(null);
  };

  // A timer logs to the day that is open: today, or an earlier day of this month.
  const canTime = prefs.timerEnabled && canTrackOn(selected, today);
  const timedIssueId = timer.timer?.issue.id;

  const playEntry = (entry: Entry) => {
    if (!entry.issueId) return;
    void timer.start(
      {
        id: entry.issueId,
        subject: entry.issueSubject ?? `#${entry.issueId}`,
        projectId: entry.projectId,
        projectName: entry.projectName,
      },
      { activityId: entry.activityId, date: selected },
    );
  };

  const startFromEditor = async (v: SaveValues) => {
    const started = await timer.start(
      { id: v.issue.id, subject: v.issue.subject, projectId: v.issue.projectId, projectName: v.issue.projectName },
      { activityId: v.activityId, notes: v.comments, date: selected },
    );
    if (!started) throw "The timer that is running couldn't be logged first. See the message below, then try again.";
    setEditing(null);
  };

  const openEditor = (id: number) => {
    if (!canChange) return;
    setEditing(id);
  };

  /** What right-clicking an entry offers. Entries are only edited from here (or Enter on a focused row). */
  const menuItems = (entry: Entry): MenuItem[] => [
    { label: "Edit", onSelect: () => openEditor(entry.id) },
    ...(canTime && entry.issueId && entry.issueId !== timedIssueId
      ? [{ label: "Start timer", onSelect: () => playEntry(entry) }]
      : []),
    { label: "Delete…", danger: true, onSelect: () => canChange && setConfirm({ kind: "entry", entry }) },
  ];
  const menuEntry = rowMenu ? dayEntries.find((e) => e.id === rowMenu.id) : undefined;

  /** What right-clicking the running timer offers: the two ways to end it. */
  const timerMenuItems = (): MenuItem[] => [
    { label: "Stop and log to Redmine", onSelect: () => void timer.stop() },
    { label: "Discard timer…", danger: true, onSelect: () => setConfirm({ kind: "timer" }) },
  ];

  // --- navigation ----------------------------------------------------------
  const go = (date: string) => {
    setSelected(date);
    setEditing(null);
  };
  const shiftWeek = (weeks: number) => go(iso(addDays(parseIso(selected), weeks * 7)));

  // The title is the day you are looking at; its year only shows when it isn't this year.
  const title = dayLong(parseIso(selected)) + (selected.slice(0, 4) === today.slice(0, 4) ? "" : `, ${selected.slice(0, 4)}`);

  return (
    <div class="app">
      <header class="topbar" data-tauri-drag-region>
        {/* The date doubles as the way back to today. */}
        <button class="today-title" title="Go to today" onClick={() => go(today)}>
          {title}
        </button>
      </header>

      {/* ‹ the days › week total: the arrows flank the week they move. */}
      <div class="weekbar">
        <button class="icon step" aria-label="Previous week" title="Previous week" onClick={() => shiftWeek(-1)}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5" /></svg>
        </button>
        <nav class="days" role="tablist" aria-label="Days of the week">
          {days.map((d) => {
            const key = iso(d);
            const total = sum(byDay.get(key));
            const cls = ["day", key === selected && "on", !total && "empty", key === today && "today", (d.getDay() === 0 || d.getDay() === 6) && "weekend"];
            return (
              <button
                key={key}
                role="tab"
                aria-selected={key === selected}
                aria-label={dayLong(d)}
                class={cls.filter(Boolean).join(" ")}
                onClick={() => go(key)}
              >
                <span class="dow">{weekdayShort(d)}</span>
                <span class="num">{d.getDate()}</span>
                <span class="hrs">{total ? fmt(total) : "–"}</span>
              </button>
            );
          })}
        </nav>
        <button class="icon step" aria-label="Next week" title="Next week" onClick={() => shiftWeek(1)}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5" /></svg>
        </button>
        <div class="week-total" title="Total for the week">
          <span class="dow">Week</span>
          <b class="num">{fmt(weekTotal)}</b>
          <span class="hrs">hours</span>
        </div>
      </div>

      <main class="day-panel" role="tabpanel">
        {!canAdd && (
          <div class="day-note">
            {canChange ? closedWhy : `${lockedWhy}: nothing can be added, edited or deleted here`}
          </div>
        )}

        {editing === "new" && canAdd && (
          <EntryEditor onSave={add} onCancel={() => setEditing(null)} onStartTimer={canTime ? startFromEditor : undefined} increment={prefs.increment} />
        )}

        <ul class="entries">
          {liveHere && timer.timer && (
            <TimerRow
              timer={timer.timer}
              busy={timer.busy}
              canResume={canTrackOn(timer.timer.date, today)}
              onPause={timer.pause}
              onResume={timer.resume}
              onNotes={timer.setNotes}
              onMenu={(x, y) => {
                setRowMenu(null);
                setTimerMenu({ x, y });
              }}
            />
          )}
          {dayEntries.map((entry) =>
            editing === entry.id ? (
              <li key={entry.id} class="editing">
                <EntryEditor
                  entry={entry}
                  increment={prefs.increment}
                  onSave={save(entry)}
                  onCancel={() => setEditing(null)}
                  onDelete={() => setConfirm({ kind: "entry", entry })}
                />
              </li>
            ) : (
              <EntryRow
                key={entry.id}
                entry={entry}
                menuOpen={rowMenu?.id === entry.id}
                onMenu={(x, y) => {
                  setTimerMenu(null);
                  setRowMenu({ id: entry.id, x, y });
                }}
                onEdit={() => openEditor(entry.id)}
                locked={!canChange}
                onPlay={canTime && entry.issueId && entry.issueId !== timedIssueId ? () => playEntry(entry) : undefined}
                playSlot={canTime}
                timed={timer.sessionsByEntry.get(entry.id)}
              />
            ),
          )}
        </ul>

        {dayEntries.length === 0 && !liveHere && editing !== "new" && (
          <div class="empty-state">
            {loading
              ? "Loading…"
              : !canAdd
                ? "No time logged for this day."
                : `No time logged for this day. Press + to ${canTime ? "add time or start tracking" : "add an entry"}.`}
          </div>
        )}
      </main>

      <footer class="footer">
        <button
          class="add"
          aria-label="Add time entry"
          title={!canAdd ? closedWhy : canTime ? "Add time or start tracking" : "Add time entry"}
          onClick={() => setEditing("new")}
          disabled={editing === "new" || !canAdd}
        >
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10" /></svg>
        </button>
        <button class={`tool ${loading ? "spin" : ""}`} aria-label="Refresh" title="Refresh" onClick={() => load()}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" /></svg>
        </button>
        {timer.timer && <TimerPill timer={timer.timer} onClick={() => go(timer.timer!.date)} />}
        <div class="spacer" />
        <button
          class="tool labelled"
          title="Open this project's issues on GitHub"
          onClick={() => api.reportBug().catch((e) => setToast(errMsg(e)))}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 5.5a2.5 2.5 0 0 1 5 0M4.5 7.5h7v2.2a3.5 3.5 0 0 1-7 0V7.5ZM8 7.5v5.7M4.5 9H2.3M11.5 9h2.2M4.8 5.2 3 4M11.2 5.2 13 4M5 12.2 3.3 13.5M11 12.2l1.7 1.3" /></svg>
          Report a bug
        </button>
        <button class="tool" aria-label="Settings" title="Settings (⌘,)" onClick={() => setSettingsOpen(true)}>
          {/* A cog (the Feather "settings" glyph, MIT). The earlier sun-with-rays read as a theme switch. */}
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
      </footer>

      {rowMenu && menuEntry && (
        <ContextMenu x={rowMenu.x} y={rowMenu.y} items={menuItems(menuEntry)} onClose={() => setRowMenu(null)} />
      )}
      {timerMenu && timer.timer && (
        <ContextMenu x={timerMenu.x} y={timerMenu.y} items={timerMenuItems()} onClose={() => setTimerMenu(null)} />
      )}

      {confirm?.kind === "entry" && (
        <ConfirmDialog
          title="Delete this entry?"
          confirmLabel="Delete"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await remove(confirm.entry)();
            setConfirm(null);
          }}
        >
          <b>
            {confirm.entry.issueId ? `#${confirm.entry.issueId} ` : ""}
            {confirm.entry.issueSubject ?? confirm.entry.projectName}
          </b>
          <br />
          {fmt(confirm.entry.hours)} hours on {dayLong(parseIso(confirm.entry.spentOn))}. This also removes it from Redmine and can't be undone.
        </ConfirmDialog>
      )}
      {confirm?.kind === "timer" && timer.timer && (
        <ConfirmDialog
          title="Discard this timer?"
          confirmLabel="Discard"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            timer.discard();
            setConfirm(null);
          }}
        >
          <b>
            #{timer.timer.issue.id} {timer.timer.issue.subject}
          </b>
          <br />
          The {formatClock(elapsedMs(timer.timer, Date.now()))} counted so far won't be logged to Redmine.
        </ConfirmDialog>
      )}

      {settingsOpen && (
        <Settings
          prefs={prefs}
          onChange={onPrefsChange}
          user={session.user}
          host={session.url.replace(/^https?:\/\//, "")}
          onSignOut={() => void signOut()}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {toast && (
        <div class="toast" role="alert" onClick={() => setToast("")}>
          {toast}
        </div>
      )}
    </div>
  );
}
