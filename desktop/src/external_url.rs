use std::process::{Command, Stdio};

pub(crate) fn open(url: String) -> Result<(), String> {
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
