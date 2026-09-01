use std::path::{Path, PathBuf};
use std::process::Command;

use belfry_protocol::ENV_ENDPOINT;

use crate::agent::AgentKind;
use crate::collab::SessionIdentities;

use super::client;
use super::contracts::{CheckKind, CheckState, EnvironmentCheck, EnvironmentReport};
use super::skill::{self, SkillState};

pub fn run(endpoint: Option<&str>, identities: &SessionIdentities) -> EnvironmentReport {
    let mut checks = Vec::new();
    for agent in AgentKind::ALL {
        checks.push(skill_check(agent));
        checks.extend(client::checks(agent));
    }
    checks.push(collaboration_check(endpoint, identities));
    EnvironmentReport::new(checks)
}

fn skill_check(agent: AgentKind) -> EnvironmentCheck {
    match skill::inspect(agent) {
        Ok(inspection) => from_skill_inspection(inspection),
        Err(error) => {
            EnvironmentCheck::new(CheckKind::Skill(agent), CheckState::Error, error.message)
        }
    }
}

fn from_skill_inspection(inspection: skill::SkillInspection) -> EnvironmentCheck {
    let path = inspection.path.to_string_lossy();
    let kind = CheckKind::Skill(inspection.agent);
    match inspection.state {
        SkillState::Current => {
            EnvironmentCheck::new(kind, CheckState::Ok, format!("已同步到 {path}"))
        }
        SkillState::Missing => {
            EnvironmentCheck::new(kind, CheckState::Warning, format!("尚未安装到 {path}"))
        }
        SkillState::Outdated => {
            EnvironmentCheck::new(kind, CheckState::Warning, format!("需要更新：{path}"))
        }
    }
}

fn collaboration_check(endpoint: Option<&str>, identities: &SessionIdentities) -> EnvironmentCheck {
    let Some(endpoint) = endpoint else {
        return collab_error("Belfry 协作服务未启动");
    };
    let Some(cli) = belfry_cli_path() else {
        return collab_error("安装包中缺少 belfry 控制 CLI");
    };
    run_peers_check(&cli, endpoint, identities)
}

fn run_peers_check(cli: &Path, endpoint: &str, identities: &SessionIdentities) -> EnvironmentCheck {
    let tab_id = format!("belfry-diagnostic-{}", ulid::Ulid::generate());
    let mut command = Command::new(cli);
    command.arg("peers").env(ENV_ENDPOINT, endpoint);
    for (key, value) in identities.issue(&tab_id, None) {
        command.env(key, value);
    }
    let output = command.output();
    identities.revoke(&tab_id);
    match output {
        Ok(output) if output.status.success() => EnvironmentCheck::new(
            CheckKind::Collaboration,
            CheckState::Ok,
            "控制 CLI、协议与协作服务已连通",
        ),
        Ok(_) => collab_error("belfry peers 自检失败"),
        Err(error) => collab_error(format!("控制 CLI 无法启动：{error}")),
    }
}

fn collab_error(message: impl Into<String>) -> EnvironmentCheck {
    EnvironmentCheck::new(CheckKind::Collaboration, CheckState::Error, message)
}

fn belfry_cli_path() -> Option<PathBuf> {
    let directory = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let name = if cfg!(windows) {
        "belfry.exe"
    } else {
        "belfry"
    };
    let path = directory.join(name);
    path.is_file().then_some(path)
}
