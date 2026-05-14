use serde_json::Value;
use std::env;
use tauri::{AppHandle, Manager};

mod browser_host_registration;
mod deep_links;
mod desktop_integration;
#[cfg(target_os = "linux")]
mod linux_shortcuts;
mod native_host_items;
mod native_host_vault;
mod native_host_webauthn;
mod native_host_webauthn_crypto;
mod native_messaging;
mod secure_state;
mod sync_config;
mod system_auth;
mod system_commands;
mod tray;
mod windowing;

fn has_external_unlock_request() -> bool {
    env::args().skip(1).any(|arg| arg == "--external-unlock")
}

fn has_open_palette_request<I>(args: I) -> bool
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == "--open-palette")
}

#[cfg(target_os = "linux")]
fn apply_linux_webkit_workarounds() {
    let is_wayland = env::var_os("WAYLAND_DISPLAY").is_some()
        || env::var("XDG_SESSION_TYPE").is_ok_and(|value| value.eq_ignore_ascii_case("wayland"));
    if !is_wayland {
        return;
    }
    if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn apply_linux_webkit_workarounds() {}

#[tauri::command]
async fn palette_open(app: AppHandle) -> Result<(), String> {
    windowing::open_palette_window(&app)
}

#[tauri::command]
async fn palette_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn palette_hotkey_set(app: AppHandle, hotkey: String) -> Result<(), String> {
    register_palette_shortcut(&app, hotkey.trim())
}

#[cfg(not(desktop))]
#[tauri::command]
fn palette_hotkey_set(_app: AppHandle, _hotkey: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn system_auth_support() -> Value {
    system_auth::support()
}

#[tauri::command]
fn system_auth_has_vault_key() -> Value {
    system_auth::has_vault_key()
}

#[tauri::command]
fn system_auth_ensure_vault_key() -> Value {
    system_auth::ensure_vault_key()
}

#[tauri::command]
fn system_auth_delete_vault_key() -> Value {
    system_auth::delete_vault_key()
}

#[tauri::command]
fn system_auth_unlock(reason: String, strict: Option<bool>) -> Value {
    system_auth::unlock(reason, strict.unwrap_or(false))
}

#[cfg(desktop)]
fn register_palette_shortcut(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    if hotkey.is_empty() {
        return Err(String::from("Shortcut cannot be empty."));
    }

    let shortcuts = app.global_shortcut();
    shortcuts
        .unregister_all()
        .map_err(|error| error.to_string())?;
    let result = shortcuts
        .on_shortcut(hotkey, handle_palette_shortcut)
        .map_err(|error| error.to_string());

    #[cfg(target_os = "linux")]
    {
        if linux_shortcuts::setup(app, hotkey) {
            return Ok(());
        }
        if result.is_err() && linux_shortcuts::install_desktop_shortcut_fallback(hotkey) {
            return Ok(());
        }
    }

    result
}

#[cfg(desktop)]
fn handle_palette_shortcut(
    app: &AppHandle,
    _shortcut: &tauri_plugin_global_shortcut::Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if event.state == tauri_plugin_global_shortcut::ShortcutState::Released {
        let _ = windowing::open_palette_window(app);
    }
}

#[cfg(desktop)]
fn setup_global_shortcut(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let plugin = tauri_plugin_global_shortcut::Builder::new().build();
    app.handle().plugin(plugin)?;
    let _ = register_palette_shortcut(app.handle(), "Alt+S");
    Ok(())
}

#[cfg(not(desktop))]
fn setup_global_shortcut(_app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    apply_linux_webkit_workarounds();

    if browser_host_registration::is_native_messaging_host_launch() {
        native_messaging::run();
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if has_open_palette_request(args.iter().map(String::as_str)) {
                let _ = windowing::open_palette_window(app);
                return;
            }
            if deep_links::emit_oauth_callbacks(app, args) {
                let _ = windowing::open_palette_window(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .manage(deep_links::DeepLinkState::default())
        .manage(desktop_integration::DesktopIntegrationState::default())
        .manage(system_commands::FileAccessState::default())
        .setup(|app| {
            let external_unlock = has_external_unlock_request();
            let open_on_start = has_open_palette_request(env::args().skip(1));
            setup_global_shortcut(app)?;
            tray::create_tray(app)?;
            windowing::create_main_window(app, external_unlock)?;
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            deep_links::queue_oauth_callbacks(app.handle(), env::args().skip(1));
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
                if let Err(error) = app.deep_link().register_all() {
                    eprintln!("Klarkey could not register deep links: {error}");
                }
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    if deep_links::emit_oauth_callbacks(
                        &handle,
                        event.urls().into_iter().map(|url| url.to_string()),
                    ) {
                        let _ = windowing::open_palette_window(&handle);
                    }
                });
            }
            if external_unlock || open_on_start {
                let _ = windowing::open_palette_window_with_options(app.handle(), external_unlock);
            }
            let _ = browser_host_registration::ensure_native_host_registration(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            palette_open,
            palette_close,
            palette_hotkey_set,
            desktop_integration::desktop_support,
            system_commands::clipboard_copy_secret,
            system_auth_support,
            system_auth_has_vault_key,
            system_auth_ensure_vault_key,
            system_auth_delete_vault_key,
            system_auth_unlock,
            deep_links::oauth_pending_callbacks,
            sync_config::sync_config,
            desktop_integration::palette_target_get,
            desktop_integration::paste_into_target_window,
            desktop_integration::open_external_url,
            system_commands::pick_import_file,
            system_commands::pick_export_file,
            system_commands::read_text_file,
            system_commands::read_binary_file,
            system_commands::write_text_file,
            system_commands::load_vault_metadata,
            system_commands::lock_vault_metadata,
            system_commands::load_vault_state,
            system_commands::save_vault_state,
            system_commands::reset_vault_state
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Klarkey");
}
