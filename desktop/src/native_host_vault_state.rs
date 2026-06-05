use crate::native_host_vault_response::{error_response, locked_response};
use crate::secure_state;
use crate::system_auth;
use serde_json::{json, Value};
use std::env;
use std::path::PathBuf;

const APP_IDENTIFIER: &str = "com.lantharos.klarkey";
const STATE_FILE: &str = "vault-state.json";

fn default_settings() -> Value {
    json!({
        "hotkey": "Alt+S",
        "clearClipboardSeconds": 45,
        "launchOnStartup": false,
        "browserAutoOpenMenu": true,
        "browserAutoSubmitLogin": false,
        "browserSavePrompts": true,
        "passcodeEnabled": true,
        "autoLockMinutes": 15,
        "systemUnlockPolicy": "timed",
        "sshAgentEnabled": false
    })
}

pub(crate) fn default_state() -> Value {
    json!({
        "items": [],
        "settings": default_settings(),
        "vaultPasskeys": [],
        "sitePasskeys": [],
        "pendingPasskeys": [],
        "recents": [],
        "systemUnlockEnabled": true,
        "locked": false
    })
}

pub(crate) fn settings_from(state: Option<&Value>) -> Value {
    let mut settings = default_settings();
    let Some(source) = state
        .and_then(|state| state.get("settings"))
        .and_then(Value::as_object)
    else {
        return settings;
    };

    let target = settings.as_object_mut().expect("settings object");
    for (key, value) in source {
        if target.contains_key(key) {
            target.insert(key.clone(), value.clone());
        }
    }
    settings
}

pub(crate) fn readable_state() -> Option<Value> {
    if metadata_locked() {
        return None;
    }
    read_state().ok().flatten()
}

pub(crate) fn listing_state() -> (Option<Value>, bool) {
    if let Some(metadata) = vault_metadata() {
        if metadata.locked {
            return (
                Some(json!({
                    "items": metadata.login_index,
                    "locked": true
                })),
                true,
            );
        }
    }

    let state = read_state().ok().flatten();
    let locked = is_locked(state.as_ref());
    (state, locked)
}

pub(crate) fn checked_state(id: &str) -> Result<Option<Value>, Value> {
    if metadata_locked() && !unlock_with_system_auth() {
        return Ok(None);
    }
    read_state().map_err(|message| error_response(id.to_string(), "vault_unavailable", &message))
}

pub(crate) fn editable_state(id: &str) -> Result<Value, Value> {
    if metadata_locked() && !unlock_with_system_auth() {
        return Err(locked_response(id.to_string()));
    }
    checked_state(id).map(|state| state.unwrap_or_else(default_state))
}

pub(crate) fn metadata_locked() -> bool {
    vault_metadata()
        .map(|metadata| metadata.locked)
        .unwrap_or(false)
}

pub(crate) fn vault_metadata() -> Option<secure_state::VaultStateMetadata> {
    let path = state_path()?;
    secure_state::read_vault_metadata(&path).ok().flatten()
}

fn read_state() -> Result<Option<Value>, String> {
    let path =
        state_path().ok_or_else(|| String::from("Could not resolve the local data folder."))?;
    let Some(contents) = secure_state::read_vault_state(&path)? else {
        return Ok(None);
    };
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|_| String::from("The local vault state is not valid JSON."))
}

pub(crate) fn write_state(state: &Value) -> Result<(), String> {
    let path =
        state_path().ok_or_else(|| String::from("Could not resolve the local data folder."))?;
    let contents = serde_json::to_string(state)
        .map_err(|_| String::from("Could not serialize vault state."))?;
    secure_state::write_vault_state(&path, &contents)
}

fn unlock_with_system_auth() -> bool {
    let Some(path) = state_path() else {
        return false;
    };
    let Ok(Some(metadata)) = secure_state::read_vault_metadata(&path) else {
        return false;
    };
    if !metadata.locked {
        return true;
    }
    if !metadata.system_unlock_enabled {
        return false;
    }

    let strict = metadata.system_unlock_policy != "startup" && metadata.auto_lock_minutes > 0;
    let auth = system_auth::unlock(String::from("unlock Klarkey"), strict);
    if !auth
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return false;
    }

    let Ok(Some(contents)) = secure_state::read_vault_state(&path) else {
        return false;
    };
    let Ok(mut state) = serde_json::from_str::<Value>(&contents) else {
        return false;
    };
    state["locked"] = Value::Bool(false);
    write_state(&state).is_ok()
}

fn state_path() -> Option<PathBuf> {
    platform_local_data_dir().map(|path| path.join(APP_IDENTIFIER).join(STATE_FILE))
}

#[cfg(target_os = "windows")]
fn platform_local_data_dir() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

#[cfg(target_os = "macos")]
fn platform_local_data_dir() -> Option<PathBuf> {
    env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
    })
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn platform_local_data_dir() -> Option<PathBuf> {
    env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| {
        env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
    })
}

pub(crate) fn is_locked(state: Option<&Value>) -> bool {
    let Some(state) = state else {
        return true;
    };
    let has_lock_method = state.get("passcodeHash").is_some()
        || state.get("masterPasswordHash").is_some()
        || state
            .get("systemUnlockEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    state
        .get("locked")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && has_lock_method
}
