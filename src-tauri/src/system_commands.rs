use crate::{secret_hash, secure_state, system_auth, windowing};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub(crate) struct FileAccessState {
    readable: Mutex<HashSet<PathBuf>>,
    writable: Mutex<HashSet<PathBuf>>,
}

static CLIPBOARD_SERIAL: AtomicU64 = AtomicU64::new(0);
static UNLOCK_RATE_LIMIT: OnceLock<Mutex<UnlockRateLimit>> = OnceLock::new();

const MAX_UNLOCK_ATTEMPTS: u8 = 8;
const UNLOCK_LOCKOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
struct UnlockRateLimit {
    failed_attempts: u8,
    locked_until: Option<Instant>,
}

fn unavailable_result() -> Value {
    json!({
        "status": "error",
        "title": "Unavailable",
        "message": "Clipboard is unavailable."
    })
}

#[tauri::command]
pub fn clipboard_copy_secret(value: String, timeout_seconds: Option<u64>) -> Value {
    match arboard::Clipboard::new().and_then(|mut clipboard| clipboard.set_text(value.clone())) {
        Ok(()) => {
            schedule_clipboard_clear(value, timeout_seconds.unwrap_or(45));
            json!({
            "status": "success",
            "title": "Copied",
            "message": "Clipboard will clear automatically.",
            "copied": true
            })
        }
        Err(_) => unavailable_result(),
    }
}

fn schedule_clipboard_clear(value: String, timeout_seconds: u64) {
    let serial = CLIPBOARD_SERIAL.fetch_add(1, Ordering::Relaxed) + 1;
    if timeout_seconds == 0 {
        return;
    }
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(timeout_seconds.min(300)));
        if CLIPBOARD_SERIAL.load(Ordering::Relaxed) != serial {
            return;
        }
        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            if clipboard.get_text().ok().as_deref() == Some(value.as_str()) {
                let _ = clipboard.clear();
            }
        }
    });
}

#[tauri::command]
pub fn pick_import_file(
    app: AppHandle,
    format: String,
    access: State<FileAccessState>,
) -> Option<String> {
    windowing::run_modal_interaction(&app, || {
        let mut dialog = file_dialog_for_palette(&app);
        dialog = match format.as_str() {
            "1pux" => dialog.add_filter("1Password Export", &["1pux"]),
            "bitwarden-json" => dialog.add_filter("Bitwarden JSON", &["json"]),
            "dashlane-json" => dialog.add_filter("Dashlane JSON", &["json"]),
            "dashlane-csv" => dialog.add_filter("Dashlane CSV or ZIP", &["csv", "zip"]),
            "proton-pass" => dialog.add_filter("Proton Pass Export", &["zip", "json", "csv"]),
            "klarkey-json" => dialog.add_filter("Klarkey JSON", &["json"]),
            _ => dialog.add_filter("Supported files", &["csv", "json", "1pux", "zip"]),
        };
        dialog
            .add_filter("All files", &["*"])
            .pick_file()
            .map(|path| grant_path(path, &access.readable))
    })
}

#[tauri::command]
pub fn pick_export_file(
    app: AppHandle,
    format: String,
    access: State<FileAccessState>,
) -> Option<String> {
    windowing::run_modal_interaction(&app, || pick_export_file_inner(&app, format, access))
}

fn pick_export_file_inner(
    app: &AppHandle,
    format: String,
    access: State<FileAccessState>,
) -> Option<String> {
    let dialog = if format == "klarkey-json" {
        file_dialog_for_palette(app)
            .add_filter("Klarkey JSON", &["json"])
            .set_file_name("klarkey-export.json")
    } else {
        file_dialog_for_palette(app)
            .add_filter("CSV", &["csv"])
            .set_file_name("klarkey-export.csv")
    };
    dialog
        .save_file()
        .map(|path| grant_path(path, &access.writable))
}

#[tauri::command]
pub fn read_text_file(path: String, access: State<FileAccessState>) -> Result<String, String> {
    let path = consume_path_grant(path, &access.readable)?;
    fs::read_to_string(path).map_err(|_| String::from("Could not read the selected file."))
}

