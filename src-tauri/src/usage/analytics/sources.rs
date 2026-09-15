use super::cancel::Check;
use crate::{
    agent::AgentKind,
    usage::{claude, codex},
};
use std::{
    io::ErrorKind,
    path::{Path, PathBuf},
};

const MAX_SOURCE_ENTRIES: usize = 100_000;

#[derive(Clone)]
pub(super) struct SourceRoots {
    pub claude: Option<PathBuf>,
    pub codex: Option<PathBuf>,
}

impl Default for SourceRoots {
    fn default() -> Self {
        Self {
            claude: claude::sessions_dir(),
            codex: codex::sessions_dir(),
        }
    }
}

impl SourceRoots {
    pub fn files(&self, check: Check<'_>) -> Result<Vec<(AgentKind, PathBuf)>, String> {
        let mut files = Vec::new();
        for (agent, root) in [
            (AgentKind::Claude, &self.claude),
            (AgentKind::Codex, &self.codex),
        ] {
            if let Some(root) = root {
                let mut paths = collect(root, check)?;
                paths.sort();
                files.extend(paths.into_iter().map(|path| (agent, path)));
            }
        }
        Ok(files)
    }
}

fn collect(root: &Path, check: Check<'_>) -> Result<Vec<PathBuf>, String> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    let mut visited = 0;
    while let Some(directory) = pending.pop() {
        check()?;
        let entries = match std::fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(_) => return Err("无法读取本地用量日志目录，请检查访问权限后重试".into()),
        };
        for entry in entries {
            check()?;
            visited += 1;
            if visited > MAX_SOURCE_ENTRIES {
                return Err("用量日志目录项目过多，超过扫描上限".into());
            }
            let entry = entry.map_err(|_| "无法读取用量日志目录项")?;
            let kind = entry.file_type().map_err(|_| "无法读取用量日志文件信息")?;
            if kind.is_dir() {
                pending.push(entry.path());
            }
            if kind.is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|value| value == "jsonl")
            {
                files.push(entry.path());
            }
        }
    }
    Ok(files)
}
