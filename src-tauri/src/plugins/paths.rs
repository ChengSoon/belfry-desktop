use std::path::{Component, PathBuf};

const MAX_PATH_BYTES: usize = 1024;

pub fn relative_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty()
        || value.contains('\\')
        || value.contains(':')
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("资源路径必须为插件内相对路径".into());
    }
    let path = PathBuf::from(value);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("资源路径越界".into());
    }
    Ok(path)
}

pub(super) fn portable_path(value: &str) -> Result<(), String> {
    relative_path(value)?;
    if value.len() > MAX_PATH_BYTES || value.chars().any(char::is_control) {
        return Err("插件路径过长或含控制字符".into());
    }
    if value.contains(['<', '>', '"', '|', '?', '*'])
        || value
            .split('/')
            .any(|part| part.ends_with(['.', ' ']) || reserved_name(part))
    {
        return Err("插件路径包含系统保留名称或 Windows 不支持的字符".into());
    }
    Ok(())
}

fn reserved_name(part: &str) -> bool {
    let upper = part.split('.').next().unwrap_or_default().to_uppercase();
    if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&upper.as_str()) {
        return true;
    }
    upper
        .strip_prefix("COM")
        .or_else(|| upper.strip_prefix("LPT"))
        .is_some_and(|suffix| {
            ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].contains(&suffix)
        })
}
