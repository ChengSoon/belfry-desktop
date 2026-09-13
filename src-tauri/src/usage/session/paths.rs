use crate::{
    agent::{AgentKind, AgentSessionRef},
    terminal::AppError,
};
use std::{
    fs,
    path::{Path, PathBuf},
};

const MAX_LOG_FILES: usize = 64;
const MAX_DIRECTORY_ENTRIES: usize = 50_000;
const MAX_DIRECTORY_DEPTH: usize = 32;

#[derive(Default)]
pub(super) struct Resolved {
    pub paths: Vec<PathBuf>,
    pub limited: bool,
}

pub(super) fn root(agent: AgentKind) -> Result<PathBuf, AppError> {
    let (variable, directory, child) = match agent {
        AgentKind::Codex => ("CODEX_HOME", ".codex", "sessions"),
        AgentKind::Claude => ("CLAUDE_CONFIG_DIR", ".claude", "projects"),
    };
    std::env::var_os(variable)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| crate::usage::home_dir().map(|home| home.join(directory)))
        .map(|root| root.join(child))
        .ok_or_else(|| AppError::not_found("找不到 CLI 日志目录"))
}

pub(super) fn resolve(
    root: &Path,
    session: &AgentSessionRef,
    hint: Option<&str>,
) -> Result<Resolved, AppError> {
    session.validate().map_err(AppError::invalid_argument)?;
    let root = match fs::canonicalize(root) {
        Ok(root) => root,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Resolved::default());
        }
        Err(error) => return Err(AppError::io(error.to_string())),
    };
    let mut result = discover(&root, session);
    if let Some(hint) = hint {
        if let Some(path) = allowed(&root, Path::new(hint))? {
            result.paths.push(path);
        }
    }
    result.paths = result
        .paths
        .into_iter()
        .filter_map(|path| allowed(&root, &path).ok().flatten())
        .filter(|path| belongs(path, session))
        .collect();
    result.paths.sort();
    result.paths.dedup();
    result.limited |= result.paths.len() > MAX_LOG_FILES;
    result.paths.truncate(MAX_LOG_FILES);
    Ok(result)
}

fn discover(root: &Path, session: &AgentSessionRef) -> Resolved {
    let mut scan = Discovery {
        session,
        result: Resolved::default(),
        pending: vec![(root.to_path_buf(), 0)],
    };
    let mut examined = 0;
    while let Some((directory, depth)) = scan.pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            examined += 1;
            if examined > MAX_DIRECTORY_ENTRIES || scan.result.paths.len() > MAX_LOG_FILES {
                scan.result.limited = true;
                return scan.result;
            }
            scan.inspect(entry, depth);
        }
    }
    scan.result
}

struct Discovery<'a> {
    session: &'a AgentSessionRef,
    result: Resolved,
    pending: Vec<(PathBuf, usize)>,
}

impl Discovery<'_> {
    fn inspect(&mut self, entry: fs::DirEntry, depth: usize) {
        match entry.file_type() {
            Ok(kind) if kind.is_dir() && depth < MAX_DIRECTORY_DEPTH => {
                self.pending.push((entry.path(), depth + 1))
            }
            Ok(kind) if kind.is_dir() => self.result.limited = true,
            Ok(kind) if kind.is_file() && matches_name(&entry.path(), self.session) => {
                self.result.paths.push(entry.path())
            }
            _ => {}
        }
    }
}

fn matches_name(path: &Path, session: &AgentSessionRef) -> bool {
    if path
        .extension()
        .is_none_or(|extension| extension != "jsonl")
    {
        return false;
    }
    let name = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    name == session.id
        || (session.agent == AgentKind::Codex && name.ends_with(&format!("-{}", session.id)))
}

fn belongs(path: &Path, session: &AgentSessionRef) -> bool {
    match session.agent {
        AgentKind::Claude => matches_name(path, session),
        AgentKind::Codex => {
            crate::history::codex::session_id_from_meta(path).as_deref() == Some(&session.id)
        }
    }
}

pub(super) fn allowed(root: &Path, path: &Path) -> Result<Option<PathBuf>, AppError> {
    let path = match fs::canonicalize(path) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::io(error.to_string())),
    };
    if !path.starts_with(root)
        || path
            .extension()
            .is_none_or(|extension| extension != "jsonl")
        || !path.is_file()
    {
        return Err(AppError::invalid_argument(
            "会话日志必须是 CLI 日志目录内的 JSONL 文件",
        ));
    }
    Ok(Some(path))
}
