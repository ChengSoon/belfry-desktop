use std::{
    io::{Read, Write},
    process::{Command, Stdio},
};

const LIMIT: usize = 512 * 1024;
fn command(write: bool) -> Command {
    #[cfg(target_os = "macos")]
    {
        Command::new(if write {
            "/usr/bin/pbcopy"
        } else {
            "/usr/bin/pbpaste"
        })
    }
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            if write {
                "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())"
            } else {
                "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::Out.Write((Get-Clipboard -Raw))"
            },
        ]);
        command
    }
    #[cfg(target_os = "linux")]
    {
        let mut command = Command::new("xclip");
        command.args([
            "-selection",
            "clipboard",
            if write { "-in" } else { "-out" },
        ]);
        command
    }
}
pub fn access(text: Option<&str>) -> Result<String, String> {
    if text.is_some_and(|value| value.len() > LIMIT) {
        return Err("剪贴板内容过大".into());
    }
    let mut process = command(text.is_some())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("剪贴板不可用：{e}"))?;
    if let Some(text) = text {
        process
            .stdin
            .take()
            .ok_or("剪贴板输入不可用")?
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    drop(process.stdin.take());
    let mut bytes = Vec::new();
    process
        .stdout
        .take()
        .ok_or("剪贴板输出不可用")?
        .take((LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > LIMIT {
        let _ = process.kill();
        let _ = process.wait();
        return Err("剪贴板内容过大".into());
    }
    if !process.wait().map_err(|e| e.to_string())?.success() {
        return Err("剪贴板读写失败".into());
    }
    String::from_utf8(bytes).map_err(|_| "剪贴板文本不是 UTF-8".into())
}
