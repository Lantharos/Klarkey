use serde_json::json;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub(crate) struct DeepLinkState {
    pending_oauth_callbacks: Mutex<Vec<String>>,
}

pub(crate) fn emit_oauth_callbacks(
    app: &AppHandle,
    values: impl IntoIterator<Item = String>,
) -> bool {
    emit_filtered_oauth_callbacks(app, values, true)
}

pub(crate) fn queue_oauth_callbacks(
    app: &AppHandle,
    values: impl IntoIterator<Item = String>,
) -> bool {
    emit_filtered_oauth_callbacks(app, values, true)
}

#[tauri::command]
pub(crate) fn oauth_pending_callbacks(state: State<DeepLinkState>) -> Vec<String> {
    std::mem::take(
        &mut *state
            .pending_oauth_callbacks
            .lock()
            .expect("deep link state lock poisoned"),
    )
}

fn emit_filtered_oauth_callbacks(
    app: &AppHandle,
    values: impl IntoIterator<Item = String>,
    queue: bool,
) -> bool {
    let urls = values
        .into_iter()
        .filter(|value| is_oauth_callback(value))
        .collect::<Vec<_>>();
    if urls.is_empty() {
        return false;
    }
    if queue {
        let state = app.state::<DeepLinkState>();
        let mut pending = state
            .pending_oauth_callbacks
            .lock()
            .expect("deep link state lock poisoned");
        for url in &urls {
            if !pending.iter().any(|queued| queued == url) {
                pending.push(url.clone());
            }
        }
        if pending.len() > 16 {
            let drop_count = pending.len() - 16;
            pending.drain(0..drop_count);
        }
    }
    let _ = app.emit("oauth-callback", json!({ "urls": urls }));
    true
}

fn is_oauth_callback(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    url.scheme() == "klarkey" && url.host_str() == Some("oauth") && url.path() == "/callback"
}
