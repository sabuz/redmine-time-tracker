//! What the app remembers between launches.
//!
//! * Secrets (API key, company sign-in token) live in an encrypted file (see
//!   `secrets.rs`). They never touch a plain file, and no OS keychain is involved.
//! * The non-secret instance URL lives in `settings.json` (tauri-plugin-store).
//!   The frontend keeps its own preferences in a separate `preferences.json`.

use std::sync::OnceLock;

use serde_json::json;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

use crate::secrets::Vault;

const SETTINGS_FILE: &str = "settings.json";
const URL: &str = "url";

/// The instance the app was last signed in to (kept after sign-out, to prefill the form).
pub fn load_url(app: &AppHandle) -> Option<String> {
    let store = app.store(SETTINGS_FILE).ok()?;
    if let Some(url) = store.get(URL).and_then(|v| v.as_str().map(str::to_string)) {
        return Some(url);
    }
    // Upgrade path: earlier versions kept the URL in config.json. Adopt it once, so
    // the credentials already in the secure store keep working.
    let legacy = legacy_url(app)?;
    store.set(URL, json!(legacy));
    let _ = store.save();
    Some(legacy)
}

fn legacy_url(app: &AppHandle) -> Option<String> {
    let text = std::fs::read_to_string(app.path().app_config_dir().ok()?.join("config.json")).ok()?;
    serde_json::from_str::<serde_json::Value>(&text).ok()?["url"].as_str().map(str::to_string)
}

fn save_url(app: &AppHandle, url: &str) -> Result<(), String> {
    let store = app.store(SETTINGS_FILE).map_err(|e| e.to_string())?;
    store.set(URL, json!(url));
    store.save().map_err(|e| e.to_string())
}

static VAULT: OnceLock<Result<Vault, String>> = OnceLock::new();

/// Opens the encrypted vault. Call once at startup; if it can't be opened (no machine
/// ID available), signing in still works but nothing is remembered.
pub fn init(app: &AppHandle) {
    VAULT.get_or_init(|| {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let machine_id = machine_uid::get().map_err(|e| format!("couldn't identify this machine: {e}"))?;
        Ok(Vault::new(dir.join("secrets.bin"), machine_id))
    });
}

fn vault() -> Result<&'static Vault, String> {
    match VAULT.get() {
        Some(Ok(vault)) => Ok(vault),
        Some(Err(e)) => Err(e.clone()),
        None => Err("storage isn't initialised".into()),
    }
}

// Secrets are keyed by instance URL; the sign-in token has its own account name.
fn read(url: &str, suffix: &str) -> Option<String> {
    vault().ok()?.get(&format!("{url}{suffix}"))
}

fn write(url: &str, suffix: &str, value: &str) -> Result<(), String> {
    vault()?.set(&format!("{url}{suffix}"), value)
}

fn forget(url: &str, suffix: &str) {
    if let Ok(vault) = vault() {
        vault.remove(&format!("{url}{suffix}"));
    }
}

const KEY: &str = "";
const SSO: &str = "#pomerium";

pub fn load_key(url: &str) -> Option<String> {
    read(url, KEY)
}

pub fn load_sso(url: &str) -> Option<String> {
    read(url, SSO)
}

/// Remembers a successful sign-in. `sso` is only written when a new token was obtained.
pub fn save_login(app: &AppHandle, url: &str, key: &str, sso: Option<&str>) -> Result<(), String> {
    save_url(app, url)?;
    write(url, KEY, key)?;
    if let Some(token) = sso {
        write(url, SSO, token)?;
    }
    Ok(())
}

/// Forgets the credentials but keeps the URL.
pub fn sign_out(app: &AppHandle) {
    if let Some(url) = load_url(app) {
        forget(&url, KEY);
        forget(&url, SSO);
    }
}
