use super::{CommandError, CommandResult, ExecRequest};
use crate::project::resource_path;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

pub(super) const DEFAULT_TIMEOUT_MS: u64 = 60_000;
pub(super) const MAX_TIMEOUT_MS: u64 = 600_000;

pub(super) fn validate(
    request: &ExecRequest,
    root: &Path,
) -> CommandResult<(PathBuf, PathBuf, HashMap<String, String>, u64)> {
    if request.executable.is_empty()
        || request.executable.contains('\0')
        || request.argv.iter().any(|v| v.contains('\0'))
    {
        return Err(CommandError::new(
            "INVALID_PARAMS",
            "invalid executable or argv",
        ));
    }
    reject_shell(&request.executable, &request.argv)?;
    let executable = allowed_executable(&request.executable)?;
    let cwd = if request.cwd.is_empty() {
        root.to_path_buf()
    } else {
        resource_path::resolve_existing(root, &request.cwd)
            .map_err(|_| CommandError::new("PATH_OUTSIDE_ROOT", "cwd is outside project root"))?
    };
    if !cwd.is_dir() {
        return Err(CommandError::new(
            "INVALID_PARAMS",
            "cwd is not a directory",
        ));
    }
    let timeout = request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    if timeout == 0 || timeout > MAX_TIMEOUT_MS {
        return Err(CommandError::new(
            "INVALID_PARAMS",
            "timeout is outside limits",
        ));
    }
    let env = allowed_env(&request.env)?;
    Ok((executable, cwd, env, timeout))
}

fn reject_shell(executable: &str, argv: &[String]) -> CommandResult<()> {
    let name = Path::new(executable)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if [
        "sh",
        "bash",
        "zsh",
        "cmd",
        "cmd.exe",
        "powershell",
        "powershell.exe",
        "pwsh",
    ]
    .contains(&name.as_str())
        || argv
            .first()
            .is_some_and(|v| ["-c", "/c", "-command"].contains(&v.to_ascii_lowercase().as_str()))
    {
        return Err(CommandError::new(
            "EXECUTABLE_DENIED",
            "shell execution is forbidden",
        ));
    }
    Ok(())
}

fn allowed_executable(value: &str) -> CommandResult<PathBuf> {
    let name = Path::new(value)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    if !["echo", "printf", "true", "false", "sleep"].contains(&name) {
        return Err(CommandError::new(
            "EXECUTABLE_DENIED",
            "executable is not allowlisted",
        ));
    }
    for base in ["/bin", "/usr/bin"] {
        let candidate = Path::new(base).join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(CommandError::new(
        "EXECUTABLE_DENIED",
        "allowlisted executable is unavailable",
    ))
}

fn allowed_env(input: &HashMap<String, String>) -> CommandResult<HashMap<String, String>> {
    let mut result = HashMap::new();
    for (key, value) in input {
        if !["LANG", "LC_ALL", "TZ"].contains(&key.as_str()) || value.contains('\0') {
            return Err(CommandError::new(
                "ENV_DENIED",
                "environment key is not allowlisted",
            ));
        }
        result.insert(key.clone(), value.clone());
    }
    Ok(result)
}
