//! Native CLI locations. Keep logical agent IDs separate from executable names.
use super::AgentKind;
use std::path::{Path, PathBuf};

pub(crate) fn variable(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            super::login_shell_env()
                .get(key)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        })
}

pub(crate) fn config_dir(kind: AgentKind) -> Option<PathBuf> {
    let user = crate::history::scan::home_dir;
    match kind {
        AgentKind::Codex => variable("CODEX_HOME").or_else(|| user().map(|p| p.join(".codex"))),
        AgentKind::Claude => {
            variable("CLAUDE_CONFIG_DIR").or_else(|| user().map(|p| p.join(".claude")))
        }
        AgentKind::Pi => crate::history::scan::pi_config_dir(),
        AgentKind::Antigravity => user().map(|p| p.join(".gemini/antigravity-cli")),
        AgentKind::Opencode => variable("OPENCODE_CONFIG_DIR").or_else(|| {
            variable("XDG_CONFIG_HOME")
                .or_else(|| user().map(|p| p.join(".config")))
                .map(|p| p.join("opencode"))
        }),
        AgentKind::Kimi => {
            variable("KIMI_CODE_HOME").or_else(|| user().map(|p| p.join(".kimi-code")))
        }
    }
}

pub(crate) fn data_dir(kind: AgentKind) -> Option<PathBuf> {
    if kind == AgentKind::Opencode {
        variable("XDG_DATA_HOME")
            .or_else(|| crate::history::scan::home_dir().map(|p| p.join(".local/share")))
            .map(|p| p.join("opencode"))
    } else {
        config_dir(kind)
    }
}

pub(crate) fn opencode_database(data: &Path) -> PathBuf {
    let name = variable("OPENCODE_DB").unwrap_or_else(|| PathBuf::from("opencode.db"));
    if name.is_absolute() {
        name
    } else {
        data.join(name)
    }
}

pub(crate) fn sessions_root(kind: AgentKind) -> Option<PathBuf> {
    match kind {
        AgentKind::Codex => crate::history::scan::codex_sessions_root(),
        AgentKind::Claude => crate::history::scan::claude_sessions_root(),
        AgentKind::Pi => crate::history::scan::pi_sessions_root(),
        AgentKind::Antigravity => data_dir(kind).map(|p| p.join("brain")),
        AgentKind::Kimi => data_dir(kind).map(|p| p.join("sessions")),
        AgentKind::Opencode => data_dir(kind),
    }
}
