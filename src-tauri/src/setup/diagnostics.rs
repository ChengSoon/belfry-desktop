use std::time::Duration;

use serde_json::Value;

use super::contracts::{CheckKind, CheckState, EnvironmentCheck, EnvironmentReport};
use super::{
    client,
    migration::{self, CopyState},
};
use crate::agent::AgentKind;

pub fn run(gateway: &Value) -> EnvironmentReport {
    let mut checks = Vec::new();
    for agent in AgentKind::ALL {
        checks.push(adapter_check(agent, gateway));
        checks.extend(client::checks(agent));
    }
    checks.push(collaboration_check(gateway));
    checks.push(migration_check());
    EnvironmentReport::new(checks)
}

fn adapter_check(agent: AgentKind, gateway: &Value) -> EnvironmentCheck {
    let count = gateway["adapters"]
        .as_array()
        .and_then(|adapters| {
            adapters
                .iter()
                .find(|adapter| adapter["agent"] == agent.id())
        })
        .and_then(|adapter| adapter["readyInstances"].as_u64())
        .unwrap_or(0);
    let (state, summary) = if count > 0 {
        (
            CheckState::Ok,
            belfry_i18n::lformat!("已验证 {count} 个运行中实例的 A2A 工具就绪"),
        )
    } else if matches!(agent, AgentKind::Codex | AgentKind::Claude) {
        (
            CheckState::Warning,
            belfry_i18n::text("尚无就绪实例；启动托管 Agent 并读取工具目录后可自动发现")
                .to_string(),
        )
    } else {
        (
            CheckState::Warning,
            belfry_i18n::text("此 CLI 尚无经验证的自动 A2A 执行与报告适配器").to_string(),
        )
    };
    EnvironmentCheck::new(CheckKind::Adapter(agent), state, summary)
}

fn migration_check() -> EnvironmentCheck {
    let inspections = migration::inspect_all();
    let retained = inspections
        .iter()
        .filter(|inspection| {
            !matches!(
                inspection.state,
                Ok(CopyState::Missing | CopyState::Removed)
            )
        })
        .collect::<Vec<_>>();
    if retained.is_empty() {
        EnvironmentCheck::new(
            CheckKind::Migration,
            CheckState::Ok,
            belfry_i18n::text("协作已改用 A2A 工具，不再安装 Belfry 协作 Skill"),
        )
    } else {
        let paths = retained
            .iter()
            .map(|inspection| format!("{}: {}", inspection.label, inspection.path.display()))
            .collect::<Vec<_>>()
            .join("; ");
        EnvironmentCheck::new(
            CheckKind::Migration,
            CheckState::Warning,
            belfry_i18n::lformat!("保留了无法确认或修改过的旧 Skill 副本，请人工检查：{paths}"),
        )
    }
}

fn collaboration_check(gateway: &Value) -> EnvironmentCheck {
    let Some(origin) = gateway["origin"]
        .as_str()
        .filter(|_| gateway["available"] == true)
    else {
        return collab_error(belfry_i18n::text("本地 A2A 网关未启动"));
    };
    let url = format!("{origin}/health");
    let result = tauri::async_runtime::block_on(async {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|_| ())?;
        let mut response = client.get(url).send().await.map_err(|_| ())?;
        if !response.status().is_success() {
            return Err(());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
            if bytes.len() + chunk.len() > 1024 {
                return Err(());
            }
            bytes.extend_from_slice(&chunk);
        }
        let body: Value = serde_json::from_slice(&bytes).map_err(|_| ())?;
        if body["ready"] != true
            || body["protocolVersion"] != "1.0"
            || body["protocolBinding"] != "JSONRPC"
        {
            return Err(());
        }
        Ok(())
    });
    match result {
        Ok(()) => EnvironmentCheck::new(
            CheckKind::Collaboration,
            CheckState::Ok,
            belfry_i18n::text("本地 A2A 1.0 JSON-RPC 网关 HTTP 自检通过"),
        ),
        Err(()) => collab_error(belfry_i18n::text("本地 A2A 网关 HTTP 自检失败")),
    }
}
fn collab_error(message: impl Into<String>) -> EnvironmentCheck {
    EnvironmentCheck::new(CheckKind::Collaboration, CheckState::Error, message)
}
