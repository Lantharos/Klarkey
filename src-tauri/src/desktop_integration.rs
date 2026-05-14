use serde_json::{json, Value};
use std::env;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub(crate) struct DesktopIntegrationState {
    target: Mutex<Option<Value>>,
}

pub(crate) fn capture_target_window(app: &AppHandle) {
    let target = capture_foreground_window();
    *app.state::<DesktopIntegrationState>()
        .target
        .lock()
        .expect("desktop target lock poisoned") = target;
}

pub(crate) fn emit_target_window(app: &AppHandle) {
    if let Some(target) = app
        .state::<DesktopIntegrationState>()
        .target
        .lock()
        .expect("desktop target lock poisoned")
        .clone()
    {
        let _ = app.emit("palette-target-changed", target);
    }
}

#[tauri::command]
pub(crate) fn desktop_support() -> Value {
    let tools = json!({
        "xdotool": has_command("xdotool"),
        "ydotool": can_use_ydotool(),
        "wtype": can_use_wtype(),
        "osascript": has_command("osascript")
    });
    let session_type = env::var("XDG_SESSION_TYPE").ok();
    let is_x11 = session_type
        .as_deref()
        .unwrap_or("")
        .eq_ignore_ascii_case("x11");
    let available = if cfg!(target_os = "windows") {
        true
    } else if cfg!(target_os = "macos") {
        has_command("osascript")
    } else {
        (is_x11 && has_command("xdotool")) || can_use_ydotool() || can_use_wtype()
    };
    let message = if available {
        None
    } else if cfg!(target_os = "linux") {
        Some(
            if session_type
                .as_deref()
                .unwrap_or("")
                .eq_ignore_ascii_case("wayland")
            {
                "Install wtype, or run ydotoold with /dev/uinput access to enable automatic insert."
            } else {
                "Install xdotool to enable automatic insert."
            },
        )
    } else {
        None
    };

    json!({
        "platform": platform_name(),
        "sessionType": session_type,
        "autoPaste": {
            "available": available,
            "tools": tools,
            "message": message
        }
    })
}

#[tauri::command]
pub(crate) fn palette_target_get(state: State<DesktopIntegrationState>) -> Option<Value> {
    state
        .target
        .lock()
        .expect("desktop target lock poisoned")
        .clone()
}

#[tauri::command]
pub(crate) fn paste_into_target_window(
    app: AppHandle,
    handle: String,
    value: Option<String>,
) -> bool {
    hide_palette_before_insert(&app);
    if cfg!(target_os = "linux") {
        return paste_linux(&handle, value.as_deref().unwrap_or_default());
    }
    if cfg!(target_os = "macos") {
        thread::sleep(Duration::from_millis(160));
        return run_command(
            "osascript",
            &[
                "-e",
                "tell application \"System Events\" to keystroke \"v\" using command down",
            ],
        )
        .is_some();
    }
    if cfg!(target_os = "windows") {
        return paste_windows(&handle);
    }
    false
}

fn hide_palette_before_insert(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    thread::sleep(Duration::from_millis(220));
}

#[tauri::command]
pub(crate) fn open_external_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| String::from("Sync sign-in URL is invalid."))?;
    let host = parsed.host_str().unwrap_or_default();
    if parsed.scheme() != "https"
        || !(host == "aveid.net" || host.ends_with(".aveid.net"))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(String::from("Sync sign-in URL is not trusted."));
    }
    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", &url]);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&url);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&url);
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|_| String::from("Could not open the sync sign-in page."))
}

fn capture_foreground_window() -> Option<Value> {
    if cfg!(target_os = "linux") {
        return capture_linux_foreground_window();
    }
    if cfg!(target_os = "windows") {
        return capture_windows_foreground_window();
    }
    None
}

fn capture_linux_foreground_window() -> Option<Value> {
    if !has_command("xdotool") {
        return None;
    }
    let handle = run_command("xdotool", &["getactivewindow"])?;
    if !handle.chars().all(|char| char.is_ascii_digit()) {
        return None;
    }
    let process_id = run_command("xdotool", &["getwindowpid", &handle]).unwrap_or_default();
    let process_path = process_id
        .parse::<u32>()
        .ok()
        .and_then(|pid| std::fs::read_link(format!("/proc/{pid}/exe")).ok())
        .map(path_to_string);
    let app_name = process_path
        .as_deref()
        .and_then(|path| PathBuf::from(path).file_stem().map(path_to_string));
    Some(json!({
        "handle": handle,
        "appName": app_name,
        "windowTitle": run_command("xdotool", &["getwindowname", &handle]),
        "processPath": process_path
    }))
}

fn capture_windows_foreground_window() -> Option<Value> {
    let output = run_powershell(
        r#"
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [Win32]::GetForegroundWindow()
$pid = 0
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$title = New-Object System.Text.StringBuilder 1024
[Win32]::GetWindowTextW($hwnd, $title, 1024) | Out-Null
$process = Get-Process -Id $pid -ErrorAction SilentlyContinue
@([string]$hwnd.ToInt64(), [string]$process.ProcessName, [string]$title, [string]$process.Path) -join "`t"
"#,
    )?;
    let mut parts = output.split('\t');
    let handle = parts.next()?.trim().to_string();
    if handle.is_empty() || handle == "0" {
        return None;
    }
    Some(json!({
        "handle": handle,
        "appName": empty_to_null(parts.next()),
        "windowTitle": empty_to_null(parts.next()),
        "processPath": empty_to_null(parts.next())
    }))
}

