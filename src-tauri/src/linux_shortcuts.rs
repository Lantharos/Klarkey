use crate::windowing;
use futures_util::StreamExt;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
};
use tauri::AppHandle;

const APP_ID: &str = "com.lantharos.klarkey";
const SHORTCUT_ID: &str = "open-palette";
const DESKTOP_FILE_ID: &str = "com.lantharos.klarkey.desktop";
const GNOME_SHORTCUT_PATH: &str =
    "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/klarkey/";
const GNOME_MEDIA_KEYS_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys";
const GNOME_CUSTOM_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding";

struct PortalShortcutTask {
    hotkey: String,
    handle: tauri::async_runtime::JoinHandle<()>,
}

static ACTIVE_PORTAL_HOTKEY: OnceLock<Mutex<Option<PortalShortcutTask>>> = OnceLock::new();
static PORTAL_APP_REGISTERED: OnceLock<Mutex<bool>> = OnceLock::new();

pub fn setup(app: &AppHandle, hotkey: &str) -> bool {
    if !is_wayland_session() {
        return false;
    }
    let Some(portal_trigger) = to_portal_trigger(hotkey) else {
        return false;
    };
    let hotkey = normalize_hotkey(hotkey);
    if !mark_portal_hotkey(&hotkey) {
        return true;
    }

    let fallback_installed = install_desktop_shortcut_fallback(&hotkey);
    let app = app.clone();
    let task_hotkey = hotkey.clone();
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(error) = run_portal_shortcut(app.clone(), portal_trigger).await {
            eprintln!("Klarkey could not register the Linux global shortcut portal: {error}");
            if !fallback_installed && !install_desktop_shortcut_fallback(&hotkey) {
                eprintln!("Klarkey could not install a Linux desktop shortcut fallback.");
            }
        }
        clear_portal_hotkey(&hotkey);
    });
    store_portal_task(task_hotkey, handle);
    true
}

fn mark_portal_hotkey(hotkey: &str) -> bool {
    let lock = ACTIVE_PORTAL_HOTKEY.get_or_init(|| Mutex::new(None));
    let mut active = lock.lock().expect("linux shortcut state poisoned");
    if active.as_ref().is_some_and(|task| task.hotkey == hotkey) {
        return false;
    }
    if let Some(task) = active.take() {
        task.handle.abort();
    }
    true
}

fn store_portal_task(hotkey: String, handle: tauri::async_runtime::JoinHandle<()>) {
    let lock = ACTIVE_PORTAL_HOTKEY.get_or_init(|| Mutex::new(None));
    let mut active = lock.lock().expect("linux shortcut state poisoned");
    *active = Some(PortalShortcutTask { hotkey, handle });
}

fn clear_portal_hotkey(hotkey: &str) {
    let lock = ACTIVE_PORTAL_HOTKEY.get_or_init(|| Mutex::new(None));
    let mut active = lock.lock().expect("linux shortcut state poisoned");
    if active.as_ref().is_some_and(|task| task.hotkey == hotkey) {
        *active = None;
    }
}

async fn run_portal_shortcut(
    app: AppHandle,
    preferred_trigger: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use ashpd::desktop::{
        global_shortcuts::{BindShortcutsOptions, GlobalShortcuts, NewShortcut},
        CreateSessionOptions,
    };

    if !is_wayland_session() {
        return Ok(());
    }

    ensure_portal_app_registration().await?;

    let portal = GlobalShortcuts::new().await?;
    let session = portal
        .create_session(CreateSessionOptions::default())
        .await?;
    let mut activations = portal.receive_activated().await?;

    let shortcut = NewShortcut::new(SHORTCUT_ID, "Open Klarkey")
        .preferred_trigger(Some(preferred_trigger.as_str()));
    let request = portal
        .bind_shortcuts(&session, &[shortcut], None, BindShortcutsOptions::default())
        .await?;
    let response = request.response()?;
    if !response
        .shortcuts()
        .iter()
        .any(|shortcut| shortcut.id() == SHORTCUT_ID)
    {
        return Err("the portal did not bind the Klarkey shortcut".into());
    }

    while let Some(event) = activations.next().await {
        if event.shortcut_id() == SHORTCUT_ID {
            let _ = windowing::open_palette_window_with_activation_token(
                &app,
                activation_token_from_options(event.options()),
            );
        }
    }
    Ok(())
}

