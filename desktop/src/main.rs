#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_context;
mod bridge_commands;
mod browser_host_registration;
mod deep_links;
mod external_url;
mod native_host_item_fields;
mod native_host_items;
mod native_host_passkeys;
mod native_host_totp;
mod native_host_vault;
mod native_host_vault_response;
mod native_host_vault_state;
mod native_host_webauthn;
mod native_host_webauthn_crypto;
mod native_messaging;
mod secret_hash;
mod secure_state;
mod ssh_agent;
mod sync_config;
mod system_auth;
mod system_commands;

use std::{
    env,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};

use app_context::AppContext;
use bridge_commands::register_commands;
use sabine::{
    DeepLinkRegistration, GlobalShortcutRegistration, SabineError, SabineWindow,
    SingleInstancePolicy, TrayIcon, TrayMenuItem, WindowRegion,
};
use serde_json::Value;

const APP_NAME: &str = "Klarkey";
const PALETTE_WIDTH: u32 = 760;
const PALETTE_HEIGHT: u32 = 480;
const PALETTE_CORNER_RADIUS: i32 = 14;

fn main() {
    let args = env::args().collect::<Vec<_>>();
    if browser_host_registration::is_native_messaging_host_launch() {
        native_messaging::run();
        return;
    }

    let app_context = Arc::new(OnceLock::new());
    let build_context = Arc::clone(&app_context);
    let launched_context = Arc::clone(&app_context);
    SabineWindow::main_with_process(
        move |window| {
            let ctx =
                AppContext::new().map_err(|message| SabineError::CreationFailed { message })?;
            deep_links::queue_oauth_callbacks(&ctx, args.iter().skip(1).cloned());
            if let Err(error) = browser_host_registration::ensure_native_host_registration(&ctx) {
                eprintln!("Klarkey could not register browser integration: {error}");
            }
            ssh_agent::start_from_metadata(&ctx);
            let window = build_window(window, &ctx, &args);
            build_context
                .set(ctx)
                .map_err(|_| SabineError::CreationFailed {
                    message: String::from("Klarkey application context was initialized twice"),
                })?;
            Ok(window)
        },
        move |process| {
            if let Some(context) = launched_context.get() {
                context.set_bridge_event_emitter(process.bridge_event_emitter());
            }
        },
    );
}

fn desktop_open_command(args: &[String]) -> String {
    let command = env::current_exe()
        .ok()
        .map(|path| shell_command_path(&path))
        .unwrap_or_else(|| String::from("klarkey-desktop"));

    if is_dev(args) {
        format!("{command} --dev --open-palette")
    } else {
        format!("{command} --open-palette")
    }
}

fn shell_command_path(path: &Path) -> String {
    let value = path.display().to_string();
    if value.contains(' ') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value
    }
}

fn runtime_identifier(args: &[String]) -> String {
    if is_dev(args) {
        format!("{}.dev", app_context::app_identifier())
    } else {
        app_context::app_identifier().to_string()
    }
}

fn is_dev(args: &[String]) -> bool {
    env::var_os("SABINE_DEV_URL").is_some() || args.iter().any(|arg| arg == "--dev")
}

fn build_window(window: SabineWindow, ctx: &AppContext, args: &[String]) -> SabineWindow {
    let mut window = window
        .fixed_size(PALETTE_WIDTH, PALETTE_HEIGHT)
        .palette()
        .hidden()
        .active(false)
        .always_on_top(true)
        .blur_region(WindowRegion::adaptive_rounded_rect(PALETTE_CORNER_RADIUS))
        .app_id(runtime_identifier(args))
        .tray_icon(tray_icon())
        .deep_link(DeepLinkRegistration::new(
            app_context::app_identifier(),
            ["klarkey"],
        ))
        .single_instance_id(runtime_identifier(args))
        .single_instance(SingleInstancePolicy::ReuseExisting)
        .input_region(WindowRegion::adaptive_rounded_rect(PALETTE_CORNER_RADIUS));

    if let Some(shortcut) = parse_shortcut(&initial_hotkey(ctx)) {
        window = window.global_shortcut(GlobalShortcutRegistration {
            id: String::from("open-palette"),
            shortcut,
            action: String::from("open-palette"),
            app_id: Some(app_context::app_identifier().to_string()),
            app_name: Some(APP_NAME.to_string()),
            description: Some(String::from("Open Klarkey")),
            desktop_command: Some(desktop_open_command(args)),
        });
    }

    register_commands(
        window,
        ctx.clone(),
        has_external_unlock_request(args),
        has_initial_open_request(args),
    )
}

fn parse_shortcut(value: &str) -> Option<sabine::Shortcut> {
    let mut modifiers = sabine::ShortcutModifiers::default();
    let mut key = None;
    for part in value
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => modifiers.ctrl = true,
            "alt" | "option" => modifiers.alt = true,
            "shift" => modifiers.shift = true,
            "cmd" | "command" | "meta" | "super" => modifiers.meta = true,
            _ if key.is_none() => key = Some(part.to_string()),
            _ => return None,
        }
    }
    Some(sabine::Shortcut {
        modifiers,
        key: key?,
    })
}

fn tray_icon() -> TrayIcon {
    let mut icon = TrayIcon::new("klarkey", APP_NAME);
    icon.icon_path = resource_path("klarkey.png");
    icon.tooltip = Some(APP_NAME.to_string());
    icon.menu = vec![
        TrayMenuItem {
            id: String::from("open"),
            label: String::from("Open Klarkey"),
            action: Some(String::from("open-palette")),
            enabled: true,
            separator: false,
        },
        TrayMenuItem {
            id: String::from("separator"),
            label: String::new(),
            action: None,
            enabled: false,
            separator: true,
        },
        TrayMenuItem {
            id: String::from("quit"),
            label: String::from("Quit Klarkey"),
            action: Some(String::from("quit")),
            enabled: true,
            separator: false,
        },
    ];
    icon
}

fn resource_path(file_name: &str) -> Option<PathBuf> {
    bundled_resource(Path::new(file_name)).or_else(|| {
        env::current_dir()
            .ok()
            .map(|root| root.join("public").join(file_name))
            .filter(|path| path.is_file())
    })
}

fn bundled_resource(relative: &Path) -> Option<PathBuf> {
    let Ok(executable) = env::current_exe() else {
        return None;
    };
    let executable_dir = executable.parent()?;
    [
        executable_dir.join("resources").join(relative),
        executable_dir.join("..").join("Resources").join(relative),
        executable_dir
            .join("..")
            .join("share")
            .join("sabine")
            .join(app_context::app_identifier())
            .join(relative),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn has_external_unlock_request(args: &[String]) -> bool {
    args.iter().any(|arg| arg == "--external-unlock")
}

fn has_initial_open_request(args: &[String]) -> bool {
    has_external_unlock_request(args) || args.iter().any(|arg| arg == "--open-palette")
}

fn initial_hotkey(ctx: &AppContext) -> String {
    let Some(path) = ctx.vault_state_path().ok() else {
        return String::from("Alt+S");
    };
    if secure_state::read_vault_metadata(&path)
        .ok()
        .flatten()
        .is_some_and(|metadata| metadata.locked)
    {
        return String::from("Alt+S");
    }
    secure_state::read_vault_state(&path)
        .ok()
        .flatten()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .and_then(|state| {
            state
                .pointer("/settings/hotkey")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| String::from("Alt+S"))
}
