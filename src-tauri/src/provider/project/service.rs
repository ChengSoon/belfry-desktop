use super::super::{
    contracts::{AgentProviderGroup, ProviderCatalog},
    service, store,
};
use super::contracts::{
    ProjectAgentProvider, ProjectProviderChoice, ProjectProviderReport, ProjectProviderSelection,
};
use super::{launch, storage};
use crate::{
    agent::AgentKind,
    resource::canonicalize,
    terminal::{AppError, CreateTerminalRequest},
};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const FILE: &str = "project-providers.json";

pub(super) fn report(app: &AppHandle, root_path: &str) -> Result<ProjectProviderReport, AppError> {
    let root = project_path(Path::new(root_path))?;
    let catalog = service::catalog(app)?;
    let choices = storage::read(&base(app)?.join(FILE))?;
    Ok(build_report(root, &choices, catalog))
}

pub(super) fn select(
    app: &AppHandle,
    mut selection: ProjectProviderSelection,
) -> Result<ProjectProviderReport, AppError> {
    selection.root_path = project_path(Path::new(&selection.root_path))?;
    let catalog = service::catalog(app)?;
    if let Some(id) = &selection.provider_id {
        let provider = catalog
            .agents
            .iter()
            .find(|group| group.kind == selection.kind)
            .and_then(|group| group.providers.iter().find(|provider| provider.id == *id))
            .ok_or_else(|| AppError::not_found("Provider 已不存在，请刷新列表后重新选择"))?;
        if provider.api_key.trim().is_empty() {
            return Err(AppError::invalid_argument(
                "请先为此 Provider 配置独立 API Key",
            ));
        }
    }
    let path = base(app)?.join(FILE);
    storage::save(&path, &selection)?;
    Ok(build_report(
        selection.root_path,
        &storage::read(&path)?,
        catalog,
    ))
}

pub(crate) fn prepare(
    app: &AppHandle,
    request: &mut CreateTerminalRequest,
) -> Result<(), AppError> {
    let Some(kind) = agent_kind(&request.profile_id) else {
        return Ok(());
    };
    let path = match &request.cwd {
        Some(uri) => crate::resource::file_uri_to_path(uri)?,
        None => std::env::current_dir().map_err(|error| AppError::io(error.to_string()))?,
    };
    let root = project_path(&path)?;
    let base = base(app)?;
    let choices = storage::read(&base.join(FILE))?;
    let Some(id) = choices.provider(&root, kind) else {
        return Ok(());
    };
    let providers = store::load(app)?.agent(kind);
    let provider = providers.find(id).ok_or_else(|| {
        AppError::not_found(
            "当前项目的 Provider 已被删除。请在项目 Provider 设置中重新选择或改为跟随全局",
        )
    })?;
    request.launch_overlay = launch::prepare(&base, kind, provider)?;
    Ok(())
}

fn build_report(
    root: String,
    choices: &storage::ProjectChoices,
    catalog: ProviderCatalog,
) -> ProjectProviderReport {
    ProjectProviderReport {
        agents: catalog
            .agents
            .iter()
            .map(|group| build_agent(group, choices.provider(&root, group.kind)))
            .collect(),
        root_path: root,
        env_conflicts: catalog.env_conflicts,
    }
}

fn build_agent(group: &AgentProviderGroup, selected: Option<&str>) -> ProjectAgentProvider {
    let effective_id = selected.or(group.current_id.as_deref());
    let provider = group
        .providers
        .iter()
        .find(|provider| Some(provider.id.as_str()) == effective_id);
    ProjectAgentProvider {
        kind: group.kind,
        provider_id: selected.map(str::to_owned),
        source: if selected.is_some() {
            "project"
        } else {
            "global"
        },
        effective_name: provider
            .map(|provider| provider.name.clone())
            .unwrap_or_else(|| "全局 CLI 配置".into()),
        missing: selected.is_some() && provider.is_none(),
        choices: group
            .providers
            .iter()
            .map(|provider| ProjectProviderChoice {
                id: provider.id.clone(),
                name: provider.name.clone(),
                base_url: provider.base_url.clone(),
                model: provider.model.clone(),
                configured: !provider.api_key.trim().is_empty(),
            })
            .collect(),
    }
}

fn base(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::io(format!("找不到应用数据目录：{error}")))
}

fn project_path(path: &Path) -> Result<String, AppError> {
    let root =
        canonicalize(path).map_err(|error| AppError::io(format!("项目目录无法读取：{error}")))?;
    if !root.is_dir() {
        return Err(AppError::invalid_argument("项目路径必须是本地目录"));
    }
    Ok(root.to_string_lossy().into_owned())
}

fn agent_kind(profile: &str) -> Option<AgentKind> {
    match profile {
        "agent:codex" => Some(AgentKind::Codex),
        "agent:claude" => Some(AgentKind::Claude),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_does_not_disclose_keys_and_missing_selection_is_not_a_global_fallback() {
        let provider = super::super::tests::provider("test");
        let group = AgentProviderGroup {
            kind: AgentKind::Codex,
            providers: vec![provider],
            current_id: Some("test".into()),
        };
        let selected = build_agent(&group, Some("test"));
        assert_eq!("project", selected.source);
        assert!(!selected.missing);
        let json = serde_json::to_string(&selected).unwrap();
        assert!(!json.contains("private-test-key"));
        assert!(!json.contains("apiKey"));
        let missing = build_agent(&group, Some("deleted"));
        assert!(missing.missing);
        assert_eq!("project", missing.source);
        assert_eq!(Some("deleted"), missing.provider_id.as_deref());
        assert_eq!("global", build_agent(&group, None).source);
    }

    #[test]
    fn shell_and_ssh_do_not_acquire_project_provider_overrides() {
        for profile in ["system-default", "shell:zsh", "ssh"] {
            assert_eq!(None, agent_kind(profile));
        }
        assert_eq!(Some(AgentKind::Claude), agent_kind("agent:claude"));
    }
}