fn activation_token_from_options(
    options: &std::collections::HashMap<String, ashpd::zvariant::OwnedValue>,
) -> Option<String> {
    let value = options.get("activation_token")?.try_clone().ok()?;
    String::try_from(value)
        .ok()
        .filter(|token| !token.trim().is_empty())
}

async fn ensure_portal_app_registration() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if portal_app_registered() {
        return Ok(());
    }

    let command = open_palette_command().ok_or("Klarkey executable path is not available")?;
    install_desktop_file(&command)?;
    let app_id = ashpd::AppID::try_from(APP_ID)?;
    match ashpd::register_host_app(app_id).await {
        Ok(()) => {
            mark_portal_app_registered();
            Ok(())
        }
        Err(error) if portal_app_already_registered(&error) => {
            mark_portal_app_registered();
            Ok(())
        }
        Err(error) => Err(Box::new(error)),
    }
}

fn portal_app_registered() -> bool {
    let lock = PORTAL_APP_REGISTERED.get_or_init(|| Mutex::new(false));
    *lock.lock().expect("linux portal app id state poisoned")
}

fn mark_portal_app_registered() {
    let lock = PORTAL_APP_REGISTERED.get_or_init(|| Mutex::new(false));
    *lock.lock().expect("linux portal app id state poisoned") = true;
}

fn portal_app_already_registered(error: &ashpd::Error) -> bool {
    let message = error.to_string();
    message.contains("already associated") || message.contains("already registered")
}

pub fn install_desktop_shortcut_fallback(hotkey: &str) -> bool {
    let Some(command) = open_palette_command() else {
        return false;
    };
    let _ = install_desktop_file(&command);
    install_gnome_shortcut(hotkey, &command)
}

fn install_desktop_file(command: &str) -> std::io::Result<()> {
    let Some(applications_dir) = data_home().map(|path| path.join("applications")) else {
        return Ok(());
    };
    fs::create_dir_all(&applications_dir)?;
    let desktop_file = applications_dir.join(DESKTOP_FILE_ID);
    fs::write(
        desktop_file,
        format!(
            "[Desktop Entry]\nType=Application\nName=Klarkey\nComment=Open Klarkey\nExec={command}\nIcon=klarkey\nTerminal=false\nNoDisplay=true\nStartupNotify=false\nCategories=Utility;\n"
        ),
    )
}

fn install_gnome_shortcut(hotkey: &str, command: &str) -> bool {
    if !desktop_name_contains("gnome") && !desktop_name_contains("ubuntu") {
        return false;
    }
    let Some(binding) = to_gnome_binding(hotkey) else {
        return false;
    };
    if command_output(
        "gsettings",
        &["writable", GNOME_MEDIA_KEYS_SCHEMA, "custom-keybindings"],
    )
    .as_deref()
        != Some("true")
    {
        return false;
    }

    let current = command_output(
        "gsettings",
        &["get", GNOME_MEDIA_KEYS_SCHEMA, "custom-keybindings"],
    )
    .unwrap_or_else(|| String::from("@as []"));
    let mut paths = parse_gsettings_paths(&current);
    if !paths.iter().any(|path| path == GNOME_SHORTCUT_PATH) {
        paths.push(GNOME_SHORTCUT_PATH.to_owned());
        let value = format_gsettings_paths(&paths);
        if !run_command(
            "gsettings",
            &["set", GNOME_MEDIA_KEYS_SCHEMA, "custom-keybindings", &value],
        ) {
            return false;
        }
    }

    let schema = format!("{GNOME_CUSTOM_SCHEMA}:{GNOME_SHORTCUT_PATH}");
    run_command("gsettings", &["set", &schema, "name", "Open Klarkey"])
        && run_command("gsettings", &["set", &schema, "command", command])
        && run_command("gsettings", &["set", &schema, "binding", &binding])
}

