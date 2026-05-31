use std::sync::{Mutex, OnceLock};

use gtk::prelude::*;
use tauri::WebviewWindow;
use wayland_client::{
    backend::{Backend, ObjectId},
    delegate_noop,
    globals::{registry_queue_init, GlobalListContents},
    protocol::{
        wl_compositor::WlCompositor, wl_region::WlRegion, wl_registry, wl_surface::WlSurface,
    },
    Connection, Dispatch, EventQueue, Proxy, QueueHandle,
};
use wayland_protocols::ext::background_effect::v1::client::{
    ext_background_effect_manager_v1::{
        Capability, Event as BackgroundEffectManagerEvent, ExtBackgroundEffectManagerV1,
    },
    ext_background_effect_surface_v1::ExtBackgroundEffectSurfaceV1,
};

static BACKGROUND_EFFECT: OnceLock<Mutex<Option<WaylandBackgroundEffect>>> = OnceLock::new();

#[derive(Default)]
struct BackgroundEffectState {
    blur_available: bool,
}

struct WaylandBackgroundEffect {
    connection: Connection,
    _event_queue: EventQueue<BackgroundEffectState>,
    queue_handle: QueueHandle<BackgroundEffectState>,
    _manager: ExtBackgroundEffectManagerV1,
    compositor: WlCompositor,
    surface: WlSurface,
    effect: ExtBackgroundEffectSurfaceV1,
}

pub fn apply_blur(window: &WebviewWindow, width: i32, height: i32, radius: i32) -> bool {
    if width <= 0 || height <= 0 {
        return false;
    }

    let surface_info = match WaylandSurfaceInfo::from_window(window) {
        Ok(surface_info) => surface_info,
        Err(_) => return false,
    };
    let Ok(mut effect) = BACKGROUND_EFFECT.get_or_init(|| Mutex::new(None)).lock() else {
        return false;
    };

    *effect = None;

    match WaylandBackgroundEffect::new(surface_info, width, height, radius) {
        Ok(background_effect) => {
            *effect = Some(background_effect);
            true
        }
        Err(_) => false,
    }
}

pub fn clear_blur() {
    if let Ok(mut effect) = BACKGROUND_EFFECT.get_or_init(|| Mutex::new(None)).lock() {
        *effect = None;
    }
}

struct WaylandSurfaceInfo {
    display_ptr: *mut std::ffi::c_void,
    surface_ptr: *mut std::ffi::c_void,
}

impl WaylandSurfaceInfo {
    fn from_window(window: &WebviewWindow) -> Result<Self, String> {
        let gtk_window = window.gtk_window().map_err(|error| error.to_string())?;
        let display = gtk_window.display();
        if !display.backend().is_wayland() {
            return Err(String::from("not a Wayland window"));
        }

        gtk_window.realize();
        let gdk_window = gtk_window
            .window()
            .ok_or_else(|| String::from("Wayland window surface is not realized"))?;

        let display_ptr = unsafe {
            gdk_wayland_sys::gdk_wayland_display_get_wl_display(display.as_ptr() as *mut _)
        };
        let surface_ptr = unsafe {
            gdk_wayland_sys::gdk_wayland_window_get_wl_surface(gdk_window.as_ptr() as *mut _)
        };
        if display_ptr.is_null() || surface_ptr.is_null() {
            return Err(String::from("Wayland display or surface is unavailable"));
        }

        Ok(Self {
            display_ptr,
            surface_ptr,
        })
    }
}

