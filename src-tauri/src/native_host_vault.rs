use crate::native_host_items::{
    field_suggestions, fill_login, fill_record, list_site_matches, save_login,
};
use crate::native_host_webauthn::{
    create_passkey_credential, discard_passkey_credential, get_passkey_credential, passkeys_status,
    plan_passkey_create, plan_passkey_get, plan_passkey_get_from_index, save_passkey_credential,
};
use crate::secure_state;
use crate::system_auth;
use serde_json::{json, Value};
use std::env;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const APP_IDENTIFIER: &str = "com.lantharos.klarkey";
const STATE_FILE: &str = "vault-state.json";
const UNLOCK_PROMPT_THROTTLE_MS: u64 = 10_000;

static LAST_UNLOCK_PROMPT_MS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn response_for(request: Value) -> Value {
    let id = response_id(&request);
    let request_type = request.get("type").and_then(Value::as_str);

    match request_type {
        Some("ping") => {
            let state = readable_state();
            ok_response(
                id,
                json!({
                    "protocolVersion": 1,
                    "desktopRequired": true,
                    "passkeyProviderReady": false,
                    "nativeUserVerificationReady": system_auth_ready(),
                    "vaultUnlocked": !is_locked(state.as_ref()),
                    "availability": "online"
                }),
            )
        }
        Some("get-settings") => {
            let state = readable_state();
            ok_response(id, json!({ "settings": settings_from(state.as_ref()) }))
        }
        Some("request-unlock") => {
            if metadata_locked() {
                return locked_response(id);
            }
            ok_response(
                id,
                json!({
                    "status": "success",
                    "title": "Vault ready",
                    "message": "Klarkey is unlocked."
                }),
            )
        }
        Some("list-logins") => {
            let (state, locked) = listing_state();
            let url = string_value(&request, "url").unwrap_or_default();
            let mut result = json!({ "matches": list_site_matches(state.as_ref(), &url) });
            if locked {
                result["locked"] = json!(true);
            }
            ok_response(id, result)
        }
        Some("get-login") => {
            let state = match checked_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(state.as_ref()) {
                return locked_response(id);
            }
            let item_id = string_value(&request, "itemId").unwrap_or_default();
            let url = string_value(&request, "url").unwrap_or_default();
            ok_response(
                id,
                json!({ "login": fill_login(state.as_ref(), &item_id, &url) }),
            )
        }
        Some("get-identity") => {
            let state = match checked_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(state.as_ref()) {
                return locked_response(id);
            }
            let item_id = string_value(&request, "itemId").unwrap_or_default();
            ok_response(
                id,
                json!({ "identity": fill_record(state.as_ref(), &item_id, "identity") }),
            )
        }
        Some("get-card") => {
            let state = match checked_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(state.as_ref()) {
                return locked_response(id);
            }
            let item_id = string_value(&request, "itemId").unwrap_or_default();
            ok_response(
                id,
                json!({ "card": fill_record(state.as_ref(), &item_id, "card") }),
            )
        }
        Some("list-field-suggestions") => {
            let (state, locked) = listing_state();
            let field = string_value(&request, "field").unwrap_or_default();
            let flow = string_value(&request, "flow").unwrap_or_default();
            let url = string_value(&request, "url").unwrap_or_default();
            let mut result = json!({ "suggestions": field_suggestions(state.as_ref(), &field, &flow, &url, locked) });
            if locked {
                result["locked"] = json!(true);
            }
            ok_response(id, result)
        }
        Some("save-login") => {
            let mut state = match editable_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(Some(&state)) {
                return locked_response(id);
            }
            let result = save_login(&mut state, request.get("payload"));
            if result.get("status").and_then(Value::as_str) == Some("success") {
                let _ = write_state(&state);
            }
            ok_response(id, result)
        }
        Some("passkeys-status") => {
            let state = readable_state();
            let url = string_value(&request, "url").unwrap_or_default();
            ok_response(
                id,
                passkeys_status(state.as_ref(), &url, is_locked(state.as_ref())),
            )
        }
        Some("passkey-create-plan") => {
            let state = readable_state();
            let url = string_value(&request, "url").unwrap_or_default();
            let request_json = string_value(&request, "requestDetailsJson").unwrap_or_default();
            ok_response(id, plan_passkey_create(state.as_ref(), &url, &request_json))
        }
        Some("passkey-create-credential") => {
            let mut state = match editable_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(Some(&state)) {
                return locked_response(id);
            }
            let origin = string_value(&request, "origin").unwrap_or_default();
            let url = string_value(&request, "url").unwrap_or_default();
            let request_json = string_value(&request, "requestDetailsJson").unwrap_or_default();
            let result = create_passkey_credential(&mut state, &origin, &url, &request_json);
            if result.get("responseJson").is_some() {
                let _ = write_state(&state);
            }
            ok_response(id, result)
        }
        Some("passkey-save-credential") => {
            let mut state = match editable_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(Some(&state)) {
                return locked_response(id);
            }
            let url = string_value(&request, "url").unwrap_or_default();
            let request_json = string_value(&request, "requestDetailsJson").unwrap_or_default();
            let pending_id = string_value(&request, "pendingPasskeyId").unwrap_or_default();
            let item_id = request.get("itemId").and_then(Value::as_str);
            let create_new = request
                .get("createNew")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let result = save_passkey_credential(
                &mut state,
                &pending_id,
                &url,
                &request_json,
                item_id,
                create_new,
            );
            if result.get("status").and_then(Value::as_str) == Some("success") {
                let _ = write_state(&state);
            }
            ok_response(id, result)
        }
        Some("passkey-discard-credential") => {
            let mut state = match editable_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            let pending_id = string_value(&request, "pendingPasskeyId").unwrap_or_default();
            let result = discard_passkey_credential(&mut state, &pending_id);
            let _ = write_state(&state);
            ok_response(id, result)
        }
        Some("passkey-get-plan") => {
            let url = string_value(&request, "url").unwrap_or_default();
            let request_json = string_value(&request, "requestDetailsJson").unwrap_or_default();
            let unlock = request
                .get("unlock")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !unlock {
                if let Some(metadata) = vault_metadata() {
                    if metadata.locked {
                        return ok_response(
                            id,
                            plan_passkey_get_from_index(
                                &metadata.passkey_index,
                                &url,
                                &request_json,
                            ),
                        );
                    }
                }
            }
            let state = match checked_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            ok_response(
                id,
                plan_passkey_get(
                    state.as_ref(),
                    &url,
                    &request_json,
                    is_locked(state.as_ref()),
                ),
            )
        }
        Some("passkey-get-credential") => {
            let mut state = match editable_state(&id) {
                Ok(state) => state,
                Err(response) => return response,
            };
            if is_locked(Some(&state)) {
                return locked_response(id);
            }
            let origin = string_value(&request, "origin").unwrap_or_default();
            let url = string_value(&request, "url").unwrap_or_default();
            let request_json = string_value(&request, "requestDetailsJson").unwrap_or_default();
            let credential_id = string_value(&request, "credentialId").unwrap_or_default();
            let result =
                get_passkey_credential(&mut state, &origin, &url, &request_json, &credential_id);
            if result.get("responseJson").is_some() {
                let _ = write_state(&state);
            }
            ok_response(id, result)
        }
        Some("__invalid_json") => error_response(
            id,
            "invalid_json",
            "The browser request was not valid JSON.",
        ),
        Some(_) | None => error_response(
            id,
            "unsupported_request",
            "The requested browser extension action is not supported.",
        ),
    }
}

