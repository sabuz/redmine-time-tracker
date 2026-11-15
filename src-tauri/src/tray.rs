//! The menu-bar icon: it keeps the timer in sight while the window is closed.
//!
//! The window's web view owns the timer; this side only mirrors it. The web view sends the timer's state whenever
//! it changes (`timer_status`), and a small thread here keeps the clock in the menu bar ticking from that, because
//! a hidden web view can't be relied on to run timers on time. Pause, Resume and Stop in the icon's menu are sent
//! back to the web view as events.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

const ID: &str = "timer";
const ICON: &[u8] = include_bytes!("../icons/tray.png");

#[derive(Deserialize, Clone, Copy, PartialEq, Default, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    #[default]
    None,
    Running,
    Paused,
}

/// What the web view says about its timer.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    kind: Kind,
    /// Time counted when this was sent.
    elapsed_ms: u64,
    /// "#1042 Login redirect…", for the menu and the tooltip.
    label: String,
}

#[derive(Default)]
pub struct View {
    kind: Kind,
    base_ms: u64,
    since: Option<Instant>,
    label: String,
    /// The title last put in the menu bar, so it is only set when it changes.
    shown: Option<String>,
}

impl View {
    fn elapsed_ms(&self) -> u64 {
        self.base_ms + self.since.map_or(0, |s| s.elapsed().as_millis() as u64)
    }

    fn title(&self) -> Option<String> {
        let secs = self.elapsed_ms() / 1000;
        let clock = format!("{}:{:02}", secs / 3600, secs % 3600 / 60);
        match self.kind {
            Kind::None => None,
            Kind::Running => Some(clock),
            Kind::Paused => Some(format!("⏸ {clock}")),
        }
    }
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn menu(app: &AppHandle, view: &View) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let status = match view.kind {
        Kind::None => "No timer running".to_string(),
        Kind::Running => format!("{} · running", view.label),
        Kind::Paused => format!("{} · paused", view.label),
    };
    menu.append(&MenuItem::with_id(app, "tray-status", status, false, None::<&str>)?)?;
    match view.kind {
        Kind::Running => menu.append(&MenuItem::with_id(app, "tray-pause", "Pause", true, None::<&str>)?)?,
        Kind::Paused => menu.append(&MenuItem::with_id(app, "tray-resume", "Resume", true, None::<&str>)?)?,
        Kind::None => {}
    }
    if view.kind != Kind::None {
        menu.append(&MenuItem::with_id(app, "tray-stop", "Stop and log to Redmine", true, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "tray-open", format!("Open {}", app.package_info().name), true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "tray-quit", "Quit", true, Some("CmdOrCtrl+Q"))?)?;
    Ok(menu)
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    app.manage(Mutex::new(View::default()));
    let initial = menu(app, &View::default())?;
    TrayIconBuilder::with_id(ID)
        .icon(Image::from_bytes(ICON)?)
        // A template image is drawn in the menu bar's own colour, light or dark.
        .icon_as_template(true)
        .tooltip(app.package_info().name.clone())
        .menu(&initial)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => show_main(app),
            // The result of a stop (a message, or why it failed) shows in the window, so open it first.
            "tray-stop" => {
                show_main(app);
                let _ = app.emit("timer-stop", ());
            }
            "tray-pause" => {
                let _ = app.emit("timer-pause", ());
            }
            "tray-resume" => {
                let _ = app.emit("timer-resume", ());
            }
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    // Keeps the clock in the menu bar moving while the timer runs.
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        refresh_title(&handle);
    });
    Ok(())
}

fn refresh_title(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(ID) else { return };
    let state = app.state::<Mutex<View>>();
    let mut view = state.lock().unwrap();
    let title = view.title();
    if title != view.shown {
        let _ = tray.set_title(title.as_deref());
        view.shown = title;
    }
}

/// The web view's timer changed: show it in the menu bar.
pub fn update(app: &AppHandle, status: Status) {
    let Some(tray) = app.tray_by_id(ID) else { return };
    {
        let state = app.state::<Mutex<View>>();
        let mut view = state.lock().unwrap();
        view.kind = status.kind;
        view.base_ms = status.elapsed_ms;
        view.since = (status.kind == Kind::Running).then(Instant::now);
        view.label = status.label;
        if let Ok(m) = menu(app, &view) {
            let _ = tray.set_menu(Some(m));
        }
        let tip = match view.kind {
            Kind::None => app.package_info().name.clone(),
            _ => view.label.clone(),
        };
        let _ = tray.set_tooltip(Some(tip));
        let title = view.title();
        let _ = tray.set_title(title.as_deref());
        view.shown = title;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_menu_bar_clock_reads_hours_and_minutes() {
        let mut v = View { kind: Kind::Paused, base_ms: (3600 + 5 * 60 + 59) * 1000, ..View::default() };
        assert_eq!(v.title().as_deref(), Some("⏸ 1:05"));
        v.kind = Kind::Running;
        assert_eq!(v.title().as_deref(), Some("1:05"));
        v.kind = Kind::None;
        assert_eq!(v.title(), None);
    }
}
