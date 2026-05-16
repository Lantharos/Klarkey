use crate::secure_state;
use rsa::{
    pkcs1v15::SigningKey,
    sha2::{Sha256, Sha512},
    signature::SignatureEncoding,
    BigUint, RsaPrivateKey,
};
use serde_json::{json, Value};
use signature::Signer;
use ssh_agent_lib::{
    agent::{listen, Session},
    error::AgentError,
    proto::{signature as agent_signature, Identity, SignRequest},
};
use ssh_key::{
    private::{KeypairData, PrivateKey, RsaKeypair},
    public::KeyData,
    Algorithm, Signature,
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

#[cfg(unix)]
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};

const STATE_FILE: &str = "vault-state.json";

#[derive(Default)]
pub(crate) struct SshAgentState {
    task: Mutex<Option<SshAgentTask>>,
}

struct SshAgentTask {
    socket: String,
    handle: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Clone)]
struct KlarkeySshAgent {
    app: AppHandle,
}

struct AgentKey {
    private_key: PrivateKey,
    pubkey: KeyData,
    comment: String,
}

#[tauri::command]
pub(crate) fn ssh_agent_apply(app: AppHandle, enabled: bool) -> Value {
    if enabled {
        match start(&app) {
            Ok(socket) => status_value(true, true, Some(socket), None),
            Err(message) => {
                stop(&app);
                status_value(false, false, None, Some(message))
            }
        }
    } else {
        stop(&app);
        status_value(false, false, None, None)
    }
}

#[tauri::command]
pub(crate) fn ssh_agent_status(app: AppHandle) -> Value {
    let metadata_enabled = vault_state_path(&app)
        .ok()
        .and_then(|path| secure_state::read_vault_metadata(&path).ok().flatten())
        .is_some_and(|metadata| metadata.ssh_agent_enabled);
    let socket = app
        .state::<SshAgentState>()
        .task
        .lock()
        .ok()
        .and_then(|task| task.as_ref().map(|task| task.socket.clone()));
    status_value(metadata_enabled, socket.is_some(), socket, None::<String>)
}

pub(crate) fn start_from_metadata(app: &AppHandle) {
    let enabled = vault_state_path(app)
        .ok()
        .and_then(|path| secure_state::read_vault_metadata(&path).ok().flatten())
        .is_some_and(|metadata| metadata.ssh_agent_enabled);
    if enabled {
        let _ = start(app);
    }
}

fn start(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<SshAgentState>();
    let mut task = state
        .task
        .lock()
        .map_err(|_| String::from("Could not update the SSH agent state."))?;
    if let Some(task) = task.as_ref() {
        return Ok(task.socket.clone());
    }

    let binding = agent_binding()?;
    prepare_binding(&binding)?;
    let socket = binding.display();
    let handle = spawn_listener(app.clone(), binding)?;
    *task = Some(SshAgentTask {
        socket: socket.clone(),
        handle,
    });
    Ok(socket)
}

fn stop(app: &AppHandle) {
    let Some(state) = app.try_state::<SshAgentState>() else {
        return;
    };
    let Ok(mut task) = state.task.lock() else {
        return;
    };
    if let Some(task) = task.take() {
        task.handle.abort();
        remove_binding(&task.socket);
    }
}

fn status_value(
    enabled: bool,
    running: bool,
    socket: Option<String>,
    message: Option<String>,
) -> Value {
    json!({
        "enabled": enabled,
        "running": running,
        "socket": socket,
        "message": message
    })
}

#[ssh_agent_lib::async_trait]
impl Session for KlarkeySshAgent {
    async fn request_identities(&mut self) -> Result<Vec<Identity>, AgentError> {
        Ok(load_agent_keys(&self.app)
            .unwrap_or_default()
            .into_iter()
            .map(|key| Identity {
                pubkey: key.pubkey,
                comment: key.comment,
            })
            .collect())
    }

    async fn sign(&mut self, request: SignRequest) -> Result<Signature, AgentError> {
        let keys = load_agent_keys(&self.app).map_err(|_| AgentError::Failure)?;
        let Some(key) = keys.into_iter().find(|key| key.pubkey == request.pubkey) else {
            return Err(AgentError::Failure);
        };
        sign_with_agent_flags(&key.private_key, &request.data, request.flags)
            .map_err(|_| AgentError::Failure)
    }
}

fn sign_with_agent_flags(
    private_key: &PrivateKey,
    data: &[u8],
    flags: u32,
) -> Result<Signature, String> {
    let supported_flags = agent_signature::RSA_SHA2_256 | agent_signature::RSA_SHA2_512;
    if flags & !supported_flags != 0 {
        return Err(String::from("Unsupported SSH agent signature flags."));
    }
    match private_key.key_data() {
        KeypairData::Rsa(keypair) => sign_rsa_with_flags(keypair, data, flags),
        _ => {
            if flags != 0 {
                return Err(String::from(
                    "RSA signature flags can only be used with RSA keys.",
                ));
            }
            private_key
                .try_sign(data)
                .map_err(|_| String::from("Could not sign with the SSH key."))
        }
    }
}

