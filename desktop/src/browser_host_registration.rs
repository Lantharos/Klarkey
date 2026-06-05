use crate::app_context::AppContext;
use serde_json::json;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::process::Command;
use sysinfo::{ProcessesToUpdate, System};

const HOST_NAME: &str = "app.klarkey.desktop";
const FIREFOX_EXTENSION_ID: &str = "klarkey@example.local";
#[cfg(target_os = "windows")]
const CHROMIUM_EXTENSION_ID: &str = "gbdmdcmboinmeckelhacpljieaphedgn";
const CHROMIUM_EXTENSION_ORIGIN: &str = "chrome-extension://gbdmdcmboinmeckelhacpljieaphedgn/";
#[cfg(target_os = "windows")]
const CHROME_WEB_STORE_UPDATE_URL: &str = "https://clients2.google.com/service/update2/crx";
const ALLOWED_PARENT_NAMES: &[&str] = &[
    "brave",
    "brave browser",
    "brave-browser",
    "brave.exe",
    "chrome",
    "chrome.exe",
    "chromium",
    "chromium-browser",
    "chromium.exe",
    "firefox",
    "firefox-bin",
    "firefox.exe",
    "google chrome",
    "google-chrome",
    "google-chrome-stable",
    "helium",
    "helium.exe",
    "msedge",
    "msedge.exe",
    "microsoft edge",
    "vivaldi",
    "vivaldi.exe",
    "zen",
    "zen-bin",
    "zen.exe",
];

#[cfg(target_os = "windows")]
const WINDOWS_CHROMIUM_REGISTRY_ROOTS: &[&str] = &[
    "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
    "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
    "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts",
    "HKCU\\Software\\Chromium\\NativeMessagingHosts",
    "HKCU\\Software\\imput\\Helium\\NativeMessagingHosts",
    "HKCU\\Software\\Helium\\NativeMessagingHosts",
];

#[cfg(target_os = "windows")]
const WINDOWS_FIREFOX_REGISTRY_ROOTS: &[&str] = &[
    "HKCU\\Software\\Mozilla\\NativeMessagingHosts",
    "HKCU\\Software\\Zen Browser\\NativeMessagingHosts",
    "HKCU\\Software\\Zen\\NativeMessagingHosts",
];

pub(crate) fn is_native_messaging_host_launch() -> bool {
    let has_allowed_caller = env::args().skip(1).any(|arg| {
        normalize_native_messaging_caller(&arg) == CHROMIUM_EXTENSION_ORIGIN
            || arg == FIREFOX_EXTENSION_ID
    });
    has_allowed_caller && has_allowed_native_messaging_parent()
}

pub(crate) fn ensure_native_host_registration(ctx: &AppContext) -> Result<(), String> {
    let executable = env::current_exe()
        .map_err(|_| String::from("Could not resolve the Klarkey executable."))?;
    if cfg!(target_os = "windows") {
        ensure_windows_registration(ctx, &executable)
    } else {
        ensure_unix_registration(&executable)
    }
}

fn normalize_native_messaging_caller(value: &str) -> String {
    if value.starts_with("chrome-extension://") && !value.ends_with('/') {
        format!("{value}/")
    } else {
        value.to_string()
    }
}

fn has_allowed_native_messaging_parent() -> bool {
    if env::var_os("KLARKEY_ALLOW_NATIVE_HOST_SMOKE").is_some() {
        return true;
    }

    let Ok(current_pid) = sysinfo::get_current_pid() else {
        return false;
    };
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let Some(parent_pid) = system
        .process(current_pid)
        .and_then(|process| process.parent())
    else {
        return false;
    };
    let Some(parent) = system.process(parent_pid) else {
        return false;
    };

    let name = parent.name().to_string_lossy().to_ascii_lowercase();
    let executable_name = parent
        .exe()
        .and_then(|path| path.file_name())
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    is_allowed_parent_name(&name) || is_allowed_parent_name(&executable_name)
}

fn is_allowed_parent_name(name: &str) -> bool {
    ALLOWED_PARENT_NAMES.contains(&name)
}

