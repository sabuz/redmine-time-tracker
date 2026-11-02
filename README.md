# Redmine Time

A small, fast macOS desktop app for logging time to [Redmine](https://www.redmine.org) tickets, in the style of Harvest's weekly timesheet.

- Sign in with your Redmine URL and personal API key (stored encrypted, see [How credentials are stored](#how-credentials-are-stored)).
- Weekly view with a tab per day, a per-day total and a week total.
- Add an entry on the selected day: search a ticket by number or title, add notes, set hours.
- Hours go in **0.25 steps**. Type `1.5`, `1:30`, `1h30`, `90m`…, it snaps to the nearest quarter. ↑/↓ step by 0.25.
- Click the hours on any row to edit them in place; click anywhere else on the row to edit notes/activity or delete it.
- Time entries are the real Redmine ones, so everything shows up in the web UI too.

Not in this phase: start/stop timers.

## Stack

| Layer    | Choice                                                         |
| -------- | -------------------------------------------------------------- |
| Shell    | [Tauri 2](https://tauri.app): Rust + the system WebKit (no bundled Chromium, ~4 MB app) |
| Backend  | Rust: `reqwest` for the Redmine REST API, `chacha20poly1305` for the saved credentials, `tauri-plugin-store` for settings |
| Frontend | Preact + TypeScript + Vite, plain CSS (light/dark)             |

All HTTP goes through Rust: Redmine sends no CORS headers, and this keeps the API key out of the webview.

## Develop

Prerequisites: Xcode Command Line Tools, [Rust](https://rustup.rs), Node 20+.

```bash
npm install
npm run tauri dev      # the desktop app, with hot reload
```

`npm run dev` alone serves the UI in a normal browser against an in-memory fake backend (`src/mock.ts`), which is handy for UI work without a Redmine instance. Add `?login` to the URL to see the sign-in screen.

```bash
npm test                                # hours parser tests (Node ≥ 22.6)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests
npm run tauri build                     # → src-tauri/target/release/bundle/{macos,dmg}
```

To regenerate icons from `app-icon.png`: `npm run tauri icon app-icon.png`.

### Try it against a local Redmine

Needs Docker. This starts a disposable Redmine 5 on <http://localhost:3300> with a user (`alex`), a project and four assigned tickets:

```bash
docker run -d --name redmine-time-test -p 3300:3000 redmine:5
```

Wait ~20 s for it to boot, then seed it. This prints the API key to sign in with:

```bash
docker exec redmine-time-test bundle exec rake redmine:load_default_data RAILS_ENV=production REDMINE_LANG=en
docker cp dev/seed.rb redmine-time-test:/tmp/seed.rb
docker exec redmine-time-test bundle exec rails runner -e production /tmp/seed.rb 2>&1 | grep "API key"
```

The same instance powers the live Rust integration test (creates, edits and deletes an entry):

```bash
REDMINE_URL=http://localhost:3300 REDMINE_KEY=<key> cargo test --manifest-path src-tauri/Cargo.toml live -- --ignored --nocapture
```

Remove it with `docker rm -f redmine-time-test`.

## Redmine requirements

- An admin must enable the REST API: *Administration → Settings → API → Enable REST web service*.
- Your API key: *My account → API access key → Show*.
- Your role needs *Log spent time*. Editing and deleting entries also needs *Edit own spent time* (stock "Developer" roles don't have it); without it Redmine answers 403 and the app shows that message.
- If no default activity is configured (*Administration → Enumerations*), new entries use the first activity unless you pick another in the dropdown.
- Redmine 3.4+ is recommended (activity lookup per project); older versions fall back to the server-side default activity.

## How credentials are stored

| What | Where | Protection |
| --- | --- | --- |
| API key, company sign-in token | `secrets.bin` in the app data dir | Encrypted (ChaCha20-Poly1305). Key derived from this machine's ID, so there is no password and no OS keychain prompt. File mode 0600 on Unix. |
| Instance URL | `settings.json` (`tauri-plugin-store`) | Plain JSON, not secret |
| Week-start preference | `preferences.json` (`tauri-plugin-store`) | Plain JSON, not secret |

The app data dir is `~/Library/Application Support/org.redmine-desktop.time` on macOS.

What this protects against: the file leaking on its own (backups, synced folders, a copy on another machine, a screenshot, `grep`). What it doesn't: other software already running as you, which can ask for the same machine ID. If that is in your threat model, the OS keychain is stronger (at the cost of prompts for unsigned builds). Signing out deletes both secrets.

## Redmine behind Pomerium (company single sign-on)

If your Redmine is served through [Pomerium](https://www.pomerium.com), plain API calls get redirected to your identity provider (Google, Okta…) and never reach Redmine. Redmine Time handles this with Pomerium's [programmatic access](https://pomerium.com/docs/internals/programmatic-access) flow:

1. Enter the URL and API key and press **Sign in**. The app notices the redirect and shows **Sign in with browser**.
2. Your browser opens your normal company login. When it finishes, Pomerium hands a session token to a short-lived listener on `localhost` inside the app.
3. The token is stored encrypted and sent as `Authorization: Pomerium <token>` next to your Redmine API key.
4. When the token expires, the app returns to the sign-in screen (your saved API key is reused) and asks you to sign in with the browser again.

Both layouts are handled: Pomerium as the proxy itself, and nginx forward-auth (`auth_request`) where Pomerium lives on its own host. The app finds that host from the redirect an unauthenticated API request receives. For forward-auth, nginx must pass the client's `Authorization` header on to the Pomerium verify request (nginx does this by default unless the config strips headers).

This only works if Pomerium's policy for the route allows you, which it already does when you can open Redmine in a browser. The flow is tested against a local fake that follows Pomerium's documented endpoints, not against a real Pomerium + identity provider. Other proxies (oauth2-proxy, Cloudflare Access…) are not supported; the app will say the server didn't offer a Pomerium sign-in.

## How it maps to Redmine

| Action                | Endpoint                                                       |
| --------------------- | -------------------------------------------------------------- |
| Sign in               | `GET /users/current.json`                                      |
| Load a week           | `GET /time_entries.json?user_id=…&from=…&to=…` + `GET /issues.json?issue_id=…` for titles |
| Search tickets        | `GET /issues/:id.json` and `GET /issues.json?subject=~…`       |
| Create / edit / delete| `POST` / `PUT` / `DELETE /time_entries/…`                      |
| Activities            | `GET /projects/:id.json?include=time_entry_activities`, `GET /enumerations/time_entry_activities.json` |

## Roadmap

- Start/stop timers (phase 2)
- Windows and Linux builds (Tauri already targets them; nothing in the storage layer is OS-specific)
- Code signing + notarization for distributing the `.dmg`
