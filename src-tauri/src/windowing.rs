use crate::desktop_integration;
use serde_json::json;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::window::Color;
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const PALETTE_WIDTH: f64 = 760.0;
const PALETTE_HEIGHT: f64 = 480.0;
const BLUR_HIDE_DELAY: Duration = Duration::from_millis(300);
const POST_MODAL_FOCUS_GRACE_MS: u64 = 1_500;
static BLUR_SERIAL: AtomicU64 = AtomicU64::new(0);
static MODAL_INTERACTION_DEPTH: AtomicUsize = AtomicUsize::new(0);
static MODAL_SUPPRESS_UNTIL_MS: AtomicU64 = AtomicU64::new(0);

struct ModalInteractionGuard {
    app: AppHandle,
    restore_focus: bool,
}

impl ModalInteractionGuard {
    fn new(app: &AppHandle) -> Self {
        let restore_focus = app
            .get_webview_window("main")
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);
        BLUR_SERIAL.fetch_add(1, Ordering::SeqCst);
        extend_modal_focus_grace();
        MODAL_INTERACTION_DEPTH.fetch_add(1, Ordering::SeqCst);
        Self {
            app: app.clone(),
            restore_focus,
        }
    }
}

impl Drop for ModalInteractionGuard {
    fn drop(&mut self) {
        extend_modal_focus_grace();
        if self.restore_focus {
            restore_palette_after_modal(&self.app);
        }
        MODAL_INTERACTION_DEPTH.fetch_sub(1, Ordering::SeqCst);
    }
}

pub fn create_main_window(
    app: &tauri::App,
    external_unlock: bool,
) -> Result<WebviewWindow, Box<dyn std::error::Error>> {
    let url = if external_unlock {
        "index.html?externalUnlock=1"
    } else {
        "index.html"
    };
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
        .title("Klarkey")
        .inner_size(PALETTE_WIDTH, PALETTE_HEIGHT)
        .min_inner_size(PALETTE_WIDTH, PALETTE_HEIGHT)
        .max_inner_size(PALETTE_WIDTH, PALETTE_HEIGHT)
        .center()
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .shadow(true)
        .focused(false)
        .skip_taskbar(true)
        .visible(false);

    builder = builder
        .transparent(true)
        .background_color(Color(0, 0, 0, 0));

    let window = builder.build()?;
    apply_platform_window_hints(&window);
    apply_native_window_material(&window);
    install_window_visibility_handlers(&window);
    Ok(window)
}

pub fn open_palette_window(app: &AppHandle) -> Result<(), String> {
    open_palette_window_with_options(app, false)
}

#[cfg(target_os = "linux")]
pub fn open_palette_window_with_activation_token(
    app: &AppHandle,
    activation_token: Option<String>,
) -> Result<(), String> {
    open_palette_window_with_options_and_activation(app, false, activation_token)
}

pub fn open_palette_window_with_options(
    app: &AppHandle,
    external_unlock: bool,
) -> Result<(), String> {
    open_palette_window_with_options_and_activation(app, external_unlock, None)
}

fn open_palette_window_with_options_and_activation(
    app: &AppHandle,
    external_unlock: bool,
    activation_token: Option<String>,
) -> Result<(), String> {
    desktop_integration::capture_target_window(app);
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| String::from("Klarkey window is not available."))?;

    #[cfg(target_os = "linux")]
    if let Some(activation_token) = activation_token.filter(|token| !token.trim().is_empty()) {
        let app = app.clone();
        let window_for_thread = window.clone();
        window
            .run_on_main_thread(move || {
                apply_wayland_activation_token(&window_for_thread, &activation_token);
                let _ = present_palette_window(&app, &window_for_thread, external_unlock);
            })
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    present_palette_window(app, &window, external_unlock)
}

fn present_palette_window(
    app: &AppHandle,
    window: &WebviewWindow,
    external_unlock: bool,
) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    let _ = app.emit(
        "palette-prepare",
        json!({ "externalUnlock": external_unlock }),
    );
    desktop_integration::emit_target_window(app);
    let _ = app.emit("palette-focus", json!({}));
    Ok(())
}

pub fn run_modal_interaction<T>(app: &AppHandle, operation: impl FnOnce() -> T) -> T {
    let _guard = ModalInteractionGuard::new(app);
    operation()
}

fn extend_modal_focus_grace() {
    MODAL_SUPPRESS_UNTIL_MS.store(
        now_millis().saturating_add(POST_MODAL_FOCUS_GRACE_MS),
        Ordering::SeqCst,
    );
}

fn modal_focus_suppressed() -> bool {
    MODAL_INTERACTION_DEPTH.load(Ordering::SeqCst) > 0
        || now_millis() <= MODAL_SUPPRESS_UNTIL_MS.load(Ordering::SeqCst)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn restore_palette_after_modal(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("palette-focus", json!({}));
}

#[cfg(target_os = "linux")]
fn apply_wayland_activation_token(window: &WebviewWindow, activation_token: &str) {
    use gtk::prelude::GtkWindowExt;

    if let Ok(gtk_window) = window.gtk_window() {
        gtk_window.set_startup_id(activation_token);
    }
}

fn apply_platform_window_hints(_window: &WebviewWindow) {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::GtkWindowExt;

        if let Ok(gtk_window) = _window.gtk_window() {
            gtk_window.set_skip_taskbar_hint(true);
            gtk_window.set_skip_pager_hint(true);
        }
    }
}

fn apply_native_window_material(_window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
        let _ = apply_vibrancy(_window, NSVisualEffectMaterial::HudWindow, None, None);
    }

    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::apply_acrylic;
        let _ = apply_acrylic(_window, Some((18, 18, 18, 145)));
    }
}

fn install_window_visibility_handlers(window: &WebviewWindow) {
    let window_to_hide = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window_to_hide.hide();
        }
        WindowEvent::Focused(true) => {
            BLUR_SERIAL.fetch_add(1, Ordering::SeqCst);
        }
        WindowEvent::Focused(false) => {
            if modal_focus_suppressed() {
                return;
            }
            let serial = BLUR_SERIAL.fetch_add(1, Ordering::SeqCst) + 1;
            let window_to_hide = window_to_hide.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(BLUR_HIDE_DELAY).await;
                if BLUR_SERIAL.load(Ordering::SeqCst) != serial || modal_focus_suppressed() {
                    return;
                }
                if window_to_hide.is_focused().unwrap_or(false) {
                    return;
                }
                let _ = window_to_hide.hide();
            });
        }
        _ => {}
    });
}
