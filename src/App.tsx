import { useEffect, useState } from "preact/hooks";
import { api, errMsg, onSsoRequired, type SessionInfo } from "./api";
import { Login } from "./components/Login";
import { Timesheet } from "./components/Timesheet";
import type { WeekStart } from "./dates";
import { loadWeekStart, saveWeekStart } from "./settings";

type Boot =
  | { state: "loading" }
  | { state: "login"; url?: string; error?: string; sso?: boolean }
  | { state: "ready"; session: SessionInfo };

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [weekStart, setWeekStart] = useState<WeekStart>(0);

  useEffect(() => {
    // Preferences load alongside the session so the first paint already has the right week.
    Promise.all([api.restore(), loadWeekStart()])
      .then(([r, week]) => {
        setWeekStart(week);
        setBoot(r.session ? { state: "ready", session: r.session } : { state: "login", url: r.url, error: r.error, sso: r.ssoRequired });
      })
      .catch((e) => setBoot({ state: "login", error: errMsg(e) }));
  }, []);

  // If the company sign-in expires mid-session, go back to the sign-in screen.
  const url = boot.state === "ready" ? boot.session.url : undefined;
  useEffect(() => {
    if (!url) return;
    onSsoRequired(() => setBoot({ state: "login", url, sso: true }));
    return () => onSsoRequired(undefined);
  }, [url]);

  if (boot.state === "loading") {
    return (
      <div class="splash">
        <div class="titlebar" data-tauri-drag-region />
      </div>
    );
  }

  if (boot.state === "login") {
    return (
      <Login
        initialUrl={boot.url}
        initialError={boot.sso ? undefined : boot.error}
        initialSso={boot.sso}
        onSignedIn={(session) => setBoot({ state: "ready", session })}
      />
    );
  }

  return (
    <Timesheet
      session={boot.session}
      weekStart={weekStart}
      onWeekStartChange={(value) => {
        setWeekStart(value);
        void saveWeekStart(value);
      }}
      onSignedOut={async () => {
        await api.logout().catch(() => {});
        setBoot({ state: "login", url: boot.session.url });
      }}
    />
  );
}