impl WaylandBackgroundEffect {
    fn new(
        surface_info: WaylandSurfaceInfo,
        width: i32,
        height: i32,
        radius: i32,
    ) -> Result<Self, String> {
        let backend = unsafe { Backend::from_foreign_display(surface_info.display_ptr.cast()) };
        let connection = Connection::from_backend(backend);
        let surface_id =
            unsafe { ObjectId::from_ptr(WlSurface::interface(), surface_info.surface_ptr.cast()) }
                .map_err(|error| error.to_string())?;
        let surface =
            WlSurface::from_id(&connection, surface_id).map_err(|error| error.to_string())?;

        let (globals, mut event_queue) = registry_queue_init::<BackgroundEffectState>(&connection)
            .map_err(|error| error.to_string())?;
        let queue_handle = event_queue.handle();
        let compositor: WlCompositor = globals
            .bind(&queue_handle, 1..=6, ())
            .map_err(|error| error.to_string())?;
        let manager: ExtBackgroundEffectManagerV1 = globals
            .bind(&queue_handle, 1..=1, ())
            .map_err(|error| error.to_string())?;
        let mut state = BackgroundEffectState::default();
        event_queue
            .roundtrip(&mut state)
            .map_err(|error| error.to_string())?;
        if !state.blur_available {
            return Err(String::from(
                "Wayland compositor does not advertise background blur",
            ));
        }

        let effect = manager.get_background_effect(&surface, &queue_handle, ());
        let background_effect = Self {
            connection,
            _event_queue: event_queue,
            queue_handle,
            _manager: manager,
            compositor,
            surface,
            effect,
        };
        background_effect.apply_region(width, height, radius)?;

        Ok(background_effect)
    }

    fn apply_region(&self, width: i32, height: i32, radius: i32) -> Result<(), String> {
        if !self.effect.is_alive() || !self.surface.is_alive() {
            return Err(String::from(
                "Wayland background effect surface is no longer alive",
            ));
        }

        let region = self.compositor.create_region(&self.queue_handle, ());
        add_rounded_rect_region(&region, width, height, radius);
        self.effect.set_blur_region(Some(&region));
        region.destroy();
        self.surface.commit();
        self.connection.flush().map_err(|error| error.to_string())
    }
}

impl Drop for WaylandBackgroundEffect {
    fn drop(&mut self) {
        if self.effect.is_alive() {
            self.effect.destroy();
        }
        if self.surface.is_alive() {
            self.surface.commit();
        }
        if self._manager.is_alive() {
            self._manager.destroy();
        }
        let _ = self.connection.flush();
    }
}

fn add_rounded_rect_region(region: &WlRegion, width: i32, height: i32, radius: i32) {
    let radius = radius.clamp(0, width.min(height) / 2);
    if radius == 0 {
        region.add(0, 0, width, height);
        return;
    }

    let mut band_start = 0;
    let mut band_inset = rounded_rect_inset(0, height, radius);
    for y in 1..height {
        let inset = rounded_rect_inset(y, height, radius);
        if inset != band_inset {
            add_region_band(region, band_start, y, band_inset, width);
            band_start = y;
            band_inset = inset;
        }
    }
    add_region_band(region, band_start, height, band_inset, width);
}

fn rounded_rect_inset(y: i32, height: i32, radius: i32) -> i32 {
    if y < radius {
        return circle_inset(radius - y - 1, radius);
    }

    if y >= height - radius {
        return circle_inset(y - (height - radius), radius);
    }

    0
}

fn circle_inset(y_offset: i32, radius: i32) -> i32 {
    let inside = radius * radius - y_offset * y_offset;
    let half_width = f64::from(inside).sqrt().floor() as i32;
    radius.saturating_sub(half_width)
}

fn add_region_band(region: &WlRegion, start_y: i32, end_y: i32, inset: i32, width: i32) {
    let height = end_y - start_y;
    let width = width - inset * 2;
    if width > 0 && height > 0 {
        region.add(inset, start_y, width, height);
    }
}

impl Dispatch<ExtBackgroundEffectManagerV1, ()> for BackgroundEffectState {
    fn event(
        state: &mut Self,
        _: &ExtBackgroundEffectManagerV1,
        event: BackgroundEffectManagerEvent,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let BackgroundEffectManagerEvent::Capabilities { flags } = event {
            let flags: u32 = flags.into();
            state.blur_available = flags & u32::from(Capability::Blur) != 0;
        }
    }
}

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for BackgroundEffectState {
    fn event(
        _: &mut Self,
        _: &wl_registry::WlRegistry,
        _: wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

delegate_noop!(BackgroundEffectState: ignore WlCompositor);
delegate_noop!(BackgroundEffectState: ignore WlRegion);
delegate_noop!(BackgroundEffectState: ignore ExtBackgroundEffectSurfaceV1);
