#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_context;
mod bridge_commands;
mod browser_host_registration;
mod deep_links;
mod desktop_integration;
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
};

use app_context::AppContext;
use bridge_commands::{emit_palette_open, register_commands};
use fenestra_cef::{
    run_fenestra_host_from_args, CefWindow, DeepLinkRegistration, GlobalShortcutRegistration,
    RuntimeConfig, RuntimeMode, SingleInstancePolicy, TrayIcon, TrayMenuItem, WebViewSecurity,
    WindowRegion,
};
use serde_json::Value;
use stuk_actions::Shortcut;

const APP_NAME: &str = "Klarkey";
const PALETTE_WIDTH: u32 = 760;
const PALETTE_HEIGHT: u32 = 480;
const PALETTE_CORNER_RADIUS: i32 = 14;

fn main() {
    let args = env::args().collect::<Vec<_>>();
    if run_fenestra_host_from_args(&args) {
        return;
    }

    if browser_host_registration::is_native_messaging_host_launch() {
        native_messaging::run();
        return;
    }

    if let Err(error) = run(&args) {
        if !error.contains("another instance is already running") {
            eprintln!("failed to run Klarkey: {error}");
            std::process::exit(1);
        }
    }
}

fn run(args: &[String]) -> Result<(), String> {
    let root_dir = root_dir();
    let ctx = AppContext::new(root_dir.clone())?;
    deep_links::queue_oauth_callbacks(&ctx, args.iter().skip(1).cloned());
    let _ = browser_host_registration::ensure_native_host_registration(&ctx)
        .map_err(|error| eprintln!("Klarkey could not register browser integration: {error}"));
    ssh_agent::start_from_metadata(&ctx);

    let window = build_window(&ctx, args, &root_dir);
    let process = window
        .launch_or_install()
        .map_err(|error| error.to_string())?;
    ctx.set_bridge_event_emitter(process.bridge_event_emitter());
    if has_initial_open_request(args) {
        emit_palette_open(&ctx, has_external_unlock_request(args));
    }
    let _ = process.wait();
    Ok(())
}

fn root_dir() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(PathBuf::from)
        .unwrap_or(manifest_dir)
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
    args.iter().any(|arg| arg == "--dev")
}

fn build_window(ctx: &AppContext, args: &[String], root_dir: &Path) -> CefWindow {
    let runtime = RuntimeConfig {
        mode: RuntimeMode::SharedPreferred,
        allow_user_install: true,
        bundled_dir: Some(root_dir.to_path_buf()),
        ..RuntimeConfig::default()
    };

    let mut window = CefWindow::new()
        .title(APP_NAME)
        .fixed_size(PALETTE_WIDTH, PALETTE_HEIGHT)
        .hidden()
        .active(false)
        .hide_on_blur(true)
        .always_on_top(true)
        .frameless()
        .glass()
        .blur_region(WindowRegion::adaptive_rounded_rect(PALETTE_CORNER_RADIUS))
        .app_id(runtime_identifier(args))
        .runtime(runtime)
        .tray_icon(
            TrayIcon::new("klarkey", APP_NAME)
                .icon_path(root_dir.join("public").join("klarkey.png"))
                .tooltip(APP_NAME)
                .menu_item(TrayMenuItem::action("open", "Open Klarkey", "open-palette"))
                .menu_item(TrayMenuItem::separator("separator"))
                .menu_item(TrayMenuItem::action("quit", "Quit Klarkey", "quit")),
        )
        .deep_link(DeepLinkRegistration::new(
            app_context::app_identifier(),
            ["klarkey"],
        ))
        .single_instance_id(runtime_identifier(args))
        .single_instance(SingleInstancePolicy::FocusExisting)
        .input_region(WindowRegion::adaptive_rounded_rect(PALETTE_CORNER_RADIUS));

    if let Some(shortcut) = Shortcut::parse(&initial_hotkey(ctx)).ok() {
        window = window.global_shortcut(
            GlobalShortcutRegistration::new("open-palette", shortcut, "open-palette")
                .app_id(app_context::app_identifier())
                .app_name(APP_NAME)
                .description("Open Klarkey")
                .desktop_command(desktop_open_command(args)),
        );
    }

    let query = entry_query(args);
    if is_dev(args) {
        window = window
            .security(WebViewSecurity {
                remote_content: true,
                allowed_origins: vec!["http://127.0.0.1:5173".to_string()],
                allowed_bridge_permissions: Vec::new(),
            })
            .dev_url(format!("http://127.0.0.1:5173{query}"))
            .dev_command("bun run dev -- --host 127.0.0.1 --port 5173 --strictPort");
    } else {
        window = window.entry(format!(
            "{}{query}",
            root_dir.join("dist").join("index.html").display()
        ));
    }

    register_commands(window, ctx.clone())
}

fn entry_query(args: &[String]) -> String {
    let mut params = vec![String::from("fenestra=1")];
    if has_external_unlock_request(args) {
        params.push(String::from("externalUnlock=1"));
    }
    if has_initial_open_request(args) {
        params.push(String::from("openPalette=1"));
    }
    format!("?{}", params.join("&"))
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