fn open_palette_command() -> Option<String> {
    let executable = env::current_exe().ok()?;
    Some(format!("{} --open-palette", desktop_exec_path(&executable)))
}

fn desktop_exec_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    if raw
        .chars()
        .all(|character| !character.is_whitespace() && !matches!(character, '"' | '\\' | '$' | '`'))
    {
        return raw.into_owned();
    }
    format!(
        "\"{}\"",
        raw.replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('$', "\\$")
            .replace('`', "\\`")
    )
}

pub fn is_wayland_session() -> bool {
    env::var_os("WAYLAND_DISPLAY").is_some()
        || env::var("XDG_SESSION_TYPE").is_ok_and(|value| value.eq_ignore_ascii_case("wayland"))
}

fn desktop_name_contains(needle: &str) -> bool {
    env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| env::var("DESKTOP_SESSION"))
        .unwrap_or_default()
        .to_ascii_lowercase()
        .contains(needle)
}

fn data_home() -> Option<PathBuf> {
    env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
}

fn command_output(command: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(command).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn run_command(command: &str, args: &[&str]) -> bool {
    Command::new(command)
        .args(args)
        .status()
        .is_ok_and(|status| status.success())
}

fn parse_gsettings_paths(raw: &str) -> Vec<String> {
    raw.split('\'')
        .enumerate()
        .filter_map(|(index, part)| {
            if index % 2 == 1 && part.starts_with('/') {
                Some(part.to_owned())
            } else {
                None
            }
        })
        .collect()
}

fn format_gsettings_paths(paths: &[String]) -> String {
    let quoted = paths
        .iter()
        .map(|path| format!("'{}'", path.replace('\'', "\\'")))
        .collect::<Vec<_>>()
        .join(", ");
    format!("[{quoted}]")
}

fn normalize_hotkey(hotkey: &str) -> String {
    hotkey
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("+")
}

fn to_portal_trigger(hotkey: &str) -> Option<String> {
    let mut parts = parse_hotkey_parts(hotkey)?;
    if let Some(key) = parts.last_mut() {
        if key.len() == 1 && key.is_ascii() {
            key.make_ascii_lowercase();
        }
    }
    Some(parts.join("+"))
}

fn to_gnome_binding(hotkey: &str) -> Option<String> {
    let parts = parse_hotkey_parts(hotkey)?;
    let key = parts.last()?.to_ascii_lowercase();
    let modifiers = parts[..parts.len().saturating_sub(1)]
        .iter()
        .map(|part| match part.as_str() {
            "CTRL" => "<Control>",
            "ALT" => "<Alt>",
            "SHIFT" => "<Shift>",
            "LOGO" => "<Super>",
            _ => "",
        })
        .collect::<String>();
    Some(format!("{modifiers}{key}"))
}

fn parse_hotkey_parts(hotkey: &str) -> Option<Vec<String>> {
    let mut modifiers = Vec::new();
    let mut key = None;
    for raw_part in hotkey
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        let normalized = match raw_part.to_ascii_lowercase().as_str() {
            "control" | "ctrl" => "CTRL".to_owned(),
            "alt" | "option" => "ALT".to_owned(),
            "shift" => "SHIFT".to_owned(),
            "super" | "meta" | "cmd" | "command" | "logo" => "LOGO".to_owned(),
            value if value.len() == 1 => value.to_ascii_uppercase(),
            value if value.starts_with("key") && value.len() == 4 => {
                value[3..].to_ascii_uppercase()
            }
            _ => return None,
        };
        if matches!(normalized.as_str(), "CTRL" | "ALT" | "SHIFT" | "LOGO") {
            modifiers.push(normalized);
        } else {
            key = Some(normalized);
        }
    }
    let key = key?;
    modifiers.push(key);
    Some(modifiers)
}
