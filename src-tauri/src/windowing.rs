use crate::desktop_integration;
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::window::Color;
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const PALETTE_WIDTH: f64 = 760.0;
const PALETTE_HEIGHT: f64 = 480.0;
const PALETTE_CORNER_RADIUS: i32 = 14;
const BLUR_HIDE_DELAY: Duration = Duration::from_millis(300);
const POST_MODAL_FOCUS_GRACE_MS: u64 = 1_500;
static BLUR_SERIAL: AtomicU64 = AtomicU64::new(0);
static MODAL_INTERACTION_DEPTH: AtomicUsize = AtomicUsize::new(0);
static MODAL_SUPPRESS_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
static NATIVE_BACKGROUND_BLUR_AVAILABLE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "linux")]
static LINUX_CLEAR_DRAW_HANDLER_INSTALLED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "linux")]
static LINUX_MAP_HANDLER_INSTALLED: AtomicBool = AtomicBool::new(false);

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

pub fn hide_palette_window(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let window_for_thread = window.clone();
        window
            .run_on_main_thread(move || {
                crate::linux_background_effect::clear_blur();
                configure_linux_palette_surface(&window_for_thread, false);
                NATIVE_BACKGROUND_BLUR_AVAILABLE.store(false, Ordering::SeqCst);
                let _ = window_for_thread.hide();
            })
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "linux"))]
    {
        window.hide().map_err(|error| error.to_string())
    }
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
    {
        let app = app.clone();
        let window_for_thread = window.clone();
        let activation_token = activation_token.filter(|token| !token.trim().is_empty());
        window
            .run_on_main_thread(move || {
                if let Some(activation_token) = activation_token {
                    apply_wayland_activation_token(&window_for_thread, &activation_token);
                }
                let _ = present_palette_window(&app, &window_for_thread, external_unlock);
            })
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "linux"))]
    present_palette_window(app, &window, external_unlock)
}

fn present_palette_window(
    app: &AppHandle,
    window: &WebviewWindow,
    external_unlock: bool,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        NATIVE_BACKGROUND_BLUR_AVAILABLE.store(true, Ordering::SeqCst);
        configure_linux_palette_surface(window, true);
    }

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    emit_palette_prepare(app, external_unlock);
    attach_native_window_material_after_show(window);
    desktop_integration::emit_target_window(app);
    let _ = app.emit("palette-focus", json!({}));
    Ok(())
}

fn emit_palette_prepare(app: &AppHandle, external_unlock: bool) {
    let _ = app.emit(
        "palette-prepare",
        json!({
            "externalUnlock": external_unlock,
            "nativeTranslucent": native_window_translucent(),
            "nativeContentTranslucent": native_content_translucent(),
            "nativeHostTranslucent": native_host_translucent(),
        }),
    );
}

fn attach_native_window_material_after_show(_window: &WebviewWindow) {
    #[cfg(target_os = "linux")]
    {
        let window = _window.clone();
        gtk::glib::idle_add_local_once(move || {
            refresh_native_window_material(&window);
        });
    }
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
    refresh_native_window_material(&window);
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
        NATIVE_BACKGROUND_BLUR_AVAILABLE.store(
            apply_vibrancy(_window, NSVisualEffectMaterial::HudWindow, None, None).is_ok(),
            Ordering::SeqCst,
        );
    }

    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::apply_acrylic;
        NATIVE_BACKGROUND_BLUR_AVAILABLE.store(
            apply_acrylic(_window, Some((18, 18, 18, 145))).is_ok(),
            Ordering::SeqCst,
        );
    }

    #[cfg(target_os = "linux")]
    {
        configure_linux_palette_surface(_window, false);
        NATIVE_BACKGROUND_BLUR_AVAILABLE.store(false, Ordering::SeqCst);
    }
}

fn refresh_native_window_material(_window: &WebviewWindow) {
    #[cfg(target_os = "linux")]
    {
        let blur_available = crate::linux_background_effect::apply_blur(
            _window,
            PALETTE_WIDTH as i32,
            PALETTE_HEIGHT as i32,
            PALETTE_CORNER_RADIUS,
        );
        configure_linux_palette_surface(_window, blur_available);
        NATIVE_BACKGROUND_BLUR_AVAILABLE.store(blur_available, Ordering::SeqCst);
    }
}

