//! Encrypted storage for the API key and the company sign-in token.
//!
//! One small file (`secrets.bin`) holding a JSON map of account → secret, sealed
//! with ChaCha20-Poly1305. The key is derived (HKDF-SHA256, random per-file salt)
//! from this machine's ID, so there is no password to type and no OS keychain
//! prompt, and a copy of the file on another machine can't be opened.
//!
//! What this protects against: the file leaking on its own (backups, synced
//! folders, screenshots, copies) and casual snooping. It does not protect against
//! other software already running as you, which could ask for the same machine ID.
//!
//! File layout: `RTS1` | salt (16) | nonce (12) | ciphertext+tag. The header is
//! authenticated, and every save uses a fresh salt and nonce.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use chacha20poly1305::aead::{rand_core::RngCore, Aead, KeyInit, OsRng, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;

const MAGIC: &[u8; 4] = b"RTS1";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const HEADER_LEN: usize = MAGIC.len() + SALT_LEN + NONCE_LEN;
const KDF_CONTEXT: &[u8] = b"org.redmine-desktop.time secrets v1";

pub struct Vault {
    path: PathBuf,
    machine_id: String,
    /// Saves are read-modify-write; serialize them.
    lock: Mutex<()>,
}

impl Vault {
    pub fn new(path: PathBuf, machine_id: String) -> Self {
        Self { path, machine_id, lock: Mutex::new(()) }
    }

    fn cipher(&self, salt: &[u8]) -> ChaCha20Poly1305 {
        let mut key = [0u8; 32];
        Hkdf::<Sha256>::new(Some(salt), self.machine_id.as_bytes())
            .expand(KDF_CONTEXT, &mut key)
            .expect("32 bytes is a valid HKDF-SHA256 output length");
        ChaCha20Poly1305::new(Key::from_slice(&key))
    }

    /// Everything stored. A missing, corrupt, tampered or foreign (other machine) file
    /// reads as empty, so the user is simply asked to sign in again.
    fn read_all(&self) -> HashMap<String, String> {
        let Ok(bytes) = fs::read(&self.path) else { return HashMap::new() };
        if bytes.len() < HEADER_LEN || &bytes[..MAGIC.len()] != MAGIC {
            return HashMap::new();
        }
        let (header, sealed) = bytes.split_at(HEADER_LEN);
        let salt = &header[MAGIC.len()..MAGIC.len() + SALT_LEN];
        let nonce = &header[MAGIC.len() + SALT_LEN..];
        self.cipher(salt)
            .decrypt(Nonce::from_slice(nonce), Payload { msg: sealed, aad: header })
            .ok()
            .and_then(|plain| serde_json::from_slice(&plain).ok())
            .unwrap_or_default()
    }

    fn write_all(&self, secrets: &HashMap<String, String>) -> Result<(), String> {
        let mut salt = [0u8; SALT_LEN];
        let mut nonce = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut salt);
        OsRng.fill_bytes(&mut nonce);

        let mut out = Vec::with_capacity(HEADER_LEN + 256);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&salt);
        out.extend_from_slice(&nonce);
        let plain = serde_json::to_vec(secrets).map_err(|e| e.to_string())?;
        let sealed = self
            .cipher(&salt)
            .encrypt(Nonce::from_slice(&nonce), Payload { msg: &plain, aad: &out })
            .map_err(|_| "couldn't encrypt the saved credentials".to_string())?;
        out.extend_from_slice(&sealed);

        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        // Write beside the target and rename, so a crash never leaves a half-written vault.
        let tmp = self.path.with_extension("tmp");
        fs::write(&tmp, &out).map_err(|e| e.to_string())?;
        restrict(&tmp);
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }

    pub fn get(&self, account: &str) -> Option<String> {
        let _guard = self.lock.lock().unwrap();
        self.read_all().remove(account)
    }

    pub fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        let _guard = self.lock.lock().unwrap();
        let mut all = self.read_all();
        all.insert(account.to_string(), secret.to_string());
        self.write_all(&all)
    }

    pub fn remove(&self, account: &str) {
        let _guard = self.lock.lock().unwrap();
        let mut all = self.read_all();
        if all.remove(account).is_some() {
            let _ = self.write_all(&all);
        }
    }
}

/// Owner-only permissions on Unix; defence in depth on top of the encryption.
#[cfg(unix)]
fn restrict(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict(_path: &std::path::Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("redmine-time-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("secrets.bin")
    }

    #[test]
    fn round_trips_and_removes() {
        let path = temp_path("roundtrip");
        let vault = Vault::new(path.clone(), "machine-A".into());
        assert_eq!(vault.get("https://rm"), None);
        vault.set("https://rm", "key-123").unwrap();
        vault.set("https://rm#pomerium", "tok-456").unwrap();
        assert_eq!(vault.get("https://rm").as_deref(), Some("key-123"));
        assert_eq!(vault.get("https://rm#pomerium").as_deref(), Some("tok-456"));
        vault.set("https://rm", "key-new").unwrap();
        assert_eq!(vault.get("https://rm").as_deref(), Some("key-new"));
        vault.remove("https://rm");
        assert_eq!(vault.get("https://rm"), None);
        assert_eq!(vault.get("https://rm#pomerium").as_deref(), Some("tok-456"));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn the_file_does_not_contain_the_secrets() {
        let path = temp_path("opaque");
        let vault = Vault::new(path.clone(), "machine-A".into());
        vault.set("https://rm.example.com", "super-secret-api-key").unwrap();
        let raw = fs::read(&path).unwrap();
        let text = String::from_utf8_lossy(&raw);
        assert!(!text.contains("super-secret-api-key") && !text.contains("rm.example.com"));
        assert_eq!(&raw[..4], MAGIC);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn another_machine_or_a_tampered_file_reads_as_empty() {
        let path = temp_path("foreign");
        Vault::new(path.clone(), "machine-A".into()).set("acct", "secret").unwrap();

        assert_eq!(Vault::new(path.clone(), "machine-B".into()).get("acct"), None, "different machine");

        let mut raw = fs::read(&path).unwrap();
        *raw.last_mut().unwrap() ^= 1; // flip a bit in the ciphertext
        fs::write(&path, &raw).unwrap();
        assert_eq!(Vault::new(path.clone(), "machine-A".into()).get("acct"), None, "tampered");

        fs::write(&path, b"garbage").unwrap();
        assert_eq!(Vault::new(path.clone(), "machine-A".into()).get("acct"), None, "corrupt");
        // …and a fresh save recovers from it.
        let v = Vault::new(path.clone(), "machine-A".into());
        v.set("acct", "again").unwrap();
        assert_eq!(v.get("acct").as_deref(), Some("again"));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn every_save_uses_a_fresh_salt_and_nonce() {
        let path = temp_path("fresh");
        let vault = Vault::new(path.clone(), "machine-A".into());
        vault.set("acct", "secret").unwrap();
        let first = fs::read(&path).unwrap()[..HEADER_LEN].to_vec();
        vault.set("acct", "secret").unwrap();
        let second = fs::read(&path).unwrap()[..HEADER_LEN].to_vec();
        assert_ne!(first, second);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn this_machine_provides_an_id() {
        let id = machine_uid::get().expect("machine id");
        assert!(id.len() >= 8, "suspiciously short machine id");
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_path("perms");
        Vault::new(path.clone(), "m".into()).set("a", "b").unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