#[tauri::command]
pub fn read_binary_file(path: String, access: State<FileAccessState>) -> Result<String, String> {
    let path = consume_path_grant(path, &access.readable)?;
    let bytes = fs::read(path).map_err(|_| String::from("Could not read the selected file."))?;
    if bytes.len() > 128 * 1024 * 1024 {
        return Err(String::from(
            "That vault export is too large to import safely.",
        ));
    }
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
pub fn write_text_file(
    path: String,
    contents: String,
    access: State<FileAccessState>,
) -> Result<(), String> {
    let path = consume_path_grant(path, &access.writable)?;
    fs::write(path, contents).map_err(|_| String::from("Could not write the selected file."))
}

#[tauri::command]
pub fn load_vault_state(app: AppHandle) -> Result<Option<String>, String> {
    let path = vault_state_path(&app)?;
    if secure_state::read_vault_metadata(&path)?.is_some_and(|metadata| metadata.locked) {
        return Err(String::from("Unlock Klarkey before loading the vault."));
    }
    secure_state::read_vault_state(&path)
}

#[tauri::command]
pub fn load_vault_metadata(
    app: AppHandle,
) -> Result<Option<secure_state::VaultStateMetadata>, String> {
    let path = vault_state_path(&app)?;
    secure_state::read_vault_metadata(&path)
}

#[tauri::command]
pub fn lock_vault_metadata(app: AppHandle) -> Result<(), String> {
    let path = vault_state_path(&app)?;
    system_auth::clear_cached_vault_key();
    secure_state::mark_vault_locked(&path)
}

#[tauri::command]
pub fn save_vault_state(app: AppHandle, contents: String) -> Result<(), String> {
    let path = vault_state_path(&app)?;
    if secure_state::read_vault_metadata(&path)?.is_some_and(|metadata| metadata.locked) {
        return Err(String::from("Unlock Klarkey before saving the vault."));
    }
    secure_state::write_vault_state(&path, &contents)
}

#[tauri::command]
pub fn unlock_vault_with_system(app: AppHandle, reason: String, strict: Option<bool>) -> Value {
    let auth = windowing::run_modal_interaction(&app, || {
        system_auth::unlock(reason, strict.unwrap_or(false))
    });
    if !auth
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return auth;
    }
    unlock_state(&app).unwrap_or_else(error_unlock_result)
}

fn file_dialog_for_palette(app: &AppHandle) -> rfd::FileDialog {
    let dialog = rfd::FileDialog::new();
    if let Some(window) = app.get_webview_window("main") {
        return dialog.set_parent(&window);
    }
    dialog
}

#[tauri::command]
pub fn unlock_vault_with_secret(app: AppHandle, kind: String, secret: String) -> Value {
    if let Some(message) = unlock_rate_limit_message() {
        return json!({ "success": false, "message": message });
    }
    let result = verify_secret_and_unlock(&app, &kind, &secret);
    if result
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        reset_unlock_rate_limit();
    } else {
        record_unlock_failure();
    }
    result
}

#[tauri::command]
pub fn reset_vault_state(app: AppHandle) -> Result<(), String> {
    let path = vault_state_path(&app)?;
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(String::from("Could not remove the local vault state.")),
    }
    let result = system_auth::delete_vault_key();
    if result
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        Ok(())
    } else {
        Err(String::from("Could not remove the system vault key."))
    }
}

fn vault_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("vault-state.json"))
        .map_err(|_| String::from("Could not resolve the local data folder."))
}

