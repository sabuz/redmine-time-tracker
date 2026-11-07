mod idle;
mod redmine;
mod secrets;
mod sso;
mod store;

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, MenuItemKind, Submenu, HELP_SUBMENU_ID};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

use redmine::{Activity, Entry, Error, IssueHit, NewEntry, Redmine, Result, User};

#[derive(Clone)]
struct Session {
    client: Redmine,
    user_id: u64,
}

#[derive(Default)]
struct AppState {
    session: Mutex<Option<Session>>,
    /// Aborts a browser sign-in that is waiting for its callback.
    sso_cancel: Mutex<Option<oneshot::Sender<()>>>,
}

impl AppState {
    fn client(&self) -> Result<Session> {
        self.session.lock().unwrap().clone().ok_or_else(|| Error::from("You're signed out. Sign in again."))
    }

    fn set(&self, session: Option<Session>) {
        *self.session.lock().unwrap() = session;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    url: String,
    user: User,
}

/// What the app knew at launch: a live session if the saved key still works,
/// otherwise the saved URL (to prefill the form) and why sign-in failed.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Restore {
    url: Option<String>,
    session: Option<SessionInfo>,
    error: Option<String>,
    /// The failure was a proxy asking for a (new) company sign-in.
    sso_required: bool,
    /// A key is saved for this address, so signing in again doesn't need it typed (it is reused).
    has_key: bool,
}

async fn connect(url: &str, key: &str, sso: Option<String>) -> Result<(Session, User)> {
    let client = Redmine::new(url, key, sso)?;
    let user = client.current_user().await?;
    Ok((Session { client, user_id: user.id }, user))
}

/// `sso: true` runs the Pomerium browser sign-in first. A blank `api_key` reuses
/// the saved one, which is what re-signing-in after a token expiry needs.
#[tauri::command]
async fn login(app: AppHandle, state: State<'_, AppState>, url: String, api_key: String, sso: bool) -> Result<SessionInfo> {
    let base = redmine::normalize_url(&url)?;
    let mut key = api_key.trim().to_string();
    if key.is_empty() {
        key = store::load_key(&base).unwrap_or_default();
    }
    if key.is_empty() {
        return Err("Enter your API key.".into());
    }

    let token = if sso {
        let (cancel_tx, cancel_rx) = oneshot::channel();
        *state.sso_cancel.lock().unwrap() = Some(cancel_tx);
        let outcome = sso::pomerium_login(
            &base,
            |signin| open::that_detached(signin).map_err(|e| format!("Couldn't open your browser: {e}").into()),
            cancel_rx,
        )
        .await;
        state.sso_cancel.lock().unwrap().take();
        Some(outcome?)
    } else {
        store::load_sso(&base)
    };

    let (session, user) = connect(&base, &key, token.clone()).await?;
    let new_token = if sso { token.as_deref() } else { None };
    if let Err(e) = store::save_login(&app, &base, &key, new_token) {
        // Signing in still works; the user just has to repeat it next launch.
        eprintln!("could not save the session: {e}");
    }
    state.set(Some(session));
    Ok(SessionInfo { url: base, user })
}

#[tauri::command]
fn cancel_sso(state: State<'_, AppState>) {
    if let Some(tx) = state.sso_cancel.lock().unwrap().take() {
        let _ = tx.send(());
    }
}

#[tauri::command]
async fn restore_session(app: AppHandle, state: State<'_, AppState>) -> Result<Restore> {
    let Some(url) = store::load_url(&app) else {
        return Ok(Restore::default());
    };
    let Some(key) = store::load_key(&url) else {
        return Ok(Restore { url: Some(url), ..Default::default() });
    };
    Ok(match connect(&url, &key, store::load_sso(&url)).await {
        Ok((session, user)) => {
            state.set(Some(session));
            Restore { url: Some(url.clone()), session: Some(SessionInfo { url, user }), has_key: true, ..Default::default() }
        }
        Err(error) => Restore {
            url: Some(url),
            has_key: true,
            sso_required: matches!(error, Error::Sso),
            error: Some(error.to_string()),
            ..Default::default()
        },
    })
}

#[tauri::command]
async fn logout(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    state.set(None);
    store::sign_out(&app);
    Ok(())
}

#[tauri::command]
async fn list_time_entries(state: State<'_, AppState>, from: String, to: String) -> Result<Vec<Entry>> {
    let s = state.client()?;
    s.client.time_entries(s.user_id, &from, &to).await
}

