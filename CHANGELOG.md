# Changelog

## 1.0.1 (2026-11-15)

- The timer no longer pauses itself when you are idle or when it thinks the Mac slept (that check fired falsely while the app was in the background), and the "Pause when idle" setting is gone. Pausing or stopping is up to you.
- "Log a paused timer after" has no "Never" any more, and gains "After the timer is stopped", which logs to Redmine the moment the timer is paused. Its choices are now the timer being stopped, or 1 to 6 hours (the 15 and 30 minute choices are gone). The setting is stored under a new name and starts at 1 hour.
- Closing the window now keeps the app and its timer running in the background, with an icon in the menu bar that shows the timer and lets you pause, resume, stop and log, open the window or quit.
- The clock icon on a timed entry opens a card with a line chart of the time worked, instead of a plain tooltip.
- Time increments start at none. When Redmine refuses an off-step time, the app retries it rounded up to 15 minutes and, if that works, sets the increment to 15 min. The setting can only be switched back to none, not set to a step by hand. 30 min and 1 hour are gone.
- Faster ticket search and activity lists: the requests behind them now run together instead of one after the other. A running timer also saves its heartbeat without redrawing the window.

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