fn sign_rsa_with_flags(keypair: &RsaKeypair, data: &[u8], flags: u32) -> Result<Signature, String> {
    if flags & agent_signature::RSA_SHA2_256 != 0 && flags & agent_signature::RSA_SHA2_512 != 0 {
        return Err(String::from(
            "Choose one RSA signature algorithm for the SSH agent request.",
        ));
    }

    let private_key = rsa_private_key_from_ssh_key(keypair)?;
    let (algorithm, signature) = if flags & agent_signature::RSA_SHA2_512 != 0 {
        (
            "rsa-sha2-512",
            SigningKey::<Sha512>::new(private_key)
                .try_sign(data)
                .map_err(|_| String::from("Could not sign with the RSA key."))?,
        )
    } else if flags & agent_signature::RSA_SHA2_256 != 0 {
        (
            "rsa-sha2-256",
            SigningKey::<Sha256>::new(private_key)
                .try_sign(data)
                .map_err(|_| String::from("Could not sign with the RSA key."))?,
        )
    } else {
        (
            "ssh-rsa",
            SigningKey::<sha1::Sha1>::new(private_key)
                .try_sign(data)
                .map_err(|_| String::from("Could not sign with the RSA key."))?,
        )
    };

    Signature::new(
        Algorithm::new(algorithm).map_err(|_| String::from("Unsupported RSA signature."))?,
        signature.to_bytes().to_vec(),
    )
    .map_err(|_| String::from("Could not encode the RSA signature."))
}

fn rsa_private_key_from_ssh_key(keypair: &RsaKeypair) -> Result<RsaPrivateKey, String> {
    RsaPrivateKey::from_components(
        BigUint::try_from(&keypair.public.n)
            .map_err(|_| String::from("Could not read the RSA modulus."))?,
        BigUint::try_from(&keypair.public.e)
            .map_err(|_| String::from("Could not read the RSA exponent."))?,
        BigUint::try_from(&keypair.private.d)
            .map_err(|_| String::from("Could not read the RSA private exponent."))?,
        vec![
            BigUint::try_from(&keypair.private.p)
                .map_err(|_| String::from("Could not read the RSA prime."))?,
            BigUint::try_from(&keypair.private.q)
                .map_err(|_| String::from("Could not read the RSA prime."))?,
        ],
    )
    .map_err(|_| String::from("Could not prepare the RSA key."))
}

fn load_agent_keys(app: &AppHandle) -> Result<Vec<AgentKey>, String> {
    let path = vault_state_path(app)?;
    let Some(metadata) = secure_state::read_vault_metadata(&path)? else {
        return Ok(Vec::new());
    };
    if metadata.locked || !metadata.ssh_agent_enabled {
        return Ok(Vec::new());
    }

    let Some(contents) = secure_state::read_vault_state(&path)? else {
        return Ok(Vec::new());
    };
    let state = serde_json::from_str::<Value>(&contents)
        .map_err(|_| String::from("The local vault state is invalid."))?;
    if !state
        .pointer("/settings/sshAgentEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Ok(Vec::new());
    }

    let keys = state
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("itemType").and_then(Value::as_str) == Some("ssh-key"))
        .filter_map(agent_key_from_item)
        .collect();
    Ok(keys)
}

fn agent_key_from_item(item: &Value) -> Option<AgentKey> {
    let private_key = item.get("sshPrivateKey")?.as_str()?.trim();
    if private_key.is_empty() {
        return None;
    }
    let private_key = PrivateKey::from_openssh(private_key.as_bytes()).ok()?;
    if private_key.is_encrypted() {
        return None;
    }
    let pubkey = private_key.public_key().key_data().clone();
    let comment = item
        .get("sshComment")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| item.get("itemName").and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| private_key.comment())
        .to_string();
    Some(AgentKey {
        private_key,
        pubkey,
        comment,
    })
}

fn vault_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join(STATE_FILE))
        .map_err(|_| String::from("Could not resolve the local data folder."))
}

#[cfg(unix)]
struct AgentBinding {
    path: PathBuf,
}

#[cfg(windows)]
struct AgentBinding {
    pipe: String,
}

#[cfg(unix)]
fn agent_binding() -> Result<AgentBinding, String> {
    let directory = runtime_dir()?.join("klarkey");
    Ok(AgentBinding {
        path: directory.join("ssh-agent.sock"),
    })
}

#[cfg(windows)]
fn agent_binding() -> Result<AgentBinding, String> {
    Ok(AgentBinding {
        pipe: String::from(r"\\.\pipe\klarkey-ssh-agent"),
    })
}

