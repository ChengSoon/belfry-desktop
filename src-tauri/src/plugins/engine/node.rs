use std::path::PathBuf;

pub fn executable() -> Result<PathBuf, String> {
    if let Some(path) = crate::agent::find_in_path("node") {
        return Ok(path);
    }
    let candidates = crate::agent::user_command_path()
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();
    for directory in candidates.into_iter().chain([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]) {
        let path = directory.join(if cfg!(windows) { "node.exe" } else { "node" });
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(
        "未找到 Node.js。请安装 Node.js 20 或更新版本并重新打开 Belfry；已安装的静态插件仍可使用。"
            .into(),
    )
}