fn paste_linux(handle: &str, value: &str) -> bool {
    let is_x11 = env::var("XDG_SESSION_TYPE")
        .unwrap_or_default()
        .eq_ignore_ascii_case("x11");
    if is_x11 && has_command("xdotool") && handle.chars().all(|char| char.is_ascii_digit()) {
        return run_command(
            "xdotool",
            &[
                "windowactivate",
                "--sync",
                handle,
                "key",
                "--clearmodifiers",
                "ctrl+v",
            ],
        )
        .is_some();
    }
    thread::sleep(Duration::from_millis(320));
    if is_wayland_session() && desktop_name_contains("gnome") && can_use_ydotool() {
        return type_with_ydotool(value);
    }
    if can_use_ydotool()
        && run_ydotool(&["key", "-d", "20", "29:1", "47:1", "47:0", "29:0"]).is_some()
    {
        return true;
    }
    can_use_wtype() && run_command("wtype", &["-M", "ctrl", "v", "-m", "ctrl"]).is_some()
}

fn type_with_ydotool(value: &str) -> bool {
    !value.is_empty()
        && run_ydotool_with_input(&["type", "-d", "5", "-H", "5", "-f", "-"], value).is_some()
}

fn paste_windows(handle: &str) -> bool {
    if handle.is_empty() || !handle.chars().all(|char| char.is_ascii_digit()) {
        return false;
    }
    run_powershell(&format!(
        r#"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {{
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}}
"@
Add-Type -AssemblyName System.Windows.Forms
[Win32]::SetForegroundWindow([IntPtr]::new({handle})) | Out-Null
Start-Sleep -Milliseconds 80
[System.Windows.Forms.SendKeys]::SendWait("^v")
"#
    ))
    .is_some()
}

fn can_use_wtype() -> bool {
    has_command("wtype") && !desktop_name_contains("gnome")
}

fn can_use_ydotool() -> bool {
    has_command("ydotool") && ydotool_socket_path().exists()
}

fn run_ydotool(args: &[&str]) -> Option<String> {
    run_command_with_input("ydotool", args, None, true)
}

fn run_ydotool_with_input(args: &[&str], input: &str) -> Option<String> {
    run_command_with_input("ydotool", args, Some(input), true)
}

fn ydotool_socket_path() -> PathBuf {
    env::var_os("YDOTOOL_SOCKET")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("XDG_RUNTIME_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(format!("/run/user/{}", current_user_id())))
                .join(".ydotool_socket")
        })
}

fn current_user_id() -> String {
    run_command("id", &["-u"])
        .filter(|value| value.chars().all(|char| char.is_ascii_digit()))
        .unwrap_or_else(|| String::from("0"))
}

fn has_command(command: &str) -> bool {
    command_path(command).is_some()
}

fn run_command(command: &str, args: &[&str]) -> Option<String> {
    run_command_with_input(command, args, None, false)
}

fn run_command_with_input(
    command: &str,
    args: &[&str],
    input: Option<&str>,
    ydotool_socket: bool,
) -> Option<String> {
    let mut child = Command::new(command_path(command)?)
        .args(args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .envs(
            ydotool_socket
                .then(|| ("YDOTOOL_SOCKET", ydotool_socket_path()))
                .into_iter(),
        )
        .spawn()
        .ok()?;
    if let Some(input) = input {
        child
            .stdin
            .as_mut()
            .and_then(|stdin| stdin.write_all(input.as_bytes()).ok())?;
        drop(child.stdin.take());
    }
    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn command_path(command: &str) -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        return matches!(command, "powershell.exe" | "rundll32.exe")
            .then(|| PathBuf::from(command));
    }

    let shell = if Path::new("/bin/sh").exists() {
        "/bin/sh"
    } else {
        "sh"
    };
    let output = Command::new(shell)
        .args(["-lc", &format!("command -v -- {command}")])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|path| !path.is_empty())
        .map(PathBuf::from);
    if output.is_some() {
        return output;
    }

    ["/usr/local/bin", "/usr/bin", "/bin", "/opt/homebrew/bin"]
        .into_iter()
        .map(|directory| PathBuf::from(directory).join(command))
        .find(|path| path.is_file())
}

fn run_powershell(script: &str) -> Option<String> {
    run_command(
        "powershell.exe",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
    )
}

fn is_wayland_session() -> bool {
    env::var_os("WAYLAND_DISPLAY").is_some()
        || env::var("XDG_SESSION_TYPE").is_ok_and(|value| value.eq_ignore_ascii_case("wayland"))
}

fn desktop_name_contains(value: &str) -> bool {
    let needle = value.to_ascii_lowercase();
    [
        env::var("XDG_CURRENT_DESKTOP").unwrap_or_default(),
        env::var("XDG_SESSION_DESKTOP").unwrap_or_default(),
        env::var("DESKTOP_SESSION").unwrap_or_default(),
    ]
    .into_iter()
    .any(|desktop| desktop.to_ascii_lowercase().contains(&needle))
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

fn empty_to_null(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn path_to_string(value: impl AsRef<std::ffi::OsStr>) -> String {
    value.as_ref().to_string_lossy().to_string()
}
