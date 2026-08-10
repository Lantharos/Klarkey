use keyring::{Entry, Error as KeyringError};
use serde_json::{json, Value};
#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
use std::process::Command;
use std::sync::{Mutex, OnceLock};

const KEYCHAIN_SERVICE: &str = "com.lantharos.klarkey";
const VAULT_KEY_USER: &str = "vault-key";

pub(crate) fn support() -> Value {
    let auth = platform_auth_support();
    json!({
        "available": auth.available && keychain_available(),
        "systemAuthenticationAvailable": auth.available,
        "keychainAvailable": keychain_available(),
        "label": auth.label,
        "message": auth.message
    })
}

pub(crate) fn has_vault_key() -> Value {
    json!({ "configured": cached_vault_key().is_some() || read_vault_key().is_ok() })
}

pub(crate) fn ensure_vault_key() -> Value {
    match ensure_vault_key_bytes() {
        Ok(_) => json!({ "success": true, "configured": true }),
        Err(message) if message == "Could not store the vault key." => json!({
            "success": false,
            "configured": false,
            "message": "Could not store the vault key in the system keychain."
        }),
        Err(_) => json!({
            "success": false,
            "configured": false,
            "message": "The system keychain is not available."
        }),
    }
}

fn ensure_vault_key_from_keyring() -> Result<[u8; 32], String> {
    match read_vault_key() {
        Ok(key) => decode_and_cache_vault_key(&key),
        Err(KeyringError::NoEntry) => match store_new_vault_key() {
            Ok(()) => read_vault_key()
                .map_err(|_| String::from("Could not read the vault key."))
                .and_then(|key| decode_and_cache_vault_key(&key)),
            Err(_) => Err(String::from("Could not store the vault key.")),
        },
        Err(_) => Err(String::from("The system keychain is not available.")),
    }
}

pub(crate) fn delete_vault_key() -> Value {
    clear_cached_vault_key();
    match vault_key_entry().and_then(|entry| entry.delete_credential()) {
        Ok(()) | Err(KeyringError::NoEntry) => json!({ "success": true, "configured": false }),
        Err(_) => json!({
            "success": false,
            "configured": true,
            "message": "Could not remove the vault key from the system keychain."
        }),
    }
}

pub(crate) fn unlock(reason: String, _strict: bool) -> Value {
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let keyring_locked = default_secret_collection_locked();
        if _strict {
            if let Err(message) = platform_authenticate(&reason) {
                return json!({ "success": false, "message": message });
            }
        }

        match refresh_vault_key_bytes() {
            Ok(_) => json!({ "success": true, "message": "Vault unlocked." }),
            Err(message) if message == "System unlock is not configured for this vault." => json!({
                "success": false,
                "message": "System unlock is not configured for this vault."
            }),
            Err(_) => json!({
                "success": false,
                "message": if keyring_locked == Some(true) {
                    "The system keyring is locked."
                } else {
                    "The system keyring is unavailable."
                }
            }),
        }
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        if refresh_vault_key_bytes().is_err() {
            return json!({
                "success": false,
                "message": "System unlock is not configured for this vault."
            });
        }

        match platform_authenticate(&reason) {
            Ok(()) => json!({ "success": true, "message": "Vault unlocked." }),
            Err(message) => json!({ "success": false, "message": message }),
        }
    }
}

fn keychain_available() -> bool {
    vault_key_entry().is_ok()
}

fn vault_key_entry() -> Result<Entry, KeyringError> {
    Entry::new(KEYCHAIN_SERVICE, VAULT_KEY_USER)
}

fn read_vault_key() -> Result<String, KeyringError> {
    vault_key_entry()?.get_password()
}

pub(crate) fn ensure_vault_key_bytes() -> Result<[u8; 32], String> {
    if let Some(key) = cached_vault_key() {
        return Ok(key);
    }
    ensure_vault_key_from_keyring()
}

pub(crate) fn vault_key_bytes() -> Result<[u8; 32], String> {
    if let Some(key) = cached_vault_key() {
        return Ok(key);
    }
    refresh_vault_key_bytes()
}

fn refresh_vault_key_bytes() -> Result<[u8; 32], String> {
    match read_vault_key() {
        Ok(key) => decode_and_cache_vault_key(&key),
        Err(KeyringError::NoEntry) => Err(String::from(
            "System unlock is not configured for this vault.",
        )),
        Err(_) => Err(String::from("The vault key is not available.")),
    }
}

pub(crate) fn clear_cached_vault_key() {
    if let Ok(mut cache) = vault_key_cache().lock() {
        if let Some(mut key) = cache.take() {
            use zeroize::Zeroize;
            key.zeroize();
        }
    }
}

fn store_new_vault_key() -> Result<(), KeyringError> {
    let key = hex::encode(rand::random::<[u8; 32]>());
    vault_key_entry().and_then(|entry| entry.set_password(&key))
}

fn decode_vault_key(value: &str) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    hex::decode_to_slice(value, &mut key).map_err(|_| String::from("Invalid vault key."))?;
    Ok(key)
}

fn decode_and_cache_vault_key(value: &str) -> Result<[u8; 32], String> {
    let key = decode_vault_key(value)?;
    cache_vault_key(key);
    Ok(key)
}

