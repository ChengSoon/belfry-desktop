//! 应用日志：UTC 按天滚动，单片 1 MiB、总量 10 MiB、最多保留七天。
//! 诊断包只复制本模块写出的脱敏记录和固定平台字段，不收集配置、环境或终端内容。
mod redaction;
#[cfg(test)]
mod tests;

use crate::terminal::AppError;
use log::{Level, LevelFilter, Log, Metadata, Record};
use redaction::{bounded, redact, secret_key};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};

const FILE_BYTES: u64 = 1024 * 1024;
const TOTAL_BYTES: u64 = 10 * FILE_BYTES;
const RETAIN_DAYS: i64 = 7;
const ENTRY_BYTES: usize = 64 * 1024;
static LOGGER: OnceLock<AppLogger> = OnceLock::new();

/// Shared by structured error parameters and their English fallback.
pub(crate) fn sanitize_error(value: &str) -> String { redact(bounded(value, 8192)) }

pub(crate) fn sanitize_error_parameter(name: &str, value: &str) -> String {
    if secret_key(name) { "[REDACTED]".into() } else { sanitize_error(value) }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogEntry {
    pub level: LogLevel,
    pub source: String,
    pub message: String,
    pub stack: Option<String>,
    #[serde(default)]
    pub context: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredEntry {
    timestamp: i64,
    #[serde(flatten)]
    entry: LogEntry,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExport {
    pub path: String,
    pub size_bytes: u64,
    pub created_at: i64,
    pub summary: String,
}

struct AppLogger {
    store: LogStore,
}

struct LogStore {
    root: PathBuf,
    write_lock: Mutex<()>,
    file_bytes: u64,
    total_bytes: u64,
}

/// 在 Builder 前安装，启动失败、后台进程和 Rust panic 也能写入同一日志目录。
pub fn init(identifier: &str) {
    let Some(root) = dirs::data_dir().map(|dir| dir.join(identifier).join("logs")) else {
        return;
    };
    let logger = LOGGER.get_or_init(|| AppLogger {
        store: LogStore::new(root),
    });
    if log::set_logger(logger).is_ok() {
        log::set_max_level(LevelFilter::Info);
        install_panic_hook();
        log::info!(
            "Belfry {} started ({}/{})",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH
        );
    }
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("non-string panic");
        let source = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "rust.panic".into());
        if let Some(logger) = LOGGER.get() {
            let _ = logger.store.write(
                LogEntry {
                    level: LogLevel::Error,
                    source: format!("rust.panic:{source}"),
                    message: message.into(),
                    stack: Some(std::backtrace::Backtrace::force_capture().to_string()),
                    context: BTreeMap::new(),
                },
                now(),
            );
        }
        previous(info);
    }));
}

impl Log for AppLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        // 不收第三方 HTTP wire/debug 输出，避免请求头或正文进入日志。
        metadata.level() <= Level::Info && metadata.target().starts_with("belfry_desktop_lib")
    }
    fn log(&self, record: &Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let level = match record.level() {
            Level::Error => LogLevel::Error,
            Level::Warn => LogLevel::Warn,
            _ => LogLevel::Info,
        };
        let _ = self.store.write(
            LogEntry {
                level,
                source: record.target().into(),
                message: record.args().to_string(),
                stack: None,
                context: BTreeMap::new(),
            },
            now(),
        );
    }
    fn flush(&self) {} // write() 在返回前关闭文件；错误级别同时 sync_data。
}

