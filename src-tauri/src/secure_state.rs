use crate::system_auth;
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use zeroize::Zeroize;

const FORMAT_VERSION: u8 = 2;
const CIPHER: &str = "AES-256-GCM";
const AAD: &[u8] = b"klarkey:vault-state:v2";

#[derive(Deserialize, Serialize)]
struct EncryptedStateFile {
    version: u8,
    cipher: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<VaultStateMetadata>,
    nonce: String,
    ciphertext: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultStateMetadata {
    pub(crate) locked: bool,
    pub(crate) passcode_enabled: bool,
    pub(crate) passcode_set: bool,
    pub(crate) master_password_set: bool,
    pub(crate) system_unlock_enabled: bool,
    pub(crate) auto_lock_minutes: u64,
    #[serde(default = "default_system_unlock_policy")]
    pub(crate) system_unlock_policy: String,
    #[serde(default)]
    pub(crate) ssh_agent_enabled: bool,
    #[serde(default)]
    pub(crate) passkey_index: Vec<Value>,
}

enum DecodedState {
    Encrypted(String),
    Plaintext(String),
}

pub(crate) fn read_vault_state(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path)
        .map_err(|_| String::from("Could not read the local vault state."))?;
    match decode_state(&contents)? {
        DecodedState::Encrypted(plaintext) => Ok(Some(plaintext)),
        DecodedState::Plaintext(plaintext) => {
            write_vault_state(path, &plaintext)?;
            Ok(Some(plaintext))
        }
    }
}

pub(crate) fn write_vault_state(path: &Path, plaintext: &str) -> Result<(), String> {
    let encrypted = encrypt_state(plaintext)?;
    write_private_text(path, &encrypted)
}

pub(crate) fn read_vault_metadata(path: &Path) -> Result<Option<VaultStateMetadata>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path)
        .map_err(|_| String::from("Could not read the local vault state."))?;
    let parsed = serde_json::from_str::<Value>(&contents)
        .map_err(|_| String::from("The local vault state is not valid JSON."))?;
    let looks_encrypted = parsed.get("version").and_then(Value::as_u64)
        == Some(FORMAT_VERSION as u64)
        && parsed.get("cipher").and_then(Value::as_str) == Some(CIPHER);

    if !looks_encrypted {
        return Ok(Some(metadata_from_value(&parsed)));
    }

    let encrypted = serde_json::from_value::<EncryptedStateFile>(parsed)
        .map_err(|_| String::from("The encrypted vault state header is invalid."))?;
    Ok(encrypted
        .metadata
        .or_else(|| Some(legacy_encrypted_metadata())))
}

pub(crate) fn mark_vault_locked(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let contents = fs::read_to_string(path)
        .map_err(|_| String::from("Could not read the local vault state."))?;
    let mut parsed = serde_json::from_str::<Value>(&contents)
        .map_err(|_| String::from("The local vault state is not valid JSON."))?;
    let looks_encrypted = parsed.get("version").and_then(Value::as_u64)
        == Some(FORMAT_VERSION as u64)
        && parsed.get("cipher").and_then(Value::as_str) == Some(CIPHER);

    if looks_encrypted {
        let mut metadata = parsed
            .get("metadata")
            .cloned()
            .and_then(|value| serde_json::from_value::<VaultStateMetadata>(value).ok())
            .unwrap_or_else(legacy_encrypted_metadata);
        metadata.locked = true;
        parsed["metadata"] = serde_json::to_value(metadata)
            .map_err(|_| String::from("Could not update the vault lock state."))?;
    } else {
        parsed["locked"] = Value::Bool(true);
    }

    let updated = serde_json::to_string(&parsed)
        .map_err(|_| String::from("Could not update the vault lock state."))?;
    write_private_text(path, &updated)
}

fn decode_state(contents: &str) -> Result<DecodedState, String> {
    let parsed = serde_json::from_str::<Value>(contents)
        .map_err(|_| String::from("The local vault state is not valid JSON."))?;
    let looks_encrypted = parsed.get("version").and_then(Value::as_u64)
        == Some(FORMAT_VERSION as u64)
        && parsed.get("cipher").and_then(Value::as_str) == Some(CIPHER);

    if !looks_encrypted {
        return Ok(DecodedState::Plaintext(contents.to_string()));
    }

    let encrypted = serde_json::from_value::<EncryptedStateFile>(parsed)
        .map_err(|_| String::from("The encrypted vault state header is invalid."))?;
    let mut key = system_auth::vault_key_bytes()?;
    let plaintext = decrypt_state_with_key(&key, &encrypted);
    key.zeroize();
    plaintext.map(DecodedState::Encrypted)
}

fn encrypt_state(plaintext: &str) -> Result<String, String> {
    serde_json::from_str::<Value>(plaintext)
        .map_err(|_| String::from("Refusing to persist invalid vault state."))?;

    let mut key = system_auth::ensure_vault_key_bytes()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext.as_bytes(),
                aad: AAD,
            },
        )
        .map_err(|_| String::from("Could not encrypt the local vault state."))?;
    key.zeroize();

    serde_json::to_string(&EncryptedStateFile {
        version: FORMAT_VERSION,
        cipher: CIPHER.to_string(),
        metadata: Some(metadata_from_value(
            &serde_json::from_str::<Value>(plaintext)
                .map_err(|_| String::from("Refusing to persist invalid vault state."))?,
        )),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })
    .map_err(|_| String::from("Could not serialize the encrypted vault state."))
}

