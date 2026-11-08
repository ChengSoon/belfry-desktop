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
        AgentKind::Pi => crate::history::scan::pi_sessions_root(),
        AgentKind::Antigravity | AgentKind::Opencode | AgentKind::Kimi => {
            crate::history::native::root(agent)
        }
    };
    path.ok_or_else(|| AppError::not_found(belfry_i18n::text("找不到 CLI 日志目录")))
}

pub(super) fn discover(
    root: &Path,
    session: &AgentSessionRef,
    cancel: &Cancellation,
) -> Result<Sources, AppError> {
    session.validate().map_err(AppError::invalid_argument)?;
    let root = fs::canonicalize(root).map_err(io_error)?;
    if crate::history::native::supported(session.agent) {
        cancel.check()?;
        let path = crate::history::native::cache_file(&root, &session.id);
        return Ok(Sources {
            files: vec![Snapshot::capture(&root, &path)?],
            note: None,
        });
    }
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
    let note = scan_note(scan.skipped, scan.limited);
    Ok(Sources {
        files: scan.files,
        note,
    })
}

fn scan_note(count: usize, limited: bool) -> Option<String> {
    if limited {
        Some(belfry_i18n::lformat!("日志扫描可能不完整：{count} 处无法读取，已达到扫描上限。"))
    } else if count > 0 {
        Some(belfry_i18n::lformat!("日志扫描可能不完整：{count} 处无法读取。"))
    } else {
        None
    }
}

#[cfg(test)]
mod notice_tests {
    use super::*;

    #[test]
    fn regression_scan_notices_keep_complete_templates_and_count_only_parameters() {
        for locale in [belfry_i18n::Locale::ZhCn, belfry_i18n::Locale::En] {
            belfry_i18n::with_locale(locale, || {
                assert!(scan_note(0, false).is_none());
                for (limited, code) in [(true, "HISTORY_SCAN_LIMIT_REACHED"), (false, "HISTORY_THE_LOG_SCAN_MAY_BE_INCOMPLETE_UNREADABLE")] {
                    let note = scan_note(2, limited).unwrap();
                    let text = belfry_i18n::error_text(&note).unwrap();
                    assert_eq!(text.code, code);
                    assert_eq!(text.params, std::collections::BTreeMap::from([("count".into(), serde_json::json!(2))]));
                }
            });
        }
    }
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
