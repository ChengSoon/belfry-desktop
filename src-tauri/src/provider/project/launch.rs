use super::super::contracts::ProviderConfig;
use crate::{
    agent::AgentKind,
    terminal::{
        AppError,
        overlay::{LaunchFile, LaunchOverlay},
    },
};
use serde_json::json;
use std::path::Path;
use toml_edit::{InlineTable, Value};

const CODEX_KEY: &str = "BELFRY_PROVIDER_API_KEY";

pub(super) fn prepare(
    base: &Path,
    kind: AgentKind,
    provider: &ProviderConfig,
) -> Result<LaunchOverlay, AppError> {
    if provider.api_key.trim().is_empty() {
        return Err(AppError::invalid_argument(
            "此 Provider 未配置独立 API Key，无法启用项目隔离",
        ));
    }
    match kind {
        AgentKind::Codex => Ok(codex(provider)),
        AgentKind::Claude => claude(base, provider),
        AgentKind::Pi => pi(base, provider),
    }
}

fn codex(provider: &ProviderConfig) -> LaunchOverlay {
    let name = format!(
        "belfry_project_{}",
        ulid::Ulid::generate().to_string().to_lowercase()
    );
    let mut table = InlineTable::new();
    table.insert("name", Value::from(provider.name.as_str()));
    table.insert("base_url", Value::from(provider.base_url.as_str()));
    table.insert("wire_api", Value::from("responses"));
    table.insert("env_key", Value::from(CODEX_KEY));
    table.insert("requires_openai_auth", Value::from(false));
    let mut overlay = LaunchOverlay {
        arguments: vec![
            "-c".into(),
            format!("model_provider={}", Value::from(name.clone())),
            "-c".into(),
            format!("model_providers.{name}={table}"),
        ],
        environment: [(CODEX_KEY.to_owned(), provider.api_key.clone())].into(),
        unset: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"]
            .map(str::to_owned)
            .to_vec(),
        ..Default::default()
    };
    if !provider.model.trim().is_empty() {
        overlay.arguments.extend([
            "-c".into(),
            format!("model={}", Value::from(provider.model.trim())),
        ]);
    }
    overlay
}

fn claude(base: &Path, provider: &ProviderConfig) -> Result<LaunchOverlay, AppError> {
    let mut environment: std::collections::HashMap<String, String> = [
        ("ANTHROPIC_BASE_URL".into(), provider.base_url.clone()),
        ("ANTHROPIC_AUTH_TOKEN".into(), provider.api_key.clone()),
        ("ANTHROPIC_API_KEY".into(), String::new()),
        ("CLAUDE_CODE_OAUTH_TOKEN".into(), String::new()),
        ("CLAUDE_CODE_USE_BEDROCK".into(), "0".into()),
        ("CLAUDE_CODE_USE_VERTEX".into(), "0".into()),
        ("CLAUDE_CODE_USE_FOUNDRY".into(), "0".into()),
    ]
    .into();
    if !provider.model.trim().is_empty() {
        environment.insert("ANTHROPIC_MODEL".into(), provider.model.trim().into());
    }
    let mut settings = json!({ "env": environment });
    if !provider.model.trim().is_empty() {
        settings["model"] = json!(provider.model.trim());
    }
    let file = LaunchFile::create(base, &settings.to_string())?;
    Ok(LaunchOverlay {
        arguments: vec![
            "--settings".into(),
            file.path().to_string_lossy().into_owned(),
        ],
        environment,
        retained_files: vec![file],
        ..Default::default()
    })
}

/// Pi 没有逐次覆盖 base URL 的 CLI 标志，项目隔离用一整套临时配置目录：
/// 指向项目自己的 provider，又不碰用户全局的 `~/.pi/agent`。
/// 会话目录单独指回真实位置，隔离的是路由与凭据，不是用户的历史记录。
fn pi(base: &Path, provider: &ProviderConfig) -> Result<LaunchOverlay, AppError> {
    let dir = LaunchFile::create_dir(base)?;
    let mut models = serde_json::json!({});
    let mut settings = serde_json::json!({});
    super::super::pi::apply(&mut models, &mut settings, Some(provider))?;
    let write = |name: &str, contents: String, secret: bool| -> Result<(), AppError> {
        crate::atomic::write_atomic(&dir.path().join(name), &contents, secret)
    };
    write(
        "models.json",
        serde_json::to_string_pretty(&models).unwrap(),
        true,
    )?;
    write(
        "settings.json",
        serde_json::to_string_pretty(&settings).unwrap(),
        false,
    )?;
    let mut environment = std::collections::HashMap::new();
    environment.insert(
        "PI_CODING_AGENT_DIR".into(),
        dir.path().to_string_lossy().into_owned(),
    );
    if let Some(sessions) = crate::history::scan::pi_sessions_root() {
        environment.insert(
            "PI_CODING_AGENT_SESSION_DIR".into(),
            sessions.to_string_lossy().into_owned(),
        );
    }
    Ok(LaunchOverlay {
        arguments: Vec::new(),
        environment,
        retained_files: vec![dir],
        ..Default::default()
    })
}