#[cfg(unix)]
fn runtime_dir() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from) {
        return Ok(path);
    }
    Ok(std::env::temp_dir().join(format!("klarkey-{}", current_user_id())))
}

#[cfg(unix)]
fn current_user_id() -> String {
    current_uid().to_string()
}

#[cfg(unix)]
impl AgentBinding {
    fn display(&self) -> String {
        self.path.to_string_lossy().to_string()
    }
}

#[cfg(windows)]
impl AgentBinding {
    fn display(&self) -> String {
        self.pipe.clone()
    }
}

#[cfg(unix)]
fn prepare_binding(binding: &AgentBinding) -> Result<(), String> {
    let parent = binding
        .path
        .parent()
        .ok_or_else(|| String::from("The SSH agent socket path is invalid."))?;
    fs::create_dir_all(parent)
        .map_err(|_| String::from("Could not create the SSH agent folder."))?;
    verify_directory_owner(parent)?;
    set_mode(parent, 0o700)?;
    verify_private_directory(parent)?;
    if let Ok(metadata) = fs::symlink_metadata(&binding.path) {
        if metadata.file_type().is_socket() {
            if metadata.uid() != current_uid() {
                return Err(String::from(
                    "The old SSH agent socket is owned by another user.",
                ));
            }
            fs::remove_file(&binding.path)
                .map_err(|_| String::from("Could not replace the old SSH agent socket."))?;
        } else {
            return Err(String::from("The SSH agent socket path is already in use."));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn prepare_binding(_binding: &AgentBinding) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn spawn_listener(
    app: AppHandle,
    binding: AgentBinding,
) -> Result<tauri::async_runtime::JoinHandle<()>, String> {
    let listener = tokio::net::UnixListener::bind(&binding.path)
        .map_err(|_| String::from("Could not bind the SSH agent socket."))?;
    set_mode(&binding.path, 0o600)?;
    verify_private_socket(&binding.path)?;
    Ok(tauri::async_runtime::spawn(async move {
        if let Err(error) = listen(listener, KlarkeySshAgent { app }).await {
            eprintln!("Klarkey SSH agent stopped: {error}");
        }
    }))
}

#[cfg(windows)]
fn spawn_listener(
    app: AppHandle,
    binding: AgentBinding,
) -> Result<tauri::async_runtime::JoinHandle<()>, String> {
    let listener = ssh_agent_lib::agent::NamedPipeListener::bind(&binding.pipe)
        .map_err(|_| String::from("Could not bind the SSH agent named pipe."))?;
    Ok(tauri::async_runtime::spawn(async move {
        if let Err(error) = listen(listener, KlarkeySshAgent { app }).await {
            eprintln!("Klarkey SSH agent stopped: {error}");
        }
    }))
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| String::from("Could not inspect the SSH agent path."))?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(mode);
    fs::set_permissions(path, permissions)
        .map_err(|_| String::from("Could not restrict the SSH agent path."))
}

#[cfg(unix)]
fn verify_private_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| String::from("Could not inspect the SSH agent folder."))?;
    if !metadata.file_type().is_dir() {
        return Err(String::from(
            "The SSH agent folder must be a normal directory.",
        ));
    }
    verify_owner_and_mode(&metadata, 0o700, "folder")
}

#[cfg(unix)]
fn verify_directory_owner(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| String::from("Could not inspect the SSH agent folder."))?;
    if !metadata.file_type().is_dir() {
        return Err(String::from(
            "The SSH agent folder must be a normal directory.",
        ));
    }
    if metadata.uid() != current_uid() {
        return Err(String::from(
            "The SSH agent folder is owned by another user.",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn verify_private_socket(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| String::from("Could not inspect the SSH agent socket."))?;
    if !metadata.file_type().is_socket() {
        return Err(String::from("The SSH agent path must be a normal socket."));
    }
    verify_owner_and_mode(&metadata, 0o600, "socket")
}

#[cfg(unix)]
fn verify_owner_and_mode(
    metadata: &std::fs::Metadata,
    expected_mode: u32,
    label: &str,
) -> Result<(), String> {
    if metadata.uid() != current_uid() {
        return Err(format!("The SSH agent {label} is owned by another user."));
    }
    if metadata.permissions().mode() & 0o777 != expected_mode {
        return Err(format!("The SSH agent {label} permissions are too broad."));
    }
    Ok(())
}

#[cfg(unix)]
fn current_uid() -> u32 {
    unsafe { libc::geteuid() as u32 }
}

#[cfg(windows)]
fn remove_binding(_socket: &str) {}

#[cfg(unix)]
fn remove_binding(socket: &str) {
    let path = Path::new(socket);
    if path
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.file_type().is_socket())
    {
        let _ = fs::remove_file(path);
    }
}
