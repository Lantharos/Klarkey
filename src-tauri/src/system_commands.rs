use crate::{secure_state, system_auth};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub(crate) struct FileAccessState {
    readable: Mutex<HashSet<PathBuf>>,
    writable: Mutex<HashSet<PathBuf>>,
}

static CLIPBOARD_SERIAL: AtomicU64 = AtomicU64::new(0);

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
pub fn pick_import_file(format: String, access: State<FileAccessState>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    dialog = match format.as_str() {
        "1pux" => dialog.add_filter("1Password Export", &["1pux"]),
        "bitwarden-json" => dialog.add_filter("Bitwarden JSON", &["json"]),
        "dashlane-json" => dialog.add_filter("Dashlane JSON", &["json"]),
        "klarkey-json" => dialog.add_filter("Klarkey JSON", &["json"]),
        _ => dialog.add_filter("Supported files", &["csv", "json", "1pux"]),
    };
    dialog
        .add_filter("All files", &["*"])
        .pick_file()
        .map(|path| grant_path(path, &access.readable))
}

#[tauri::command]
pub fn pick_export_file(format: String, access: State<FileAccessState>) -> Option<String> {
    let dialog = if format == "klarkey-json" {
        rfd::FileDialog::new()
            .add_filter("Klarkey JSON", &["json"])
            .set_file_name("klarkey-export.json")
    } else {
        rfd::FileDialog::new()
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
    secure_state::mark_vault_locked(&path)
}

#[tauri::command]
pub fn save_vault_state(app: AppHandle, contents: String) -> Result<(), String> {
    let path = vault_state_path(&app)?;
    secure_state::write_vault_state(&path, &contents)
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
