use super::AppError;
use portable_pty::CommandBuilder;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone, Default)]
pub(crate) struct LaunchOverlay {
    pub arguments: Vec<String>,
    pub environment: HashMap<String, String>,
    pub unset: Vec<String>,
    pub retained_files: Vec<Arc<LaunchFile>>,
    pub hook: Option<Arc<crate::agent::hooks::HookConnection>>,
    pub attachment: Option<String>,
    pub launch_epoch: u64,
}

impl std::fmt::Debug for LaunchOverlay {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LaunchOverlay")
            .field("snapshot_count", &self.retained_files.len())
            .finish_non_exhaustive()
    }
}

impl LaunchOverlay {
    pub fn apply(&self, command: &mut CommandBuilder) {
        command.args(&self.arguments);
        for key in &self.unset {
            command.env_remove(key);
        }
        for (key, value) in &self.environment {
            command.env(key, value);
        }
    }
}

pub(crate) struct LaunchFile(PathBuf);

impl LaunchFile {
    pub fn create(base: &Path, contents: &str) -> Result<Arc<Self>, AppError> {
        let directory = base.join("launch-overrides");
        private_directory(&directory)?;
        let path = directory.join(format!("{}.json", ulid::Ulid::generate()));
        crate::atomic::write_atomic(&path, contents, true)?;
        Ok(Arc::new(Self(path)))
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for LaunchFile {
    fn drop(&mut self) {
        // 仅清理本次启动创建的临时快照，最后一个 PTY 持有者释放后才删除。
        let _ = std::fs::remove_file(&self.0);
    }
}

fn private_directory(path: &Path) -> Result<(), AppError> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(path)
        .map_err(|error| AppError::io(format!("无法创建启动快照目录：{error}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| AppError::io(format!("无法保护启动快照目录：{error}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn frontend_cannot_supply_private_launch_arguments_or_snapshot_paths() {
        let request: crate::terminal::CreateTerminalRequest =
            serde_json::from_value(serde_json::json!({
                "platform": "macos", "profileId": "agent:codex", "cwd": null, "command": null,
                "cols": 80, "rows": 24, "elevation": "normal",
                "launchOverlay": { "arguments": ["unexpected"], "retainedFiles": ["/user/config"] }
            }))
            .unwrap();
        assert!(request.launch_overlay.arguments.is_empty());
        assert!(request.launch_overlay.retained_files.is_empty());
    }
}