#[cfg(target_os = "linux")]
fn configure_linux_palette_surface(window: &WebviewWindow, translucent: bool) {
    use gtk::prelude::*;

    if let Ok(gtk_window) = window.gtk_window() {
        install_linux_clear_draw_handler(&gtk_window);
        install_linux_map_handler(window, &gtk_window);
        gtk_window.set_app_paintable(true);
        gtk_window.set_opacity(1.0);
        if let Some(screen) = gtk::prelude::GtkWindowExt::screen(&gtk_window) {
            gtk_window.set_visual(screen.rgba_visual().as_ref());
        }
        if let Some(gdk_window) = gtk_window.window() {
            gdk_window.set_opaque_region(None);
        }
        gtk_window.queue_draw();
    }

    if let Ok(vbox) = window.default_vbox() {
        vbox.set_app_paintable(true);
        vbox.queue_draw();
    }

    set_linux_webview_background(window, translucent);
}

#[cfg(target_os = "linux")]
fn install_linux_map_handler(window: &WebviewWindow, gtk_window: &gtk::ApplicationWindow) {
    use gtk::prelude::WidgetExtManual;

    if LINUX_MAP_HANDLER_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }

    let window = window.clone();
    gtk_window.connect_map_event(move |_, _| {
        let window = window.clone();
        gtk::glib::idle_add_local_once(move || {
            refresh_native_window_material(&window);
        });
        gtk::glib::Propagation::Proceed
    });
}

#[cfg(target_os = "linux")]
fn install_linux_clear_draw_handler(window: &gtk::ApplicationWindow) {
    use gtk::prelude::*;

    if LINUX_CLEAR_DRAW_HANDLER_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }

    window.connect_draw(|_, context| {
        context.set_operator(gtk::cairo::Operator::Clear);
        let _ = context.paint();
        context.set_operator(gtk::cairo::Operator::Over);
        gtk::glib::Propagation::Proceed
    });
}

#[cfg(target_os = "linux")]
fn set_linux_webview_background(window: &WebviewWindow, translucent: bool) {
    use webkit2gtk::WebViewExt;

    let alpha = if translucent { 0.62 } else { 1.0 };
    let color = gtk::gdk::RGBA::new(26.0 / 255.0, 26.0 / 255.0, 27.0 / 255.0, alpha);

    if let Ok(vbox) = window.default_vbox() {
        use gtk::prelude::*;

        if let Some(webview) = vbox
            .children()
            .into_iter()
            .find_map(|child| child.downcast::<webkit2gtk::WebView>().ok())
        {
            webview.set_background_color(&color);
            return;
        }
    }

    let _ = window.with_webview(move |webview| {
        webview.inner().set_background_color(&color);
    });
}

fn native_window_translucent() -> bool {
    NATIVE_BACKGROUND_BLUR_AVAILABLE.load(Ordering::SeqCst)
}

#[cfg(target_os = "linux")]
fn native_content_translucent() -> bool {
    false
}

#[cfg(not(target_os = "linux"))]
fn native_content_translucent() -> bool {
    native_window_translucent()
}

#[cfg(target_os = "linux")]
fn native_host_translucent() -> bool {
    native_window_translucent()
}

#[cfg(not(target_os = "linux"))]
fn native_host_translucent() -> bool {
    false
}

#[tauri::command]
pub fn native_window_material() -> serde_json::Value {
    let background_blur = native_window_translucent();
    json!({
        "backgroundBlur": background_blur,
        "translucent": background_blur,
        "contentTranslucent": native_content_translucent(),
        "hostTranslucent": native_host_translucent(),
    })
}

fn install_window_visibility_handlers(window: &WebviewWindow) {
    let window_to_hide = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = hide_palette_window(&window_to_hide);
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
                let _ = hide_palette_window(&window_to_hide);
            });
        }
        _ => {}
    });
}
