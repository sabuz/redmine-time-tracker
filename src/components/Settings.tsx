import { useEffect, useRef, useState } from "preact/hooks";
import { api, type User } from "../api";
import { AUTOLOG_CHOICES, MIN_SESSION_CHOICES, THEMES, type Prefs, type Theme } from "../settings";

interface Props {
  prefs: Prefs;
  onChange: (patch: Partial<Prefs>) => void;
  user: User;
  /** The Redmine address without https://. */
  host: string;
  onSignOut: () => void;
  onClose: () => void;
}

const minutes = (n: number) => (n === 1 ? "1 minute" : `${n} minutes`);

const THEME_LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

const INCREMENT_LABEL: Record<number, string> = { 0: "None (exact)", 0.25: "15 min (0.25 h)" };

const logAfterLabel = (n: number) => (n === 0 ? "After the timer is stopped" : n === 60 ? "1 hour" : `${n / 60} hours`);

export function Settings({ prefs, onChange, user, host, onSignOut, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    dialog.current?.focus();
    api.version().then(setVersion).catch(() => {});
  }, []);

  return (
    <div class="scrim" onClick={onClose}>
      <div
        ref={dialog}
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div class="dialog-head">
          <h2>Settings</h2>
          <button class="icon" aria-label="Close settings" onClick={onClose}>✕</button>
        </div>

        <section class="setting account-setting">
          <span class="avatar" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span>
          <div class="setting-text">
            <b>{user.name}</b>
            <span class="muted small-text">{host}</span>
          </div>
          <button class="outline" onClick={onSignOut}>Sign out</button>
        </section>

        <section class="setting">
          <div class="setting-text">
            <b>Appearance</b>
            <span class="muted small-text">System follows your Mac.</span>
          </div>
          <div class="segmented three" role="group" aria-label="Appearance">
            {THEMES.map((t) => (
              <button key={t} class={prefs.theme === t ? "on" : ""} aria-pressed={prefs.theme === t} onClick={() => onChange({ theme: t })}>
                {THEME_LABEL[t]}
              </button>
            ))}
          </div>
        </section>

        <section class="setting">
          <div class="setting-text">
            <b>Time increments</b>
            <span class="muted small-text">
              {prefs.increment > 0
                ? "Your Redmine only accepts fixed steps, so this was set for you. You can go back to none; it is set again if Redmine refuses a time."
                : "Exact time. If your Redmine only accepts fixed steps, this is set for you the first time it refuses a time."}
            </span>
          </div>
          {/* A step is only ever set by the app, never picked: with none set there is nothing else to choose. */}
          <select
            class="choice"
            aria-label="Time increments"
            disabled={prefs.increment === 0}
            value={prefs.increment}
            onChange={(e) => onChange({ increment: Number(e.currentTarget.value) })}
          >
            <option value={0}>{INCREMENT_LABEL[0]}</option>
            {prefs.increment > 0 && (
              <option value={prefs.increment} disabled>
                {INCREMENT_LABEL[prefs.increment] ?? `${prefs.increment} h`}
              </option>
            )}
          </select>
        </section>

        <section class="setting">
          <div class="setting-text">
            <b>Week starts on</b>
          </div>
          <div class="segmented">
            <button class={prefs.weekStart === 0 ? "on" : ""} onClick={() => onChange({ weekStart: 0 })}>Sunday</button>
            <button class={prefs.weekStart === 1 ? "on" : ""} onClick={() => onChange({ weekStart: 1 })}>Monday</button>
          </div>
        </section>

        <section class="setting">
          <div class="setting-text">
            <b>Timer</b>
            <span class="muted small-text">
              Start buttons on entries and in the add form. Time is rounded up to your step when the timer stops.
            </span>
          </div>
          <button
            class={`switch ${prefs.timerEnabled ? "on" : ""}`}
            role="switch"
            aria-checked={prefs.timerEnabled}
            aria-label="Enable the timer"
            onClick={() => onChange({ timerEnabled: !prefs.timerEnabled })}
          >
            <span class="knob" />
          </button>
        </section>

        {prefs.timerEnabled && (
          <>
            <section class="setting sub">
              <div class="setting-text">
                <b>Log a paused timer after</b>
                <span class="muted small-text">So a forgotten timer isn't lost. Pause or stop it yourself when you step away.</span>
              </div>
              <select
                class="choice"
                aria-label="Log a paused timer after"
                value={prefs.logPausedAfter}
                onChange={(e) => onChange({ logPausedAfter: Number(e.currentTarget.value) })}
              >
                {AUTOLOG_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {logAfterLabel(n)}
                  </option>
                ))}
              </select>
            </section>

            <section class="setting sub">
              <div class="setting-text">
                <b>Ignore timers shorter than</b>
                <span class="muted small-text">Shorter timers are dropped, not logged.</span>
              </div>
              <select
                class="choice"
                aria-label="Ignore timers shorter than"
                value={prefs.minSessionMinutes}
                onChange={(e) => onChange({ minSessionMinutes: Number(e.currentTarget.value) })}
              >
                {MIN_SESSION_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Keep everything" : minutes(n)}
                  </option>
                ))}
              </select>
            </section>
          </>
        )}

        <div class="dialog-foot">
          <span class="version muted small-text">{version && `Version ${version}`}</span>
          <button class="primary" onClick={onClose}>Save</button>
        </div>
      </div>
    </div>
  );
}