fn verify_secret_and_unlock(app: &AppHandle, kind: &str, secret: &str) -> Value {
    let path = match vault_state_path(app) {
        Ok(path) => path,
        Err(message) => return json!({ "success": false, "message": message }),
    };
    let contents = match secure_state::read_vault_state(&path) {
        Ok(Some(contents)) => contents,
        Ok(None) => {
            return json!({
                "success": false,
                "message": "Vault state unavailable."
            });
        }
        Err(message) => return json!({ "success": false, "message": message }),
    };
    let mut state = match serde_json::from_str::<Value>(&contents) {
        Ok(state) => state,
        Err(_) => {
            return json!({
                "success": false,
                "message": "The local vault state is invalid."
            });
        }
    };
    let (field, failure_message) = match kind {
        "masterPassword" => ("masterPasswordHash", "Incorrect master password."),
        "passcode" => ("passcodeHash", "Incorrect passcode."),
        _ => {
            return json!({
                "success": false,
                "message": "That unlock method is not supported."
            });
        }
    };
    if !secret_hash::verify_secret(secret, state.get(field)) {
        return json!({
            "success": false,
            "message": failure_message
        });
    }
    state["locked"] = Value::Bool(false);
    let updated = match serde_json::to_string(&state) {
        Ok(contents) => contents,
        Err(_) => {
            return json!({
                "success": false,
                "message": "Could not unlock the vault."
            });
        }
    };
    match secure_state::write_vault_state(&path, &updated) {
        Ok(()) => json!({
            "success": true,
            "message": "Vault unlocked.",
            "contents": updated
        }),
        Err(message) => json!({ "success": false, "message": message }),
    }
}

fn unlock_state(app: &AppHandle) -> Result<Value, String> {
    let path = vault_state_path(app)?;
    let Some(contents) = secure_state::read_vault_state(&path)? else {
        return Err(String::from("Vault state unavailable."));
    };
    let mut state = serde_json::from_str::<Value>(&contents)
        .map_err(|_| String::from("The local vault state is invalid."))?;
    state["locked"] = Value::Bool(false);
    let updated =
        serde_json::to_string(&state).map_err(|_| String::from("Could not unlock the vault."))?;
    secure_state::write_vault_state(&path, &updated)?;
    reset_unlock_rate_limit();
    Ok(json!({
        "success": true,
        "message": "Vault unlocked.",
        "contents": updated
    }))
}

fn error_unlock_result(message: String) -> Value {
    json!({
        "success": false,
        "message": message
    })
}

fn unlock_rate_limit_message() -> Option<String> {
    let lock = UNLOCK_RATE_LIMIT.get_or_init(|| Mutex::new(UnlockRateLimit::default()));
    let mut state = lock.lock().ok()?;
    let locked_until = state.locked_until?;
    let now = Instant::now();
    if now >= locked_until {
        state.locked_until = None;
        state.failed_attempts = 0;
        return None;
    }
    let seconds = locked_until.saturating_duration_since(now).as_secs().max(1);
    Some(format!(
        "Try again in {seconds} second{}.",
        if seconds == 1 { "" } else { "s" }
    ))
}

fn record_unlock_failure() {
    let lock = UNLOCK_RATE_LIMIT.get_or_init(|| Mutex::new(UnlockRateLimit::default()));
    let Ok(mut state) = lock.lock() else {
        return;
    };
    state.failed_attempts = state.failed_attempts.saturating_add(1);
    if state.failed_attempts >= MAX_UNLOCK_ATTEMPTS {
        state.locked_until = Some(Instant::now() + UNLOCK_LOCKOUT);
    }
}

fn reset_unlock_rate_limit() {
    let lock = UNLOCK_RATE_LIMIT.get_or_init(|| Mutex::new(UnlockRateLimit::default()));
    if let Ok(mut state) = lock.lock() {
        *state = UnlockRateLimit::default();
    }
}

fn grant_path(path: PathBuf, grants: &Mutex<HashSet<PathBuf>>) -> String {
    let path = normalize_user_path(path);
    grants
        .lock()
        .expect("file grants lock poisoned")
        .insert(path.clone());
    path.to_string_lossy().to_string()
}

fn consume_path_grant(path: String, grants: &Mutex<HashSet<PathBuf>>) -> Result<PathBuf, String> {
    let path = normalize_user_path(PathBuf::from(path));
    if grants
        .lock()
        .expect("file grants lock poisoned")
        .remove(&path)
    {
        return Ok(path);
    }
    Err(String::from("Select the file in Klarkey before using it."))
}

fn normalize_user_path(path: PathBuf) -> PathBuf {
    if let Ok(path) = path.canonicalize() {
        return path;
    }
    let Some(parent) = path.parent() else {
        return path;
    };
    let Some(name) = path.file_name() else {
        return path;
    };
    parent
        .canonicalize()
        .unwrap_or_else(|_| parent.to_path_buf())
        .join(name)
}
