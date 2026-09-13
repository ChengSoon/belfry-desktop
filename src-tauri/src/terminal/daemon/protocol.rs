use super::super::contracts::{
    CreateTerminalRequest, TerminalEvent, TerminalPalette, TerminalSession,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const VERSION: u16 = 1;
pub const MAX_FRAME: u64 = 8 * 1024 * 1024;
pub const MAX_SESSIONS: usize = 64;
pub const CACHE_BYTES: usize = 2 * 1024 * 1024;
pub const POLL_BYTES: usize = 128 * 1024;
pub const FLAG: &str = "--belfry-terminal-daemon";

#[derive(Clone, Serialize, Deserialize)]
pub struct Endpoint {
    pub version: u16,
    pub port: u16,
    pub token: String,
    pub instance: String,
    pub pid: u32,
}
#[derive(Serialize, Deserialize)]
pub struct Request {
    pub version: u16,
    pub token: String,
    pub command: Command,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Command {
    Ping,
    Info {
        id: String,
    },
    Lookup {
        tab_id: String,
    },
    Create {
        launch: CreateTerminalRequest,
        overlay: WireOverlay,
        attachment: Option<String>,
    },
    Poll {
        id: String,
        cursor: u64,
    },
    Write {
        id: String,
        bytes: Vec<u8>,
    },
    Resize {
        id: String,
        cols: u16,
        rows: u16,
    },
    Palette {
        id: String,
        palette: TerminalPalette,
    },
    Close {
        id: String,
    },
    CloseTab {
        tab_id: String,
    },
    List,
    Shutdown,
    AcquireWorkspace,
    RenewWorkspace {
        token: String,
    },
    ReleaseWorkspace {
        token: String,
    },
}
#[derive(Default, Serialize, Deserialize)]
pub struct WireOverlay {
    pub arguments: Vec<String>,
    pub environment: HashMap<String, String>,
    pub unset: Vec<String>,
    pub files: Vec<WireFile>,
}
#[derive(Serialize, Deserialize)]
pub struct WireFile {
    pub original: String,
    pub contents: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session: TerminalSession,
    pub tab_id: Option<String>,
    pub profile_id: String,
    pub native_session: Option<crate::agent::AgentSessionRef>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Frame {
    pub cursor: u64,
    pub event: TerminalEvent,
}
#[derive(Serialize, Deserialize)]
pub struct PollResult {
    pub cursor: u64,
    pub gap: Option<TerminalEvent>,
    pub frames: Vec<Frame>,
}
#[derive(Serialize, Deserialize)]
pub struct Reply {
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}
impl Reply {
    pub fn ok(value: impl Serialize) -> Self {
        match serde_json::to_value(value) {
            Ok(result) => Self {
                result: Some(result),
                error: None,
            },
            Err(error) => Self::error(error.to_string()),
        }
    }
    pub fn error(error: impl Into<String>) -> Self {
        Self {
            result: None,
            error: Some(error.into()),
        }
    }
}