fn metadata_from_value(state: &Value) -> VaultStateMetadata {
    let settings = state.get("settings").and_then(Value::as_object);
    let passcode_enabled = settings
        .and_then(|settings| settings.get("passcodeEnabled"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let passcode_set = state.get("passcodeHash").is_some();
    let master_password_set = state.get("masterPasswordHash").is_some();
    let system_unlock_enabled = state
        .get("systemUnlockEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let has_lock_method = passcode_set || master_password_set || system_unlock_enabled;
    let locked = state
        .get("locked")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && has_lock_method;
    let auto_lock_minutes = settings
        .and_then(|settings| settings.get("autoLockMinutes"))
        .and_then(Value::as_u64)
        .unwrap_or(15);
    let system_unlock_policy = settings
        .and_then(|settings| settings.get("systemUnlockPolicy"))
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "startup" | "timed"))
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            if auto_lock_minutes <= 0 {
                String::from("startup")
            } else {
                default_system_unlock_policy()
            }
        });
    let ssh_agent_enabled = settings
        .and_then(|settings| settings.get("sshAgentEnabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    VaultStateMetadata {
        locked,
        passcode_enabled,
        passcode_set,
        master_password_set,
        system_unlock_enabled,
        auto_lock_minutes,
        system_unlock_policy,
        ssh_agent_enabled,
        passkey_index: passkey_index_from_state(state),
    }
}

fn legacy_encrypted_metadata() -> VaultStateMetadata {
    VaultStateMetadata {
        locked: true,
        passcode_enabled: true,
        passcode_set: false,
        master_password_set: false,
        system_unlock_enabled: true,
        auto_lock_minutes: 15,
        system_unlock_policy: default_system_unlock_policy(),
        ssh_agent_enabled: false,
        passkey_index: Vec::new(),
    }
}

fn default_system_unlock_policy() -> String {
    String::from("timed")
}

fn passkey_index_from_state(state: &Value) -> Vec<Value> {
    state
        .get("sitePasskeys")
        .and_then(Value::as_array)
        .map(|passkeys| {
            passkeys
                .iter()
                .filter_map(passkey_index_entry)
                .take(200)
                .collect()
        })
        .unwrap_or_default()
}

fn passkey_index_entry(passkey: &Value) -> Option<Value> {
    let credential_id = bounded_metadata_string(passkey, "credentialId", 2048)?;
    let rp_id = bounded_metadata_string(passkey, "rpId", 255)?;
    let mut entry = serde_json::Map::new();
    entry.insert("credentialId".into(), Value::String(credential_id));
    entry.insert("rpId".into(), Value::String(rp_id));

    for (key, max_length) in [
        ("itemId", 256usize),
        ("label", 256usize),
        ("userName", 320usize),
        ("lastUsedAt", 64usize),
    ] {
        if let Some(value) = bounded_metadata_string(passkey, key, max_length) {
            entry.insert(key.into(), Value::String(value));
        }
    }

    Some(Value::Object(entry))
}

fn bounded_metadata_string(value: &Value, key: &str, max_length: usize) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= max_length)
        .map(ToString::to_string)
}

fn decrypt_state_with_key(
    key: &[u8; 32],
    encrypted: &EncryptedStateFile,
) -> Result<String, String> {
    let nonce = STANDARD
        .decode(&encrypted.nonce)
        .map_err(|_| String::from("The encrypted vault nonce is invalid."))?;
    if nonce.len() != 12 {
        return Err(String::from("The encrypted vault nonce is invalid."));
    }
    let ciphertext = STANDARD
        .decode(&encrypted.ciphertext)
        .map_err(|_| String::from("The encrypted vault payload is invalid."))?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: ciphertext.as_ref(),
                aad: AAD,
            },
        )
        .map_err(|_| String::from("Could not decrypt the local vault state."))?;
    String::from_utf8(plaintext).map_err(|_| String::from("The local vault state is invalid."))
}

fn write_private_text(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| String::from("Could not prepare the local vault folder."))?;
    }

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("vault-state.json");
    let temp_name = format!(
        "{file_name}.tmp-{}-{}",
        std::process::id(),
        rand::random::<u64>()
    );
    let temp_path = path.with_file_name(temp_name);
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);

    let mut file = options
        .open(&temp_path)
        .map_err(|_| String::from("Could not write the local vault state."))?;
    file.write_all(contents.as_bytes())
        .map_err(|_| String::from("Could not write the local vault state."))?;
    file.sync_all()
        .map_err(|_| String::from("Could not write the local vault state."))?;
    drop(file);
    fs::rename(&temp_path, path).map_err(|_| {
        let _ = fs::remove_file(&temp_path);
        String::from("Could not write the local vault state.")
    })
}
