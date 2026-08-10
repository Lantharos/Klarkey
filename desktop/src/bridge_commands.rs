#[cfg(target_os = "linux")]
use std::{
    env, fs,
    path::{Path, PathBuf},
};

use sabine::{
    BridgeCommand, BridgeCommandDescriptor, BridgeError, BridgeResponse, BridgeResult, SabineWindow,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

#[cfg(target_os = "linux")]
use crate::app_context;
use crate::{
    app_context::AppContext, deep_links, external_url, ssh_agent, sync_config, system_auth,
    system_commands,
};

#[cfg(target_os = "linux")]
const APP_NAME: &str = "Klarkey";

pub(crate) fn register_commands(
    mut window: SabineWindow,
    ctx: AppContext,
    initial_external_unlock: bool,
    initial_open_palette: bool,
) -> SabineWindow {
    macro_rules! command {
        ($name:literal, $handler:expr) => {{
            window = window.bridge_descriptor_handler(
                BridgeCommandDescriptor::new($name).target("desktop"),
                $handler,
            );
        }};
    }

    command!("app_launch_context", move |_| {
        json_ok(json!({
            "externalUnlock": initial_external_unlock,
            "openPalette": initial_open_palette,
        }))
    });

    let context = ctx.clone();
    command!("palette_open", move |command| {
        let input = params_or_default::<PaletteOpenParams>(&command)?;
        let prepared = prepare_palette_open(input.external_unlock.unwrap_or(false));
        context.focus_window(input.activation_token.as_deref());
        json_ok(prepared)
    });

    command!("system_auth_support", move |_| {
        json_ok(system_auth::support())
    });
    command!("system_auth_has_vault_key", move |_| {
        json_ok(system_auth::has_vault_key())
    });
    command!("system_auth_ensure_vault_key", move |_| {
        json_ok(system_auth::ensure_vault_key())
    });
    command!("system_auth_delete_vault_key", move |_| {
        json_ok(system_auth::delete_vault_key())
    });

    command!("system_auth_unlock", move |command| {
        let input: SystemAuthUnlockParams = params(&command)?;
        json_ok(system_auth::unlock(
            input.reason,
            input.strict.unwrap_or(false),
        ))
    });

    command!("clipboard_copy_secret", move |command| {
        let input: ClipboardCopyParams = params(&command)?;
        json_ok(system_commands::clipboard_copy_secret(
            input.value,
            input.timeout_seconds,
        ))
    });

    let context = ctx.clone();
    command!("oauth_pending_callbacks", move |_| {
        json_ok(deep_links::oauth_pending_callbacks(&context))
    });

    command!("sync_config", move |_| json_ok(sync_config::sync_config()));

    command!("open_external_url", move |command| {
        let input: UrlParams = params(&command)?;
        json_result(external_url::open(input.url))
    });

    let context = ctx.clone();
    command!("pick_import_file", move |command| {
        let input: FormatParams = params(&command)?;
        json_ok(system_commands::pick_import_file(&context, input.format))
    });

    let context = ctx.clone();
    command!("pick_export_file", move |command| {
        let input: FormatParams = params(&command)?;
        json_ok(system_commands::pick_export_file(&context, input.format))
    });

    let context = ctx.clone();
    command!("read_text_file", move |command| {
        let input: PathParams = params(&command)?;
        json_result(system_commands::read_text_file(&context, input.path))
    });

    let context = ctx.clone();
    command!("read_binary_file", move |command| {
        let input: PathParams = params(&command)?;
        json_result(system_commands::read_binary_file(&context, input.path))
    });

    let context = ctx.clone();
    command!("write_text_file", move |command| {
        let input: WriteTextParams = params(&command)?;
        json_result(system_commands::write_text_file(
            &context,
            input.path,
            input.contents,
        ))
    });

    let context = ctx.clone();
    command!("load_vault_metadata", move |_| {
        json_result(system_commands::load_vault_metadata(&context))
    });

    let context = ctx.clone();
    command!("lock_vault_metadata", move |_| {
        json_result(system_commands::lock_vault_metadata(&context))
    });

    let context = ctx.clone();
    command!("unlock_vault_with_secret", move |command| {
        let input: UnlockWithSecretParams = params(&command)?;
        json_ok(system_commands::unlock_vault_with_secret(
            &context,
            input.kind,
            input.secret,
        ))
    });

    let context = ctx.clone();
    command!("unlock_vault_with_system", move |command| {
        let input: UnlockWithSystemParams = params(&command)?;
        json_ok(system_commands::unlock_vault_with_system(
            &context,
            input.reason,
            input.strict,
        ))
    });

    let context = ctx.clone();
    command!("load_vault_state", move |_| {
        json_result(system_commands::load_vault_state(&context))
    });

    let context = ctx.clone();
    command!("save_vault_state", move |command| {
        let input: SaveVaultStateParams = params(&command)?;
        json_result(system_commands::save_vault_state(&context, input.contents))
    });

    let context = ctx.clone();
    command!("reset_vault_state", move |_| {
        json_result(system_commands::reset_vault_state(&context))
    });

    let context = ctx.clone();
    command!("ssh_agent_apply", move |command| {
        let input: SshAgentApplyParams = params(&command)?;
        json_ok(ssh_agent::ssh_agent_apply(&context, input.enabled))
    });

    let context = ctx.clone();
    command!("ssh_agent_status", move |_| {
        json_ok(ssh_agent::ssh_agent_status(&context))
    });

    command!("autostart_status", move |_| json_ok(autostart_status()));

    command!("autostart_set", move |command| {
        let input: AutostartSetParams = params(&command)?;
        json_ok(autostart_set(input.enabled))
    });

    window
}

fn prepare_palette_open(external_unlock: bool) -> Value {
    json!({
        "externalUnlock": external_unlock,
        "nativeTranslucent": true,
        "nativeContentTranslucent": true,
        "nativeHostTranslucent": false,
    })
}

fn params<T: DeserializeOwned>(command: &BridgeCommand) -> Result<T, BridgeError> {
    serde_json::from_value(command.params.clone())
        .map_err(|error| BridgeError::new(format!("Invalid {} params: {error}", command.name)))
}

fn params_or_default<T>(command: &BridgeCommand) -> Result<T, BridgeError>
where
    T: DeserializeOwned + Default,
{
    if command.params.is_null() {
        return Ok(T::default());
    }
    params(command)
}

fn json_ok<T: Serialize>(value: T) -> BridgeResult {
    serde_json::to_value(value)
        .map(BridgeResponse::json)
        .map_err(|error| BridgeError::new(error.to_string()))
}

fn json_result<T: Serialize>(result: Result<T, String>) -> BridgeResult {
    result
        .and_then(|value| serde_json::to_value(value).map_err(|error| error.to_string()))
        .map(BridgeResponse::json)
        .map_err(BridgeError::new)
}

fn autostart_status() -> bool {
    #[cfg(target_os = "linux")]
    {
        autostart_path().is_some_and(|path| path.is_file())
    }

    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

fn autostart_set(enabled: bool) -> bool {
    #[cfg(target_os = "linux")]
    {
        let Some(path) = autostart_path() else {
            return false;
        };
        if !enabled {
            match fs::remove_file(path) {
                Ok(()) => return false,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return false,
                Err(_) => return false,
            }
        }
        let Ok(executable) = env::current_exe() else {
            return false;
        };
        let contents = format!(
            "[Desktop Entry]\nType=Application\nName={APP_NAME}\nExec={}\nIcon={}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
            desktop_exec(&executable),
            desktop_value(app_context::app_identifier()),
        );
        if let Some(parent) = path.parent() {
            if fs::create_dir_all(parent).is_err() {
                return false;
            }
        }
        fs::write(path, contents).is_ok()
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = enabled;
        false
    }
}

#[cfg(target_os = "linux")]
fn autostart_path() -> Option<PathBuf> {
    let config_home = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(
        config_home
            .join("autostart")
            .join(format!("{}.desktop", app_context::app_identifier())),
    )
}

#[cfg(target_os = "linux")]
fn desktop_exec(path: &Path) -> String {
    let value = path.display().to_string();
    if value.contains(' ') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value
    }
}

#[cfg(target_os = "linux")]
fn desktop_value(value: &str) -> String {
    value.replace(['\n', '\r'], " ")
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaletteOpenParams {
    external_unlock: Option<bool>,
    activation_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemAuthUnlockParams {
    reason: String,
    strict: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardCopyParams {
    value: String,
    timeout_seconds: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UrlParams {
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormatParams {
    format: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathParams {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteTextParams {
    path: String,
    contents: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnlockWithSecretParams {
    kind: String,
    secret: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnlockWithSystemParams {
    reason: String,
    strict: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveVaultStateParams {
    contents: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshAgentApplyParams {
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutostartSetParams {
    enabled: bool,
}
