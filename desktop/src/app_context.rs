use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use fenestra_cef::BridgeEventEmitter;

use crate::{
    deep_links::DeepLinkState, desktop_integration::DesktopIntegrationState,
    ssh_agent::SshAgentState, system_commands::FileAccessState,
};

const APP_IDENTIFIER: &str = "com.lantharos.klarkey";
const STATE_FILE: &str = "vault-state.json";

#[derive(Clone)]
pub(crate) struct AppContext {
    root_dir: Arc<PathBuf>,
    data_dir: Arc<PathBuf>,
    file_access: Arc<FileAccessState>,
    deep_links: Arc<DeepLinkState>,
    desktop_integration: Arc<DesktopIntegrationState>,
    ssh_agent: Arc<SshAgentState>,
    runtime: Arc<tokio::runtime::Runtime>,
    bridge_events: Arc<Mutex<Option<BridgeEventEmitter>>>,
}

impl AppContext {
    pub(crate) fn new(root_dir: PathBuf) -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("Could not start Klarkey runtime: {error}"))?;
        Ok(Self {
            root_dir: Arc::new(root_dir),
            data_dir: Arc::new(app_data_dir()),
            file_access: Arc::new(FileAccessState::default()),
            deep_links: Arc::new(DeepLinkState::default()),
            desktop_integration: Arc::new(DesktopIntegrationState::default()),
            ssh_agent: Arc::new(SshAgentState::default()),
            runtime: Arc::new(runtime),
            bridge_events: Arc::new(Mutex::new(None)),
        })
    }

    pub(crate) fn root_dir(&self) -> &Path {
        self.root_dir.as_ref()
    }

    pub(crate) fn data_dir(&self) -> Result<PathBuf, String> {
        fs::create_dir_all(self.data_dir.as_ref())
            .map_err(|_| String::from("Could not create the local data folder."))?;
        Ok((*self.data_dir).clone())
    }

    pub(crate) fn vault_state_path(&self) -> Result<PathBuf, String> {
        Ok(self.data_dir()?.join(STATE_FILE))
    }

    pub(crate) fn file_access(&self) -> &FileAccessState {
        self.file_access.as_ref()
    }

    pub(crate) fn deep_links(&self) -> &DeepLinkState {
        self.deep_links.as_ref()
    }

    pub(crate) fn desktop_integration(&self) -> &DesktopIntegrationState {
        self.desktop_integration.as_ref()
    }

    pub(crate) fn ssh_agent(&self) -> &SshAgentState {
        self.ssh_agent.as_ref()
    }

    pub(crate) fn runtime(&self) -> &tokio::runtime::Runtime {
        self.runtime.as_ref()
    }

    pub(crate) fn set_bridge_event_emitter(&self, emitter: Option<BridgeEventEmitter>) {
        if let Ok(mut events) = self.bridge_events.lock() {
            *events = emitter;
        }
    }

    pub(crate) fn emit(&self, name: impl Into<String>, payload: serde_json::Value) -> bool {
        self.bridge_events
            .lock()
            .ok()
            .and_then(|events| events.clone())
            .is_some_and(|emitter| emitter.emit(name, payload))
    }

    pub(crate) fn hide_window(&self) -> bool {
        self.bridge_events
            .lock()
            .ok()
            .and_then(|events| events.clone())
            .is_some_and(|emitter| emitter.hide())
    }
}

pub(crate) fn app_identifier() -> &'static str {
    APP_IDENTIFIER
}

fn app_data_dir() -> PathBuf {
    platform_local_data_dir().join(APP_IDENTIFIER)
}

#[cfg(target_os = "windows")]
fn platform_local_data_dir() -> PathBuf {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join("AppData").join("Local"))
}

#[cfg(target_os = "macos")]
fn platform_local_data_dir() -> PathBuf {
    home_dir().join("Library").join("Application Support")
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn platform_local_data_dir() -> PathBuf {
    env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".local").join("share"))
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(".").to_path_buf())
}