#[tauri::command]
async fn search_issues(state: State<'_, AppState>, query: String) -> Result<Vec<IssueHit>> {
    state.client()?.client.search_issues(&query).await
}

#[tauri::command]
async fn list_activities(state: State<'_, AppState>, project_id: Option<u64>) -> Result<Vec<Activity>> {
    Ok(state.client()?.client.activities(project_id).await)
}

#[tauri::command]
async fn create_time_entry(state: State<'_, AppState>, input: NewEntry) -> Result<Entry> {
    state.client()?.client.create_entry(input).await
}

#[tauri::command]
async fn update_time_entry(
    state: State<'_, AppState>,
    id: u64,
    hours: Option<f64>,
    comments: Option<String>,
    activity_id: Option<u64>,
) -> Result<Entry> {
    state.client()?.client.update_entry(id, hours, comments, activity_id).await
}

#[tauri::command]
async fn delete_time_entry(state: State<'_, AppState>, id: u64) -> Result<()> {
    state.client()?.client.delete_entry(id).await
}

/// Seconds since the last keyboard or mouse input anywhere on the system, or `None`
/// where that can't be read. The timer polls this to pause itself when you walk away.
#[tauri::command]
fn idle_seconds() -> Option<f64> {
    idle::seconds()
}

/// The addresses the web view can ask to have opened: where "Report a bug" goes (the project's list of issues, to
/// look before filing) and the author's two profiles from the About popup. They are fixed here, and the web view
/// only names which one, so it can't ask for any other address to be opened.
const ISSUES_URL: &str = "https://github.com/sabuz/redmine-desktop/issues";
const GITHUB_URL: &str = "https://github.com/sabuz";
const WORDPRESS_URL: &str = "https://profiles.wordpress.org/nazsabuz/";

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Profile {
    Github,
    Wordpress,
}

fn open_page(url: &str) -> Result<()> {
    open::that_detached(url).map_err(|e| format!("Couldn't open your browser: {e}").into())
}

#[tauri::command]
fn report_bug() -> Result<()> {
    open_page(ISSUES_URL)
}

#[tauri::command]
fn open_profile(site: Profile) -> Result<()> {
    open_page(match site {
        Profile::Github => GITHUB_URL,
        Profile::Wordpress => WORDPRESS_URL,
    })
}

/// Puts the app's own About item (which opens the popup in the window) into `menu`: in place of the system's
/// About where there is one, or at the end when `add_if_missing`. Never fails the menu: if anything about it
/// can't be done the menu simply stays as it was.
fn own_about(app: &AppHandle, menu: &Submenu<tauri::Wry>, add_if_missing: bool) {
    let Ok(item) = MenuItem::with_id(app, "open-about", format!("About {}", app.package_info().name), true, None::<&str>) else {
        return;
    };
    let Ok(items) = menu.items() else { return };
    let system_about = items
        .iter()
        .position(|i| matches!(i, MenuItemKind::Predefined(p) if p.text().is_ok_and(|t| t.starts_with("About"))));
    match system_about {
        Some(at) => {
            if menu.remove_at(at).is_ok() {
                let _ = menu.insert(&item, at);
            }
        }
        None if add_if_missing => {
            let _ = menu.append(&item);
        }
        None => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::default())
        .setup(|app| {
            store::init(app.handle());
            Ok(())
        })
        // The standard macOS menus plus Account → Settings… and Sign Out, so neither
        // depends on finding a control inside the window.
        .menu(|app| {
            let menu = Menu::default(app)?;
            let settings = MenuItem::with_id(app, "open-settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
            let sign_out = MenuItem::with_id(app, "sign-out", "Sign Out", true, Some("CmdOrCtrl+Shift+O"))?;
            menu.append(&Submenu::with_items(app, "Account", true, &[&settings, &sign_out])?)?;
            // Help → About and the app menu's About open the same popup, with the author and a link.
            if let Some(MenuItemKind::Submenu(help)) = menu.get(HELP_SUBMENU_ID) {
                own_about(app, &help, true);
            }
            if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
                own_about(app, &app_menu, false);
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            id @ ("sign-out" | "open-settings" | "open-about") => {
                let _ = app.emit(id, ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            login,
            cancel_sso,
            restore_session,
            logout,
            list_time_entries,
            search_issues,
            list_activities,
            create_time_entry,
            update_time_entry,
            delete_time_entry,
            idle_seconds,
            report_bug,
            open_profile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Redmine Time Tracker");
}
