import { useEffect, useState } from "preact/hooks";
import { api, errMsg, onSsoRequired, type SessionInfo } from "./api";
import { About } from "./components/About";
import { Login } from "./components/Login";
import { Timesheet } from "./components/Timesheet";
import { useTauriEvent } from "./events";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from "./settings";
import { applyTheme } from "./theme";

type Boot =
  | { state: "loading" }
  | { state: "login"; url?: string; error?: string; sso?: boolean; hasKey?: boolean }
  | { state: "ready"; session: SessionInfo };

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  // Help → About (native menu). It is here, not in the timesheet, so it also opens on the sign-in screen.
  const [aboutOpen, setAboutOpen] = useState(false);
  useTauriEvent("open-about", () => setAboutOpen(true));

  useEffect(() => {
    // Preferences load alongside the session so the first paint already has the right week.
    Promise.all([api.restore(), loadPrefs()])
      .then(([r, loaded]) => {
        applyTheme(loaded.theme);
        setPrefs(loaded);
        setBoot(
          r.session
            ? { state: "ready", session: r.session }
            : { state: "login", url: r.url, error: r.error, sso: r.ssoRequired, hasKey: r.hasKey },
        );
      })
      .catch((e) => setBoot({ state: "login", error: errMsg(e) }));
  }, []);

  // If the company sign-in expires mid-session, go back to the sign-in screen.
  const url = boot.state === "ready" ? boot.session.url : undefined;
  useEffect(() => {
    if (!url) return;
    onSsoRequired(() => setBoot({ state: "login", url, sso: true, hasKey: true }));
    return () => onSsoRequired(undefined);
  }, [url]);

  let view;
  if (boot.state === "loading") {
    view = (
      <div class="splash">
        <div class="titlebar" data-tauri-drag-region />
      </div>
    );
  } else if (boot.state === "login") {
    view = (
      <Login
        initialUrl={boot.url}
        initialError={boot.sso ? undefined : boot.error}
        initialSso={boot.sso}
        hasSavedKey={boot.hasKey}
        onSignedIn={(session) => setBoot({ state: "ready", session })}
      />
    );
  } else {
    const { session } = boot;
    view = (
      <Timesheet
        session={session}
        prefs={prefs}
        onPrefsChange={(patch) => {
          if (patch.theme) applyTheme(patch.theme);
          setPrefs((p) => ({ ...p, ...patch }));
          void savePrefs(patch);
        }}
        onSignedOut={async () => {
          await api.logout().catch(() => {});
          setBoot({ state: "login", url: session.url });
        }}
      />
    );
  }

  return (
    <>
      {view}
      {aboutOpen && <About onClose={() => setAboutOpen(false)} />}
    </>
  );
}
