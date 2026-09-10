pub mod broker;
pub mod command;
pub mod commands;
mod framer;
mod manager;
#[cfg(test)]
mod manager_tests;
pub mod patch;
mod process;
pub mod registry;
mod types;
mod validation;

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};

use manager::WorkerManager;

pub struct HarnessWorkerRuntime {
    pub(crate) manager: WorkerManager,
    pub(crate) broker: broker::ReadBroker,
    pub(crate) patch: patch::PatchBroker,
    pub(crate) registry: Arc<registry::SystemRegistry>,
    pub(crate) command: Arc<command::CommandBroker>,
    pub(crate) audit: Arc<AuditLog>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecord {
    pub id: String,
    pub timestamp: u64,
    pub phase: String,
    pub session_id: String,
    pub worker_id: Option<String>,
    pub plugin_id: Option<String>,
    pub version: Option<String>,
    pub request_id: String,
    pub tool_id: String,
    pub duration_ms: u64,
    pub summary: String,
    pub error_code: Option<String>,
    pub truncated: bool,
}
pub struct AuditLog {
    records: Mutex<Vec<AuditRecord>>,
    path: PathBuf,
}
impl AuditLog {
    fn new(path: PathBuf) -> Self {
        let tmp = path.with_extension("tmp");
        let _ = fs::remove_file(tmp);
        let records = fs::read_to_string(&path)
            .ok()
            .map(|text| {
                text.lines()
                    .filter_map(|line| serde_json::from_str(line).ok())
                    .collect()
            })
            .unwrap_or_default();
        Self {
            records: Mutex::new(records),
            path,
        }
    }
    fn push(&self, mut record: AuditRecord) {
        record.summary = record.summary.chars().take(512).collect();
        let mut records = self.records.lock().unwrap();
        if records.iter().any(|existing| existing.id == record.id) {
            return;
        }
        records.push(record);
        if records.len() > 1000 {
            let excess = records.len() - 1000;
            records.drain(..excess);
        }
        let tmp = self.path.with_extension("tmp");
        let text = records
            .iter()
            .filter_map(|item| serde_json::to_string(item).ok())
            .map(|line| format!("{line}\n"))
            .collect::<String>();
        let _ = fs::write(&tmp, text).and_then(|_| fs::rename(&tmp, &self.path));
    }
    fn query(&self, query: &AuditQuery) -> AuditPage {
        let records = self.records.lock().unwrap();
        let filtered: Vec<_> = records
            .iter()
            .filter(|r| {
                query.session_id.as_ref().is_none_or(|v| r.session_id == *v)
                    && query
                        .worker_id
                        .as_ref()
                        .is_none_or(|v| r.worker_id.as_ref() == Some(v))
                    && query
                        .plugin_id
                        .as_ref()
                        .is_none_or(|v| r.plugin_id.as_ref() == Some(v))
                    && query
                        .version
                        .as_ref()
                        .is_none_or(|v| r.version.as_ref() == Some(v))
            })
            .cloned()
            .collect();
        let cursor = query.cursor.unwrap_or(0).min(filtered.len());
        let limit = query.limit.unwrap_or(100).clamp(1, 100);
        let next = (cursor + limit < filtered.len()).then_some(cursor + limit);
        let total = filtered.len();
        AuditPage {
            events: filtered.into_iter().skip(cursor).take(limit).collect(),
            next_cursor: next,
            total,
        }
    }
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditQuery {
    pub session_id: Option<String>,
    pub worker_id: Option<String>,
    pub plugin_id: Option<String>,
    pub version: Option<String>,
    pub cursor: Option<usize>,
    pub limit: Option<usize>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditPage {
    pub events: Vec<AuditRecord>,
    pub next_cursor: Option<usize>,
    pub total: usize,
}

#[cfg(test)]
mod audit_tests {
    use super::*;
    fn record(id: &str, session: &str) -> AuditRecord {
        AuditRecord {
            id: id.into(),
            timestamp: 10,
            phase: "completed".into(),
            session_id: session.into(),
            worker_id: Some("w".into()),
            plugin_id: Some("p".into()),
            version: Some("1.0.0".into()),
            request_id: "r".into(),
            tool_id: "t".into(),
            duration_ms: 1,
            summary: "safe".into(),
            error_code: None,
            truncated: false,
        }
    }
    #[test]
    fn recovery_skips_partial_lines_and_removes_stale_temp() {
        let path = std::env::temp_dir().join(format!("audit-{}.jsonl", ulid::Ulid::generate()));
        std::fs::write(path.with_extension("tmp"), "junk").unwrap();
        std::fs::write(
            &path,
            format!(
                "{}\n{{\"broken\"",
                serde_json::to_string(&record("a", "s")).unwrap()
            ),
        )
        .unwrap();
        let log = AuditLog::new(path.clone());
        assert_eq!(
            log.query(&AuditQuery {
                session_id: Some("s".into()),
                ..Default::default()
            })
            .total,
            1
        );
        assert!(!path.with_extension("tmp").exists());
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn duplicate_ids_are_idempotent_and_bounded() {
        let path = std::env::temp_dir().join(format!("audit-{}.jsonl", ulid::Ulid::generate()));
        let log = AuditLog::new(path.clone());
        log.push(record("same", "s"));
        log.push(record("same", "s"));
        for i in 0..1001 {
            log.push(record(&format!("{i}"), "s"));
        }
        assert_eq!(
            log.query(&AuditQuery {
                ..Default::default()
            })
            .total,
            1000
        );
        let _ = std::fs::remove_file(path);
    }
}

impl HarnessWorkerRuntime {
    pub fn new(app: AppHandle) -> Self {
        let audit_path = app
            .path()
            .app_data_dir()
            .unwrap_or_default()
            .join("harness/audit.jsonl");
        if let Some(parent) = audit_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let audit = Arc::new(AuditLog::new(audit_path));
        let audit_for_command = audit.clone();
        let script =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/harness/worker.mjs");
        let command_app = app.clone();
        let command = Arc::new(command::CommandBroker::new(move |event| {
            audit_for_command.push(AuditRecord {
                id: ulid::Ulid::generate().to_string(),
                timestamp: 0,
                phase: event.phase.into(),
                session_id: event.session_id.clone(),
                worker_id: None,
                plugin_id: None,
                version: None,
                request_id: event.request_id.clone(),
                tool_id: event.tool_id.clone(),
                duration_ms: event.duration_ms,
                summary: event.summary.clone(),
                error_code: event.error_code.map(str::to_owned),
                truncated: false,
            });
            let _ = command_app.emit("harness-command-audit", event);
        }));
        let worker_app = app.clone();
        let command_cleanup = command.clone();
        let manager = WorkerManager::new(script, move |event| {
            let terminal_worker = event.worker_id.clone();
            let terminal = event.kind == "lifecycle"
                && event
                    .lifecycle
                    .as_ref()
                    .is_some_and(|state| *state != types::Lifecycle::Running);
            let _ = worker_app.emit("harness-worker", event);
            if terminal {
                command_cleanup.cancel_worker(&terminal_worker);
            }
        });
        let audit_app = app.clone();
        let audit_broker = audit.clone();
        let broker = broker::ReadBroker::new(move |event| {
            audit_broker.push(AuditRecord {
                id: ulid::Ulid::generate().to_string(),
                timestamp: 0,
                phase: event.phase.into(),
                session_id: event.session_id.clone(),
                worker_id: None,
                plugin_id: None,
                version: None,
                request_id: event.request_id.clone(),
                tool_id: event.tool_id.clone(),
                duration_ms: event.duration_ms,
                summary: event.summary.clone(),
                error_code: event.error_code.map(str::to_owned),
                truncated: false,
            });
            let _ = audit_app.emit("harness-broker-audit", event);
        });
        let patch_app = app.clone();
        let audit_patch = audit.clone();
        let patch = patch::PatchBroker::new(move |event| {
            audit_patch.push(AuditRecord {
                id: ulid::Ulid::generate().to_string(),
                timestamp: 0,
                phase: event.phase.into(),
                session_id: event.session_id.clone(),
                worker_id: None,
                plugin_id: None,
                version: None,
                request_id: event.request_id.clone(),
                tool_id: event.tool_id.clone(),
                duration_ms: event.duration_ms,
                summary: event.summary.clone(),
                error_code: event.error_code.map(str::to_owned),
                truncated: false,
            });
            let _ = patch_app.emit("harness-patch-audit", event);
        });
        let registry_path = app
            .path()
            .app_data_dir()
            .unwrap_or_default()
            .join("harness/registry-v1.json");
        let registry_app = app.clone();
        let audit_registry = audit.clone();
        let registry = Arc::new(registry::SystemRegistry::new(registry_path, move |event| {
            audit_registry.push(AuditRecord {
                id: ulid::Ulid::generate().to_string(),
                timestamp: 0,
                phase: "registry".into(),
                session_id: String::new(),
                worker_id: None,
                plugin_id: event.plugin_id.clone(),
                version: None,
                request_id: String::new(),
                tool_id: event.action.clone(),
                duration_ms: 0,
                summary: event.summary.clone(),
                error_code: None,
                truncated: false,
            });
            let _ = registry_app.emit("harness-registry-audit", event);
        }));
        Self {
            manager,
            broker,
            patch,
            registry,
            command,
            audit,
        }
    }

    pub fn close_all(&self) {
        self.command.close_all();
        self.manager.stop_all();
    }
}