fn ok_response(id: String, result: Value) -> Value {
    json!({
        "id": id,
        "ok": true,
        "result": result
    })
}

fn locked_response(id: String) -> Value {
    prompt_desktop_unlock();
    ok_response(id, locked_result())
}

fn system_auth_ready() -> bool {
    system_auth::support()
        .get("available")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn prompt_desktop_unlock() {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let last = LAST_UNLOCK_PROMPT_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) < UNLOCK_PROMPT_THROTTLE_MS {
        return;
    }
    LAST_UNLOCK_PROMPT_MS.store(now, Ordering::Relaxed);

    let Ok(executable) = env::current_exe() else {
        return;
    };
    let mut command = Command::new(executable);
    command
        .arg("--external-unlock")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let _ = command.spawn();
}

pub(crate) fn error_response(id: String, code: &str, message: &str) -> Value {
    json!({
        "id": id,
        "ok": false,
        "error": {
            "code": code,
            "message": message
        }
    })
}

pub(crate) fn response_id(value: &Value) -> String {
    value
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string()
}

fn string_value(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

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

fn default_state() -> Value {
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

fn settings_from(state: Option<&Value>) -> Value {
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

fn readable_state() -> Option<Value> {
    if metadata_locked() {
        return None;
    }
    read_state().ok().flatten()
}

fn listing_state() -> (Option<Value>, bool) {
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

fn checked_state(id: &str) -> Result<Option<Value>, Value> {
    if metadata_locked() && !unlock_with_system_auth() {
        return Ok(None);
    }
    read_state().map_err(|message| error_response(id.to_string(), "vault_unavailable", &message))
}

fn editable_state(id: &str) -> Result<Value, Value> {
    if metadata_locked() && !unlock_with_system_auth() {
        return Err(locked_response(id.to_string()));
    }
    checked_state(id).map(|state| state.unwrap_or_else(default_state))
}

fn metadata_locked() -> bool {
    vault_metadata()
        .map(|metadata| metadata.locked)
        .unwrap_or(false)
}

fn vault_metadata() -> Option<secure_state::VaultStateMetadata> {
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

fn write_state(state: &Value) -> Result<(), String> {
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

fn is_locked(state: Option<&Value>) -> bool {
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

fn locked_result() -> Value {
    json!({
        "status": "locked",
        "title": "Vault locked",
        "message": "Unlock Klarkey to continue."
    })
}
