use crate::terminal::{AppError, SshTarget};
use super::contracts::RemoteReport;

const MAX_PATH: usize = 4096;
const MAX_DIRECTORIES: usize = 200;
const FRAME: &str = "BELFRY_SSH_1";

pub(crate) fn validate_remote_path(path: Option<&str>) -> Result<(), AppError> {
    if path.is_some_and(|path| !path.starts_with('/') || path.len() > MAX_PATH || path.chars().any(char::is_control)) {
        return Err(AppError::invalid_argument("远端目录必须是绝对 POSIX 路径，且不能包含控制字符"));
    }
    Ok(())
}

pub(crate) fn launch_arguments(target: &SshTarget) -> Vec<String> {
    let mut args = port_arguments(target);
    if target.remote_path.is_some() { args.push("-t".into()); }
    args.push(destination(target));
    if let Some(path) = &target.remote_path {
        args.push(format!("cd {} && exec \"${{SHELL:-/bin/sh}}\" -l", quote(path)));
    }
    args
}

pub(super) fn probe_arguments(target: &SshTarget, browse: bool) -> Vec<String> {
    let mut args = vec!["-T".to_string()];
    for option in ["BatchMode=yes", "StrictHostKeyChecking=yes", "ConnectTimeout=8", "ConnectionAttempts=1", "ControlPath=none"] {
        args.extend(["-o".into(), option.into()]);
    }
    args.extend(port_arguments(target));
    args.push(destination(target));
    args.push(directory_script(target.remote_path.as_deref(), browse));
    args
}

pub(super) fn directory_script(path: Option<&str>, browse: bool) -> String {
    let change = path.map(|value| format!("cd {} || exit 41; ", quote(value))).unwrap_or_default();
    let mut script = format!("{change}belfry_pwd=$(pwd -P) || exit 42; printf '{FRAME}\\000%s\\000' \"$belfry_pwd\"; ");
    if browse {
        script.push_str(&format!("belfry_count=0; for belfry_entry in ./* ./.[!.]* ./..?*; do \
            [ -d \"$belfry_entry\" ] || continue; belfry_count=$((belfry_count + 1)); \
            if [ \"$belfry_count\" -gt {MAX_DIRECTORIES} ]; then printf 't\\000'; break; fi; \
            printf 'd\\000%s\\000' \"${{belfry_entry#./}}\"; done; "));
    }
    script
}

pub(super) fn parse_output(bytes: &[u8]) -> Result<RemoteReport, AppError> {
    let raw = std::str::from_utf8(bytes).map_err(|_| AppError::io("远端目录名称不是 UTF-8，无法安全显示"))?;
    if !raw.ends_with('\0') { return Err(AppError::io("远端目录响应不完整")); }
    let mut fields = raw.split_terminator('\0');
    if fields.next() != Some(FRAME) { return Err(AppError::io("远端未返回目录信息；需要 POSIX Shell，且启动脚本不能向标准输出添加内容")); }
    let path = fields.next().ok_or_else(|| AppError::io("远端目录响应不完整"))?;
    validate_remote_path(Some(path))?;
    let mut report = RemoteReport { path: path.into(), directories: Vec::new(), truncated: false };
    while let Some(kind) = fields.next() {
        if kind == "t" && fields.next().is_none() { report.truncated = true; break; }
        let name = fields.next().filter(|name| valid_name(name));
        if kind != "d" || name.is_none() || report.directories.len() >= MAX_DIRECTORIES {
            return Err(AppError::io("远端目录响应包含无效条目"));
        }
        report.directories.push(name.unwrap().into());
    }
    report.directories.sort(); report.directories.dedup();
    Ok(report)
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && name.len() <= MAX_PATH
        && !name.contains('/') && !name.chars().any(char::is_control)
}
fn quote(value: &str) -> String { format!("'{}'", value.replace('\'', "'\"'\"'")) }
fn destination(target: &SshTarget) -> String {
    target.user.as_ref().map(|user| format!("{user}@{}", target.host)).unwrap_or_else(|| target.host.clone())
}
fn port_arguments(target: &SshTarget) -> Vec<String> {
    target.port.map(|port| vec!["-p".into(), port.to_string()]).unwrap_or_default()
}