impl LogStore {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            write_lock: Mutex::new(()),
            file_bytes: FILE_BYTES,
            total_bytes: TOTAL_BYTES,
        }
    }

    fn write(&self, mut entry: LogEntry, timestamp: i64) -> Result<(), AppError> {
        entry.sanitize();
        let sync = matches!(entry.level, LogLevel::Error);
        let mut bytes = serde_json::to_vec(&StoredEntry { timestamp, entry }).map_err(io)?;
        bytes.push(b'\n');
        if bytes.len() as u64 > self.file_bytes {
            return Err(AppError::invalid_argument("日志条目超过限制"));
        }
        let _guard = self
            .write_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        fs::create_dir_all(&self.root).map_err(io)?;
        self.prune(timestamp, bytes.len() as u64)?;
        let day = time::OffsetDateTime::from_unix_timestamp(timestamp)
            .map_err(io)?
            .date();
        let prefix = format!("belfry-{day}-{}", std::process::id());
        let mut index = 0u32;
        let path = loop {
            let path = self.root.join(format!("{prefix}-{index:05}.jsonl"));
            if fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0) + bytes.len() as u64
                <= self.file_bytes
            {
                break path;
            }
            index += 1;
        };
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(path).map_err(io)?;
        file.write_all(&bytes).map_err(io)?;
        if sync {
            file.sync_data().map_err(io)?;
        }
        Ok(())
    }

    fn files(&self) -> Result<Vec<(PathBuf, u64)>, AppError> {
        if !self.root.exists() {
            return Ok(Vec::new());
        }
        let mut files = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(io)? {
            let entry = entry.map_err(io)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let meta = entry.path().symlink_metadata().map_err(io)?;
            if meta.is_file() && name.starts_with("belfry-") && name.ends_with(".jsonl") {
                files.push((entry.path(), meta.len()));
            }
        }
        files.sort_by(|left, right| left.0.cmp(&right.0));
        Ok(files)
    }

    fn prune(&self, timestamp: i64, reserve: u64) -> Result<(), AppError> {
        let cutoff = time::OffsetDateTime::from_unix_timestamp(timestamp - RETAIN_DAYS * 86400)
            .map_err(io)?
            .date()
            .to_string();
        let files = self.files()?;
        let mut total: u64 = files.iter().map(|(_, size)| size).sum();
        for (path, size) in files {
            let name = path.file_name().unwrap().to_string_lossy();
            let expired = name.get(7..17).is_some_and(|date| date < cutoff.as_str());
            if expired || total.saturating_add(reserve) > self.total_bytes {
                fs::remove_file(path).map_err(io)?;
                total = total.saturating_sub(size);
            }
        }
        Ok(())
    }

    fn export(&self, destination: &Path, timestamp: i64) -> Result<DiagnosticExport, AppError> {
        let _guard = self
            .write_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut logs = Vec::new();
        let mut remaining = self.total_bytes;
        // 只解析我们的结构化记录；非法行不照抄，旧文件也再脱敏一次。
        for (path, _) in self.files()?.into_iter().rev() {
            if remaining == 0 {
                break;
            }
            let mut bytes = Vec::new();
            File::open(path)
                .map_err(io)?
                .take(remaining.min(self.file_bytes))
                .read_to_end(&mut bytes)
                .map_err(io)?;
            remaining = remaining.saturating_sub(bytes.len() as u64);
            for line in bytes.split(|byte| *byte == b'\n') {
                if let Ok(mut entry) = serde_json::from_slice::<StoredEntry>(line) {
                    entry.entry.sanitize();
                    logs.push(entry);
                }
            }
        }
        logs.sort_by_key(|entry| entry.timestamp);
        let summary = format!(
            "Belfry {} | {} {} | {} log entries | {} UTC",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH,
            logs.len(),
            timestamp
        );
        let text = serde_json::to_string(&serde_json::json!({
            "format": "belfry.diagnostics", "version": 1, "createdAt": timestamp,
            "appVersion": env!("CARGO_PKG_VERSION"), "platform": std::env::consts::OS,
            "architecture": std::env::consts::ARCH, "summary": summary,
            "retention": { "days": RETAIN_DAYS, "maxBytes": self.total_bytes }, "logs": logs,
        }))
        .map_err(io)?;
        crate::atomic::write_atomic(destination, &text, true)?;
        Ok(DiagnosticExport {
            path: destination.to_string_lossy().into_owned(),
            size_bytes: text.len() as u64,
            created_at: timestamp,
            summary,
        })
    }
}

impl LogEntry {
    fn validate(&self) -> Result<(), AppError> {
        if self.source.trim().is_empty()
            || self.source.len() > 256
            || self.message.len() > 8192
            || self.stack.as_ref().is_some_and(|stack| stack.len() > 32768)
            || self.context.len() > 32
            || self
                .context
                .iter()
                .any(|(key, value)| key.len() > 128 || value.len() > 1024)
            || serde_json::to_vec(self).map_err(io)?.len() > ENTRY_BYTES
        {
            return Err(AppError::invalid_argument("日志条目超过限制或来源为空"));
        }
        Ok(())
    }
    fn sanitize(&mut self) {
        self.source = redact(bounded(&self.source, 256));
        self.message = redact(bounded(&self.message, 8192));
        self.stack = self
            .stack
            .as_ref()
            .map(|stack| redact(bounded(stack, 32768)));
        self.context = self
            .context
            .iter()
            .take(32)
            .map(|(key, value)| {
                (
                    redact(bounded(key, 128)),
                    if secret_key(key) {
                        "[REDACTED]".into()
                    } else {
                        redact(bounded(value, 1024))
                    },
                )
            })
            .collect();
    }
}

#[tauri::command]
pub async fn app_log_write(app: AppHandle, entry: LogEntry) -> Result<(), AppError> {
    entry.validate()?;
    let root = app.path().app_data_dir().map_err(io)?.join("logs");
    tauri::async_runtime::spawn_blocking(move || match LOGGER.get() {
        Some(logger) => logger.store.write(entry, now()),
        None => LogStore::new(root).write(entry, now()),
    })
    .await
    .map_err(io)?
}

#[tauri::command]
pub async fn diagnostics_export(app: AppHandle) -> Result<DiagnosticExport, AppError> {
    let root = app.path().app_data_dir().map_err(io)?;
    tauri::async_runtime::spawn_blocking(move || {
        // 覆盖上次导出，避免反复点击另外制造无上限的诊断副本。
        let destination = root.join("diagnostics").join("belfry-diagnostics.json");
        match LOGGER.get() {
            Some(logger) => logger.store.export(&destination, now()),
            None => LogStore::new(root.join("logs")).export(&destination, now()),
        }
    })
    .await
    .map_err(io)?
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn io(error: impl std::fmt::Display) -> AppError {
    AppError::io(format!("应用日志不可用：{error}"))
}
