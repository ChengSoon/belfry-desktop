use serde::Serialize;
use serde_json::Value;
use std::{
    process::{Child, ChildStdin},
    sync::{Arc, Mutex},
};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Lifecycle {
    Running,
    Shutdown,
    Cancelled,
    UnexpectedExit,
    ProtocolFailed,
    ForceTerminated,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerEvent {
    pub worker_id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<Lifecycle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

pub(super) type EventSink = Arc<dyn Fn(WorkerEvent) + Send + Sync>;
pub(super) type Cleanup = Arc<dyn Fn(&str) + Send + Sync>;

pub(super) struct WorkerProcess {
    pub child: Mutex<Child>,
    pub stdin: Mutex<Option<ChildStdin>>,
    pub lifecycle: Mutex<Lifecycle>,
    pub exit_intent: Mutex<ExitIntent>,
}

#[derive(Clone, Copy)]
pub(super) enum ExitIntent {
    None,
    Cancel,
    Shutdown,
    Force,
}

pub(super) fn lifecycle_event(
    id: &str,
    lifecycle: Lifecycle,
    detail: Option<String>,
) -> WorkerEvent {
    WorkerEvent {
        worker_id: id.into(),
        kind: "lifecycle".into(),
        message: None,
        lifecycle: Some(lifecycle),
        detail,
    }
}
