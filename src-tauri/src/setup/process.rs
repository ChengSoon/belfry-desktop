use std::path::Path;
use std::process::{Command, Output};

use crate::agent::login_shell_env;

pub fn run(executable: &Path, args: &[&str]) -> std::io::Result<Output> {
    let mut command = command_for(executable);
    command.args(args).env("NO_COLOR", "1");
    if let Some(path) = login_shell_env().get("PATH") {
        command.env("PATH", path);
    }
    command.output()
}

pub fn first_output_line(output: &Output) -> Option<String> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(not(target_os = "windows"))]
fn command_for(executable: &Path) -> Command {
    Command::new(executable)
}

#[cfg(target_os = "windows")]
fn command_for(executable: &Path) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let is_script = executable
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "cmd" | "bat"));
    let mut command = if is_script {
        let mut command = Command::new("cmd.exe");
        command.args(["/d", "/c"]).arg(executable);
        command
    } else {
        Command::new(executable)
    };
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
