use crate::app_context::AppContext;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

#[derive(Default)]
pub(crate) struct DesktopIntegrationState {
    target: Mutex<Option<Value>>,
}

pub(crate) fn capture_target_window(ctx: &AppContext) {
    let target = capture_foreground_window();
    *ctx.desktop_integration()
        .target
        .lock()
        .expect("desktop target lock poisoned") = target;
}

pub(crate) fn emit_target_window(ctx: &AppContext) {
    if let Some(target) = ctx
        .desktop_integration()
        .target
        .lock()
        .expect("desktop target lock poisoned")
        .clone()
    {
        let _ = ctx.emit("palette-target-changed", target);
    }
}

pub(crate) fn palette_target_get(ctx: &AppContext) -> Option<Value> {
    ctx.desktop_integration()
        .target
        .lock()
        .expect("desktop target lock poisoned")
        .clone()
}

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

fn has_command(command: &str) -> bool {
    command_path(command).is_some()
}

fn run_command(command: &str, args: &[&str]) -> Option<String> {
    let mut process = Command::new(command_path(command)?);
    process
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let child = process.spawn().ok()?;
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

fn empty_to_null(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn path_to_string(value: impl AsRef<std::ffi::OsStr>) -> String {
    value.as_ref().to_string_lossy().to_string()
}
