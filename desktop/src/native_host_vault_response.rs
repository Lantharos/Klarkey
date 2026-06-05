use crate::system_auth;
use serde_json::{json, Value};
use std::env;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const UNLOCK_PROMPT_THROTTLE_MS: u64 = 10_000;
static LAST_UNLOCK_PROMPT_MS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn ok_response(id: String, result: Value) -> Value {
    json!({
        "id": id,
        "ok": true,
        "result": result
    })
}

pub(crate) fn locked_response(id: String) -> Value {
    prompt_desktop_unlock();
    ok_response(id, locked_result())
}

pub(crate) fn system_auth_ready() -> bool {
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

pub(crate) fn string_value(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn locked_result() -> Value {
    json!({
        "status": "locked",
        "title": "Vault locked",
        "message": "Unlock Klarkey to continue."
    })
}
