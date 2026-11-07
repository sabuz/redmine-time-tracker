# Changelog

## 1.0.0 (2026-11-07)

First release.

- Weekly timesheet in the style of Harvest: a day strip with hours per day and the week's total, week arrows, a footer with add, refresh, the timer, a link to the issue tracker for bugs, and Settings. Fixed-size window; light, dark or system appearance.
- Sign in with a Redmine address and API key, stored encrypted on the Mac. Redmine behind Pomerium: sign in once with the browser.
- Add, edit and delete time entries (`#id Title`, notes, activity, hours). New time can go on any day from the 1st of the current month to the end of the current week; earlier months are read-only.
- Hours in a time increment you choose (None, 15 min, 30 min, 1 hour), because Redmine can't tell an app about a company's policy.
- Optional timer, off by default: runs on the Mac and writes to Redmine once, when stopped. Rounds up to your increment without drifting, pauses when idle or asleep, survives quitting, and logs a timer that was left paused for a while. It never deletes anything it was asked to keep.
- The API key is only sent to Redmine's own address and is never followed to another site by a redirect. A sign-in address from the server is only opened if it is a web address.
- Signing in again after losing the connection at launch reuses the saved key.
- One universal app that runs on both Intel and Apple silicon Macs (macOS 11 or later).
- Help → About: a small popup with the version, the author and icon links to their GitHub and WordPress.org profiles.
