use super::{
    cancel::Cancellation,
    snapshot::{Snapshot, io_error},
};
use crate::{
    agent::{AgentKind, AgentSessionRef},
    terminal::AppError,
};
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const MAX_ENTRIES: usize = 50_000;
const MAX_DEPTH: usize = 32;
const MAX_FILES: usize = 64;
const PROBE_BYTES: u64 = 128 * 1024;
const SCAN_TIME: Duration = Duration::from_secs(10);

pub(super) struct Sources {
    pub files: Vec<Snapshot>,
    pub note: Option<String>,
}
struct Discovery<'a> {
    root: &'a Path,
    session: &'a AgentSessionRef,
    cancel: &'a Cancellation,
    files: Vec<Snapshot>,
    pending: Vec<(PathBuf, usize)>,
    examined: usize,
    skipped: usize,
    limited: bool,
}

pub(super) fn root(agent: AgentKind) -> Result<PathBuf, AppError> {
    let path = match agent {
        AgentKind::Codex => crate::history::scan::codex_sessions_root(),
        AgentKind::Claude => crate::history::scan::claude_sessions_root(),
    };
    path.ok_or_else(|| AppError::not_found("找不到 CLI 日志目录"))
}

pub(super) fn discover(
    root: &Path,
    session: &AgentSessionRef,
    cancel: &Cancellation,
) -> Result<Sources, AppError> {
    session.validate().map_err(AppError::invalid_argument)?;
    let root = fs::canonicalize(root).map_err(io_error)?;
    let mut scan = Discovery {
        root: &root,
        session,
        cancel,
        files: Vec::new(),
        pending: vec![(root.clone(), 0)],
        examined: 0,
        skipped: 0,
        limited: false,
    };
    scan.run()?;
    scan.files.sort_by(|left, right| left.path.cmp(&right.path));
    let note = (scan.limited || scan.skipped > 0).then(|| {
        format!(
            "日志扫描可能不完整：{} 处无法读取{}",
            scan.skipped,
            if scan.limited {
                "，已达到扫描上限"
            } else {
                ""
            }
        )
    });
    Ok(Sources {
        files: scan.files,
        note,
    })
}

impl Discovery<'_> {
    fn run(&mut self) -> Result<(), AppError> {
        let started = Instant::now();
        while let Some((directory, depth)) = self.pending.pop() {
            self.cancel.check()?;
            let entries = match fs::read_dir(directory) {
                Ok(entries) => entries,
                Err(_) => {
                    self.skipped += 1;
                    continue;
                }
            };
            for entry in entries {
                self.cancel.check()?;
                self.examined += 1;
                if self.examined > MAX_ENTRIES
                    || self.files.len() >= MAX_FILES
                    || started.elapsed() > SCAN_TIME
                {
                    self.limited = true;
                    break;
                }
                match entry {
                    Ok(entry) => self.inspect(entry, depth),
                    Err(_) => self.skipped += 1,
                }
            }
            if self.limited {
                break;
            }
        }
        Ok(())
    }

    fn inspect(&mut self, entry: fs::DirEntry, depth: usize) {
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() && depth < MAX_DEPTH => {
                if path.file_name().is_none_or(|name| name != "subagents") {
                    self.pending.push((path, depth + 1));
                }
            }
            Ok(kind) if kind.is_dir() => self.limited = true,
            Ok(kind)
                if kind.is_file()
                    && path
                        .extension()
                        .is_some_and(|extension| extension == "jsonl") =>
            {
                self.file(&path)
            }
            Err(_) => self.skipped += 1,
            _ => {}
        }
    }

    fn file(&mut self, path: &Path) {
        if self.session.agent == AgentKind::Claude
            && path.file_stem().and_then(|name| name.to_str()) != Some(&self.session.id)
        {
            return;
        }
        let result = Snapshot::capture(self.root, path).and_then(|snapshot| {
            if self.session.agent == AgentKind::Claude
                || identifies(&snapshot, &self.session.id, self.cancel)?
            {
                Ok(Some(snapshot))
            } else {
                Ok(None)
            }
        });
        match result {
            Ok(Some(snapshot)) => self.files.push(snapshot),
            Err(_) => self.skipped += 1,
            _ => {}
        }
    }
}

fn identifies(snapshot: &Snapshot, id: &str, cancel: &Cancellation) -> Result<bool, AppError> {
    cancel.check()?;
    let mut bytes = Vec::new();
    snapshot
        .open()?
        .take(PROBE_BYTES)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    for line in bytes.split(|byte| *byte == b'\n').take(8) {
        let Ok(value) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if value["type"] == "session_meta" {
            return Ok(value["payload"]["session_id"]
                .as_str()
                .or_else(|| value["payload"]["id"].as_str())
                == Some(id));
        }
    }
    Ok(false)
}
