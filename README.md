# Redmine Time Tracker

**[Download the latest release](https://github.com/sabuz/redmine-desktop/releases/latest)** for macOS 11 or later, on Intel and Apple silicon Macs.

A small Mac app for logging time to [Redmine](https://www.redmine.org). It works like Harvest's weekly timesheet: pick a day, pick a ticket, enter the hours. The entry lands in Redmine like any other time entry, so it shows up in the web UI too.

It's an independent project, not made by or affiliated with the Redmine team. Changes between versions are in the [changelog](CHANGELOG.md).

## Install

Download the `.dmg` from the [latest release](https://github.com/sabuz/redmine-desktop/releases/latest), or build it yourself (see [Development](#development)), then drag the app into Applications. It needs macOS 11 or later and runs on both Intel and Apple silicon Macs.

The app isn't signed or notarized yet, so macOS won't open it the first time. Go to System Settings → Privacy & Security and click Open Anyway. On older versions, right-click the app and choose Open. Or, from the Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Redmine Time Tracker.app"
```

## Using it

Sign in with your Redmine address and your API key. You'll find the key in Redmine under My account → API access key → Show. The app stores it encrypted on your Mac (more on that [below](#where-things-are-stored)).

The window shows one week. At the top is a strip with the days and their hours, arrows to change week, and the week's total. Click the date in the title bar to jump back to today. The bar along the bottom has + to add time, refresh, the timer's clock when one is running, Report a bug (it opens this project's issues on GitHub) and Settings (⌘,). In Settings you can sign out, switch between light and dark, and choose which day the week starts on. Help → About shows the version and who made the app.

To add time, select a day, press +, search for a ticket by number or title, add a note if you want one, and set the hours.

To change an entry, right-click it. You can edit it, start a timer on it, or delete it (you'll be asked to confirm). With the keyboard, focus a row and press Enter to edit. A plain click does nothing, so you can't change an entry by accident.

### Which days you can change

You can add time to any day from the 1st of the current month to the end of the current week. Earlier months and future weeks are there to look at, but the + button is disabled and tells you why. Entries from earlier months are read-only. Entries in future weeks can still be edited or deleted.

### Hours

Hours go in quarter-hour steps by default. You can type `1.5`, `1:30`, `1h30` or `90m`, and it rounds to the nearest step, so 25 minutes becomes 0.5. The up and down arrow keys move one step at a time.

Some companies require fixed steps and some don't, and Redmine doesn't tell apps which kind you have. So you choose in Settings → Time increments: none (exact, to 0.01 hours), 15 minutes, 30 minutes or 1 hour. If Redmine rejects an odd value while this is set to none, the error message points you to that setting.

## Timer

The timer is off by default. Turn it on in Settings, and entries for today and earlier days this month get a ▶ button. The + form changes too: pick a ticket and leave the hours at 0, and the button says Start tracking instead of Add time.

How it behaves:

- **Nothing goes to Redmine while it runs.** The app only keeps start and end times on your Mac and writes the time when you stop. A dropped connection can't lose anything, and nobody sees a half-finished entry.
- **Stopping.** The button on the timer row pauses and resumes. To stop and log, or to throw the timer away, right-click the row.
- **One timer at a time.** Starting a second one stops and logs the first.
- **Which day it logs to.** The day you started it from, which has to be today or an earlier day this month. If that day slips into a previous month while the timer is paused (over midnight on the 1st, say), you can't resume it, only stop it, so the time still gets logged.
- **Rounding.** The total for a ticket and day is rounded up to your increment, so 25 minutes becomes 30 with quarter-hour steps. It doesn't pile up: whatever was rounded up is taken off the next stop on the same ticket and day, so six 10-minute stops come to exactly 1.00 hours, not 1.50. Times you type yourself are rounded to the nearest step instead.
- **One row per ticket per day.** If the ticket already has an entry for that day, the timer adds to it and appends its notes instead of creating a second row.
- **It pauses when you stop working.** If there's no keyboard or mouse activity anywhere on the Mac for the idle time you set, the timer pauses, and the idle time isn't counted. It also notices when the Mac went to sleep. macOS gives the app the idle time without any permission prompt. On other systems this isn't available, and Settings says so.
- **It survives quitting.** The timer is saved as it changes. If the app closes or crashes while it runs, it comes back paused, counted up to the last 15-second check.
- **A forgotten paused timer gets logged.** After the time you choose (30 minutes by default), the app stops the timer and logs it as if you'd pressed Stop, and shows a message. A timer reopened after days is logged straight away. This never deletes anything: a timer shorter than "Ignore timers shorter than" is left for you to decide. If Redmine refuses (you're offline, or the month is locked), the timer stays, with the error, and isn't tried again until it's paused again or the app restarts.

The timer settings are: pause after 1, 2, 5, 10 or 15 minutes idle, or never (default 5); log a paused timer after 15, 30, 60 or 120 minutes, or never (default 30); ignore timers shorter than 1, 2 or 5 minutes, or keep everything (default 5). Turning the timer off pauses a running one, and its row stays until you stop or discard it.

Stopped timers leave a small record in `timer.json` for 7 days: the stretches you worked, plus how much the rounding gave extra. That's what lets two stops on the same day combine, and what puts a clock icon on the row with the times. After 7 days Redmine is the only record. A timer you haven't stopped is kept until you stop or discard it.

The running time isn't included in the day and week totals. They only show what's already logged.

## What Redmine needs

- An admin has to turn on the REST API: Administration → Settings → API → Enable REST web service.
- Your role needs the "Log spent time" permission. Editing and deleting entries also needs "Edit own spent time", which the stock Developer role doesn't have. Without it Redmine answers 403 and the app shows that message.
- If no default activity is set (Administration → Enumerations), new entries use the first activity unless you pick another one in the dropdown.
- Redmine 3.4 or newer is best, because it can list activities per project. Older versions fall back to the server's default activity.

## Where things are stored

| What | Where | How it's protected |
| --- | --- | --- |
| API key and company sign-in token | `secrets.bin` in the app data folder | Encrypted with ChaCha20-Poly1305, using a key derived from this Mac's ID. No password to type and no keychain prompt. Readable only by your user. |
| Redmine address | `settings.json` | Plain text, not secret |
| Preferences (appearance, week start, timer settings) | `preferences.json` | Plain text, not secret |
| Running timer and the last 7 days of stopped ones | `timer.json` | Plain text: ticket numbers, titles and your notes, all of which are in Redmine already. No credentials. |

The app data folder is `~/Library/Application Support/org.redmine-desktop.time`.

The encryption protects against the file leaking on its own: a backup, a synced folder, a copy on another machine, a screenshot. It doesn't protect against other software running as you, which could ask for the same machine ID. If that matters to you, the macOS keychain is stronger, though it prompts for unsigned apps. Signing out deletes the key and the token.

Your API key is only ever sent to your Redmine's own address. If Redmine, or a proxy in front of it, redirects a request to a different site (an identity provider, say), the app doesn't follow it, so the key can't end up there. If the app can't reach Redmine when it starts, the sign-in screen lets you press Sign in again with the saved key, so you don't have to retype it.

## Redmine behind Pomerium

If your Redmine sits behind [Pomerium](https://www.pomerium.com), API calls get redirected to your identity provider (Google, Okta and so on) and never reach Redmine. The app deals with this using Pomerium's [programmatic access](https://pomerium.com/docs/internals/programmatic-access) flow:

1. Enter the address and API key and press Sign in. The app notices the redirect and shows a Sign in with browser button.
2. Your browser opens your normal company login. When you're done, Pomerium hands a session token to a short-lived listener inside the app, on `localhost`.
3. The app stores the token encrypted and sends it as `Authorization: Pomerium <token>` along with your API key.
4. When the token expires, you're taken back to the sign-in screen. Your saved API key is reused, so you only need to sign in with the browser again.

It works whether Pomerium is the proxy itself or sits behind nginx forward-auth (`auth_request`) on a separate host. With forward-auth, nginx has to pass the client's `Authorization` header on to the Pomerium check, which it does by default unless your config strips headers.

It only works if Pomerium's policy for the route lets you in, which it already does if you can open Redmine in a browser. I've tested the flow against a local fake that follows Pomerium's documented endpoints, not against a real Pomerium and identity provider. Other proxies, such as oauth2-proxy or Cloudflare Access, aren't supported. The app will tell you the server didn't offer a Pomerium sign-in.

## Development

It's built with [Tauri 2](https://tauri.app), so the shell and backend are Rust and the window is the system WebKit (no bundled Chromium, which is why the app is only about 4 MB). The interface is Preact and TypeScript with plain CSS. All requests to Redmine go through Rust. Redmine doesn't send CORS headers, and this also keeps the API key out of the web view.

You'll need the Xcode Command Line Tools, [Rust](https://rustup.rs) and Node 20 or newer.

```bash
npm install
npm run tauri dev      # the desktop app, with hot reload
```

`npm run dev` on its own serves the interface in a normal browser against a fake in-memory backend (`src/mock.ts`). That's handy for working on the UI without a Redmine. A few URL switches show the less common screens: `?login` for sign-in, `?offline` for the screen you get when the Mac had no connection at launch, and `?expired` for an expired company sign-in. Searching for `expired-sso` in the ticket picker makes the sign-in expire mid-session. A browser has no native menu, so to try a menu item, run `window.dispatchEvent(new Event("menu:open-about"))` in the console (or `menu:open-settings`, `menu:sign-out`).

```bash
npm test                                          # UI logic tests (Node 22.6 or newer)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
npm run tauri build                               # builds into src-tauri/target/release/bundle/
```

That builds for the Mac you're on. For one app that runs on both Intel and Apple silicon (what the releases use), add the Intel target once with `rustup target add x86_64-apple-darwin`, then run `npm run tauri build -- --target universal-apple-darwin`. The result is in `src-tauri/target/universal-apple-darwin/release/bundle/`.

To regenerate the icons from `app-icon.png`, run `npm run tauri icon app-icon.png`.

### Trying it against a local Redmine

You need Docker. This starts a throwaway Redmine 5 on <http://localhost:3300>:

```bash
docker run -d --name redmine-time-test -p 3300:3000 redmine:5
```

Give it about 20 seconds to boot, then seed it with a user (`alex`), a project and four assigned tickets. The last command prints the API key to sign in with:

```bash
docker exec redmine-time-test bundle exec rake redmine:load_default_data RAILS_ENV=production REDMINE_LANG=en
docker cp dev/seed.rb redmine-time-test:/tmp/seed.rb
docker exec redmine-time-test bundle exec rails runner -e production /tmp/seed.rb 2>&1 | grep "API key"
```

The same instance runs the live Rust test, which creates, edits and deletes an entry:

```bash
REDMINE_URL=http://localhost:3300 REDMINE_KEY=<key> cargo test --manifest-path src-tauri/Cargo.toml live -- --ignored --nocapture
```

When you're done, remove it with `docker rm -f redmine-time-test`.

## What the app asks Redmine

| What you do | Request |
| --- | --- |
| Sign in | `GET /users/current.json` |
| Open a week | `GET /time_entries.json?user_id=…&from=…&to=…`, then `GET /issues.json?issue_id=…` for the titles |
| Search tickets | `GET /issues/:id.json` and `GET /issues.json?subject=~…` |
| Add, edit, delete | `POST`, `PUT` and `DELETE /time_entries/…` |
| Pick an activity | `GET /projects/:id.json?include=time_entry_activities` and `GET /enumerations/time_entry_activities.json` |

## License

Redmine Time Tracker is released under the [MIT License](LICENSE). The icons and the open source packages it's built on keep their own licenses, listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Roadmap

- Count idle time back in when you return to a paused timer, and show the running time in the menu bar
- Windows and Linux builds (Tauri supports them, and nothing in how the app stores data is Mac-specific)
- Code signing and notarization, so the `.dmg` opens without the warning