#[cfg(target_os = "windows")]
fn ensure_windows_registration(ctx: &AppContext, executable: &Path) -> Result<(), String> {
    let manifest_dir = ctx.data_dir()?.join("native-messaging-hosts");
    let chromium_manifest = manifest_dir.join("chromium.app.klarkey.desktop.json");
    let firefox_manifest = manifest_dir.join("firefox.app.klarkey.desktop.json");
    write_chromium_manifest(&chromium_manifest, executable)?;
    write_firefox_manifest(&firefox_manifest, executable)?;

    for root in WINDOWS_CHROMIUM_REGISTRY_ROOTS {
        set_registry_default(&format!("{root}\\{HOST_NAME}"), &chromium_manifest)?;
    }
    for root in WINDOWS_FIREFOX_REGISTRY_ROOTS {
        set_registry_default(&format!("{root}\\{HOST_NAME}"), &firefox_manifest)?;
    }
    let _ = set_registry_value(
        &format!("HKCU\\Software\\Google\\Chrome\\Extensions\\{CHROMIUM_EXTENSION_ID}"),
        "update_url",
        CHROME_WEB_STORE_UPDATE_URL,
    );
    let _ = set_registry_value(
        &format!(
            "HKCU\\Software\\BraveSoftware\\Brave-Browser\\Extensions\\{CHROMIUM_EXTENSION_ID}"
        ),
        "update_url",
        CHROME_WEB_STORE_UPDATE_URL,
    );
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn ensure_windows_registration(_ctx: &AppContext, _executable: &Path) -> Result<(), String> {
    Ok(())
}

fn ensure_unix_registration(executable: &Path) -> Result<(), String> {
    for directory in chromium_manifest_dirs() {
        write_chromium_manifest(&directory.join(format!("{HOST_NAME}.json")), executable)?;
    }
    for directory in firefox_manifest_dirs() {
        write_firefox_manifest(&directory.join(format!("{HOST_NAME}.json")), executable)?;
    }
    Ok(())
}

fn chromium_manifest_dirs() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        let support = home_dir().join("Library").join("Application Support");
        return vec![
            support
                .join("Google")
                .join("Chrome")
                .join("NativeMessagingHosts"),
            support.join("Chromium").join("NativeMessagingHosts"),
            support.join("Microsoft Edge").join("NativeMessagingHosts"),
            support
                .join("BraveSoftware")
                .join("Brave-Browser")
                .join("NativeMessagingHosts"),
            support.join("Vivaldi").join("NativeMessagingHosts"),
        ];
    }

    let config = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".config"));
    vec![
        config.join("google-chrome").join("NativeMessagingHosts"),
        config.join("chromium").join("NativeMessagingHosts"),
        config.join("microsoft-edge").join("NativeMessagingHosts"),
        config
            .join("BraveSoftware")
            .join("Brave-Browser")
            .join("NativeMessagingHosts"),
        config.join("vivaldi").join("NativeMessagingHosts"),
    ]
}

fn firefox_manifest_dirs() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        return vec![home_dir()
            .join("Library")
            .join("Application Support")
            .join("Mozilla")
            .join("NativeMessagingHosts")];
    }
    vec![home_dir().join(".mozilla").join("native-messaging-hosts")]
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn write_chromium_manifest(path: &Path, executable: &Path) -> Result<(), String> {
    let executable = executable.to_string_lossy().to_string();
    write_manifest(
        path,
        json!({
            "name": HOST_NAME,
            "description": "Klarkey desktop bridge",
            "path": executable,
            "type": "stdio",
            "allowed_origins": [CHROMIUM_EXTENSION_ORIGIN]
        }),
    )
}

fn write_firefox_manifest(path: &Path, executable: &Path) -> Result<(), String> {
    let executable = executable.to_string_lossy().to_string();
    write_manifest(
        path,
        json!({
            "name": HOST_NAME,
            "description": "Klarkey desktop bridge",
            "path": executable,
            "type": "stdio",
            "allowed_extensions": [FIREFOX_EXTENSION_ID]
        }),
    )
}

fn write_manifest(path: &Path, value: serde_json::Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| String::from("Native host manifest path is invalid."))?;
    ensure_manifest_dir(parent)?;
    if path
        .symlink_metadata()
        .is_ok_and(|metadata| !metadata.is_file())
    {
        return Err(String::from(
            "Native host manifest path must be a normal file.",
        ));
    }
    let payload = serde_json::to_string_pretty(&value)
        .map_err(|_| String::from("Could not serialize the native host manifest."))?
        + "\n";
    fs::write(path, payload)
        .map_err(|_| String::from("Could not write the native host manifest."))?;
    set_file_mode(path, 0o600);
    Ok(())
}

fn ensure_manifest_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|_| String::from("Could not create the native host folder."))?;
    if path
        .symlink_metadata()
        .is_ok_and(|metadata| !metadata.is_dir())
    {
        return Err(String::from(
            "Native host manifest folder must be a normal directory.",
        ));
    }
    set_file_mode(path, 0o700);
    Ok(())
}

#[cfg(unix)]
fn set_file_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(metadata) = path.symlink_metadata() {
        let mut permissions = metadata.permissions();
        permissions.set_mode(mode);
        let _ = fs::set_permissions(path, permissions);
    }
}

#[cfg(not(unix))]
fn set_file_mode(_path: &Path, _mode: u32) {}

#[cfg(target_os = "windows")]
fn set_registry_default(key: &str, manifest_path: &Path) -> Result<(), String> {
    let value = manifest_path.to_string_lossy().to_string();
    run_reg([
        "ADD",
        key,
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        value.as_str(),
        "/f",
    ])
}

#[cfg(target_os = "windows")]
fn set_registry_value(key: &str, name: &str, value: &str) -> Result<(), String> {
    run_reg(["ADD", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"])
}

#[cfg(target_os = "windows")]
fn run_reg<const N: usize>(args: [&str; N]) -> Result<(), String> {
    let status = Command::new("reg")
        .args(args)
        .status()
        .map_err(|_| String::from("Could not update native host registration."))?;
    if status.success() {
        Ok(())
    } else {
        Err(String::from("Could not update native host registration."))
    }
}