fn vault_key_cache() -> &'static Mutex<Option<[u8; 32]>> {
    static CACHE: OnceLock<Mutex<Option<[u8; 32]>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn cached_vault_key() -> Option<[u8; 32]> {
    vault_key_cache().lock().ok().and_then(|cache| *cache)
}

fn cache_vault_key(key: [u8; 32]) {
    if let Ok(mut cache) = vault_key_cache().lock() {
        *cache = Some(key);
    }
}

struct AuthSupport {
    available: bool,
    label: &'static str,
    message: &'static str,
}

#[cfg(target_os = "windows")]
fn platform_auth_support() -> AuthSupport {
    use windows::Security::Credentials::UI::{
        UserConsentVerifier, UserConsentVerifierAvailability,
    };

    let available = UserConsentVerifier::CheckAvailabilityAsync()
        .and_then(|operation| operation.join())
        .is_ok_and(|availability| availability == UserConsentVerifierAvailability::Available);
    AuthSupport {
        available,
        label: "Windows Hello",
        message: if available {
            "Windows Hello is available."
        } else {
            "Windows Hello is not configured for this Windows account."
        },
    }
}

#[cfg(target_os = "windows")]
fn platform_authenticate(reason: &str) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier};

    let message = HSTRING::from(non_empty_reason(reason));
    let result = UserConsentVerifier::RequestVerificationAsync(&message)
        .and_then(|operation| operation.join())
        .map_err(|_| String::from("Windows Hello verification is unavailable."))?;
    match result {
        UserConsentVerificationResult::Verified => Ok(()),
        UserConsentVerificationResult::Canceled => {
            Err(String::from("Windows Hello verification was canceled."))
        }
        UserConsentVerificationResult::DeviceBusy => {
            Err(String::from("Windows Hello is busy right now."))
        }
        UserConsentVerificationResult::DeviceNotPresent => Err(String::from(
            "This device does not have Windows Hello set up.",
        )),
        UserConsentVerificationResult::DisabledByPolicy => {
            Err(String::from("Windows Hello is disabled by policy."))
        }
        UserConsentVerificationResult::NotConfiguredForUser => Err(String::from(
            "Windows Hello is not configured for this Windows account.",
        )),
        _ => Err(String::from("Windows Hello verification failed.")),
    }
}

#[cfg(target_os = "macos")]
fn platform_auth_support() -> AuthSupport {
    use objc2_local_authentication::{LAContext, LAPolicy};

    let context = unsafe { LAContext::new() };
    let available = unsafe {
        context
            .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication)
            .is_ok()
    };
    AuthSupport {
        available,
        label: "Touch ID",
        message: if available {
            "System authentication is available."
        } else {
            "Touch ID or password authentication is not available for this Mac account."
        },
    }
}

#[cfg(target_os = "macos")]
fn platform_authenticate(reason: &str) -> Result<(), String> {
    use block2::StackBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::mpsc;
    use std::time::Duration;

    let context = unsafe { LAContext::new() };
    unsafe {
        context
            .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication)
            .map_err(|_| String::from("System authentication is not available on this Mac."))?;
    }

    let reason = NSString::from_str(non_empty_reason(reason));
    let (sender, receiver) = mpsc::channel();
    let block = StackBlock::new(move |success: Bool, _error: *mut NSError| {
        let _ = sender.send(success.as_bool());
    });
    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthentication,
            &reason,
            &block,
        );
    }

    match receiver.recv_timeout(Duration::from_secs(90)) {
        Ok(true) => Ok(()),
        Ok(false) => Err(String::from("System authentication was canceled.")),
        Err(_) => Err(String::from("System authentication timed out.")),
    }
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn platform_auth_support() -> AuthSupport {
    let available = linux_command_available("pkexec");
    AuthSupport {
        available,
        label: "polkit",
        message: if available {
            "polkit authentication is available."
        } else {
            "Install polkit or start a polkit authentication agent to use system unlock."
        },
    }
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn platform_authenticate(_reason: &str) -> Result<(), String> {
    let true_path = if std::path::Path::new("/usr/bin/true").exists() {
        "/usr/bin/true"
    } else {
        "true"
    };
    let status = Command::new("pkexec")
        .arg(true_path)
        .status()
        .map_err(|_| {
            String::from("polkit authentication is not available on this Linux session.")
        })?;
    if status.success() {
        Ok(())
    } else {
        Err(String::from(
            "polkit authentication was canceled or denied.",
        ))
    }
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn default_secret_collection_locked() -> Option<bool> {
    use dbus_secret_service::{EncryptionType, SecretService};

    let service = SecretService::connect_with_max_prompt_timeout(EncryptionType::Plain, 0).ok()?;
    let collection = service.get_default_collection().ok()?;
    collection.is_locked().ok()
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn linux_command_available(command: &str) -> bool {
    ["/usr/local/bin", "/usr/bin", "/bin"]
        .into_iter()
        .any(|directory| std::path::Path::new(directory).join(command).is_file())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn non_empty_reason(reason: &str) -> &str {
    let trimmed = reason.trim();
    if trimmed.is_empty() {
        "unlock Klarkey"
    } else {
        trimmed
    }
}
