import { useState } from "preact/hooks";
import { api, errMsg, isSso, type SessionInfo } from "../api";

interface Props {
  initialUrl?: string;
  initialError?: string;
  /** The company sign-in (Pomerium) in front of Redmine is needed or has expired. */
  initialSso?: boolean;
  /** A key is saved for `initialUrl`, so it needn't be typed again (no connection at launch, or the company sign-in expired). */
  hasSavedKey?: boolean;
  onSignedIn: (session: SessionInfo) => void;
}

export function Login({ initialUrl, initialError, initialSso, hasSavedKey, onSignedIn }: Props) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const [needsSso, setNeedsSso] = useState(!!initialSso);
  const [waiting, setWaiting] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSignedIn(await api.login(url, key));
    } catch (err) {
      if (isSso(err)) setNeedsSso(true);
      else setError(errMsg(err));
      setBusy(false);
    }
  };

  const browserSignIn = async () => {
    setWaiting(true);
    setError("");
    try {
      onSignedIn(await api.login(url, key, true));
    } catch (err) {
      setError(errMsg(err));
      setWaiting(false);
    }
  };

  // The saved key belongs to the address it was saved for and is reused when the field is left empty; another
  // address needs a key typed.
  const trimEnd = (s: string) => s.trim().replace(/\/+$/, "").toLowerCase();
  const usesSavedKey = !!hasSavedKey && trimEnd(url) === trimEnd(initialUrl ?? "");
  const canBrowserSignIn = !!url.trim() && (!!key.trim() || usesSavedKey);

  return (
    <div class="login">
      <div class="titlebar" data-tauri-drag-region />
      <form class="login-card" onSubmit={submit}>
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </div>
        <h1>Redmine Time Tracker</h1>
        <p class="sub">Sign in to log time against your tickets.</p>

        <label>
          Redmine URL
          <input
            type="text"
            value={url}
            placeholder="https://redmine.example.com"
            autoFocus={!initialUrl}
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            onInput={(e) => setUrl(e.currentTarget.value)}
          />
        </label>

        <label>
          API key
          <input
            type="password"
            value={key}
            placeholder={usesSavedKey ? "Saved (encrypted)" : "40-character key"}
            autoFocus={!!initialUrl && !hasSavedKey}
            autocomplete="off"
            spellcheck={false}
            onInput={(e) => setKey(e.currentTarget.value)}
          />
        </label>
        <p class="hint">
          In Redmine open <b>My account</b> and click <b>Show</b> under “API access key” (right sidebar). The REST API must be
          enabled by an admin.
        </p>

        {needsSso && (
          <div class="sso">
            <b>{initialSso ? "Your company sign-in has expired." : "This Redmine is behind a company sign-in."}</b>
            <p>
              Sign in once in your browser (Pomerium). The session is kept (encrypted) and asked for again when it expires.
            </p>
            <div class="sso-actions">
              <button class="primary" type="button" onClick={browserSignIn} disabled={waiting || !canBrowserSignIn}>
                {waiting ? "Waiting for your browser…" : "Sign in with browser"}
              </button>
              {waiting && (
                <button class="ghost" type="button" onClick={() => api.cancelSso()}>
                  Cancel
                </button>
              )}
            </div>
            {!canBrowserSignIn && !waiting && <span class="hint">Enter the URL and your API key first.</span>}
          </div>
        )}

        {error && <div class="error" role="alert">{error}</div>}

        <button class="primary wide" type="submit" disabled={busy || waiting || !url.trim() || (!key.trim() && !usesSavedKey)}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
