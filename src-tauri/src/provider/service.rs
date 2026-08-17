//! provider 的增删改与切换编排。
//!
//! 切换的关键顺序：**先把 live 配置文件写成功，再提交「当前是谁」**。
//! 反过来的话，写文件失败会留下「库里说切了、CLI 那边没切」的不一致，
//! 而用户从界面上看不出来。

use tauri::AppHandle;

use crate::agent::AgentKind;
use crate::terminal::AppError;

use super::atomic::read_text_optional;
use super::contracts::{
    AgentProviderGroup, ConfigFilePreview, ProviderCatalog, ProviderConfig, ProviderDraft,
    SwitchOutcome,
};
use super::store::StoreFile;
use super::{claude, codex, envcheck, store};

/// 首次接管时给导入条目起的名字。
const ADOPTED_NAME: &str = "导入的配置";

pub(super) fn catalog(app: &AppHandle) -> Result<ProviderCatalog, AppError> {
    let mut store = store::load(app)?;
    if adopt_live(&mut store)? {
        store::save(app, &store)?;
    }
    Ok(build(&store))
}

pub(super) fn save_provider(
    app: &AppHandle,
    kind: AgentKind,
    draft: ProviderDraft,
) -> Result<ProviderCatalog, AppError> {
    draft.validate()?;

    let mut store = store::load(app)?;
    adopt_live(&mut store)?;

    let agent = store.agent_mut(kind);
    let edited_id = match &draft.id {
        Some(id) => {
            let existing = agent
                .providers
                .iter_mut()
                .find(|item| item.id == *id)
                .ok_or_else(|| AppError::not_found(format!("找不到 provider：{id}")))?;
            existing.name = draft.name.trim().to_string();
            existing.base_url = draft.base_url.trim().to_string();
            existing.api_key = draft.api_key.trim().to_string();
            existing.model = draft.model.trim().to_string();
            id.clone()
        }
        None => {
            let config = ProviderConfig {
                id: ulid::Ulid::generate().to_string(),
                name: draft.name.trim().to_string(),
                base_url: draft.base_url.trim().to_string(),
                api_key: draft.api_key.trim().to_string(),
                model: draft.model.trim().to_string(),
                created_at: now_millis(),
            };
            let id = config.id.clone();
            agent.providers.push(config);
            id
        }
    };

    // 改的正好是当前生效的那个，就得把新值推到 CLI 的配置文件里，
    // 否则界面显示已改、实际还在用旧 key。
    if store.agent(kind).current_id.as_deref() == Some(edited_id.as_str()) {
        let target = store.agent(kind).find(&edited_id).cloned();
        write_live(kind, target.as_ref(), &mut store)?;
    }

    store::save(app, &store)?;
    Ok(build(&store))
}

pub(super) fn remove_provider(
    app: &AppHandle,
    kind: AgentKind,
    id: String,
) -> Result<ProviderCatalog, AppError> {
    let mut store = store::load(app)?;
    adopt_live(&mut store)?;

    if store.agent(kind).find(&id).is_none() {
        return Err(AppError::not_found(format!("找不到 provider：{id}")));
    }

    // 删的是当前生效的，先把 CLI 配置退回官方，不然会留下一份指向已删条目的路由。
    if store.agent(kind).current_id.as_deref() == Some(id.as_str()) {
        write_live(kind, None, &mut store)?;
        store.agent_mut(kind).current_id = None;
    }

    store.agent_mut(kind).providers.retain(|item| item.id != id);
    store::save(app, &store)?;
    Ok(build(&store))
}

pub(super) fn switch(
    app: &AppHandle,
    kind: AgentKind,
    id: Option<String>,
) -> Result<SwitchOutcome, AppError> {
    let mut store = store::load(app)?;
    adopt_live(&mut store)?;

    let target = match &id {
        Some(id) => Some(
            store
                .agent(kind)
                .find(id)
                .cloned()
                .ok_or_else(|| AppError::not_found(format!("找不到 provider：{id}")))?,
        ),
        None => None,
    };

    // 先写文件。失败就在这里返回，库里的 currentId 一个字没动。
    write_live(kind, target.as_ref(), &mut store)?;

    store.agent_mut(kind).current_id = id;
    // 万一这一步失败：文件已经切了、库里还是旧的。用户再切一次即可（幂等），
    // 比反过来「库说切了其实没切」好排查。
    store::save(app, &store)?;

    Ok(SwitchOutcome {
        catalog: build(&store),
        // Claude Code 每次请求前重读 settings.json；Codex 只在启动时读一次。
        effective_immediately: matches!(kind, AgentKind::Claude),
    })
}

fn write_live(
    kind: AgentKind,
    target: Option<&ProviderConfig>,
    store: &mut StoreFile,
) -> Result<(), AppError> {
    match kind {
        AgentKind::Claude => {
            let mut settings = claude::read_settings()?;
            claude::apply(&mut settings, target)?;
            claude::write_settings(&settings)
        }
        AgentKind::Codex => {
            let mut auth = store.codex_official_auth.take();
            let result = codex::switch(target, &mut auth);
            // 无论成败都写回：codex::switch 在回滚时也会把备份恢复原状。
            store.codex_official_auth = auth;
            result
        }
    }
}

/// 当前生效的配置文件原文，供前端展示。
///
/// Claude Code 只有 `~/.claude/settings.json`；Codex 有 `config.toml` 和
/// `auth.json` 两个文件。只读返回原文，不改写任何内容——用户自己的 hooks、
/// MCP、token 都原样呈现，和 cc-switch 里打开配置文件看到的一样。
pub(super) fn config_files(kind: AgentKind) -> Result<Vec<ConfigFilePreview>, AppError> {
    match kind {
        AgentKind::Claude => {
            let path = claude::settings_path()?;
            Ok(vec![ConfigFilePreview {
                path: path.display().to_string(),
                format: "json".to_string(),
                content: read_text_optional(&path)?,
            }])
        }
        AgentKind::Codex => codex::config_files(),
    }
}

/// 根据正在编辑的草稿生成一份内存预览，不写入磁盘。
///
/// 右侧编辑器要展示的是「这个 Provider 套用后的配置」，而不是当前 live
/// Provider 的旧文件；字段改写统一复用切换时的实现，避免两套规则漂移。
pub(super) fn config_files_for_draft(
    kind: AgentKind,
    draft: ProviderDraft,
) -> Result<Vec<ConfigFilePreview>, AppError> {
    let provider = ProviderConfig {
        id: draft.id.unwrap_or_else(|| "preview".to_string()),
        name: draft.name.trim().to_string(),
        base_url: draft.base_url.trim().to_string(),
        api_key: draft.api_key.trim().to_string(),
        model: draft.model.trim().to_string(),
        created_at: 0,
    };

    match kind {
        AgentKind::Claude => preview_claude(&provider),
        AgentKind::Codex => preview_codex(&provider),
    }
}

fn preview_claude(provider: &ProviderConfig) -> Result<Vec<ConfigFilePreview>, AppError> {
    let path = claude::settings_path()?;
    let mut settings = claude::read_settings()?;
    claude::apply(&mut settings, Some(provider))?;
    let mut content = serde_json::to_string_pretty(&settings)
        .map_err(|err| AppError::io(format!("序列化 settings.json 预览失败：{err}")))?;
    content.push('\n');
    Ok(vec![ConfigFilePreview {
        path: path.display().to_string(),
        format: "json".to_string(),
        content,
    }])
}

fn preview_codex(provider: &ProviderConfig) -> Result<Vec<ConfigFilePreview>, AppError> {
    codex::config_files_for_provider(provider)
}

/// 保存用户在界面上编辑后的配置文件全文。路径白名单和格式校验在各 agent 模块里。
pub(super) fn save_config_file(
    kind: AgentKind,
    path: String,
    content: String,
) -> Result<(), AppError> {
    let path = std::path::PathBuf::from(path);
    match kind {
        AgentKind::Claude => claude::save_config_file(&path, &content),
        AgentKind::Codex => codex::save_config_file(&path, &content),
    }
}

/// 把 live 配置文件里当前生效的 provider 同步进 Belfry 的库。
///
/// 用户在界面上直接编辑配置文件（`provider_config_save`）后，磁盘文件变了但
/// 库里的列表没变，列表就显示不出刚配置的 provider。这里检测 live 配置：
/// base_url 匹配现有条目就更新它并设为当前，否则新建一条。检测不到
/// （比如用户把 `model_provider` 摘掉切回官方）就不动库里已有内容。
pub(super) fn sync_live(app: &AppHandle, kind: AgentKind) -> Result<ProviderCatalog, AppError> {
    let mut store = store::load(app)?;
    apply_live_to_store(&mut store, kind, detect_live(kind)?);
    store::save(app, &store)?;
    Ok(build(&store))
}

/// 把检测到的 live provider 合进 store：base_url 相同就更新现有条目，
/// 否则新建，并一律设为当前生效。`None`（切回官方）不动 store。
fn apply_live_to_store(
    store: &mut StoreFile,
    kind: AgentKind,
    detected: Option<(String, String, String, String)>,
) {
    let Some((name, base_url, api_key, model)) = detected else {
        return;
    };
    let matched_id = store
        .agent(kind)
        .providers
        .iter()
        .find(|item| item.base_url == base_url)
        .map(|item| item.id.clone());
    let id = match matched_id {
        Some(id) => {
            let entry = store
                .agent_mut(kind)
                .providers
                .iter_mut()
                .find(|item| item.id == id)
                .expect("find 与 iter_mut 遍历的是同一个列表");
            entry.name = name.trim().to_string();
            entry.api_key = api_key;
            entry.model = model;
            id
        }
        None => {
            let config = ProviderConfig {
                id: ulid::Ulid::generate().to_string(),
                name: name.trim().to_string(),
                base_url,
                api_key,
                model,
                created_at: now_millis(),
            };
            let id = config.id.clone();
            store.agent_mut(kind).providers.push(config);
            id
        }
    };
    store.agent_mut(kind).current_id = Some(id);
}

/// 把 CLI 配置文件里已有的 provider 设置收编成一条可切回的条目。
///
/// 两个入口都会走到这里：首次接管（用户装 Belfry 前配好的中转服务，不导入
/// 的话第一次点切换就会把原有设置静默覆盖掉），以及打开设置时同步用户在
/// 配置文件里直接写的新 provider（base_url 不在库里就导入并设为当前）。
/// 只导入、不更新已有条目：库里那份是用户表单里亲手编辑的，不能拿文件盖掉。
fn adopt_live(store: &mut StoreFile) -> Result<bool, AppError> {
    let mut changed = false;
    for kind in AgentKind::ALL {
        // 单个 agent 的配置文件读不动（比如用户正在编辑器里改到一半、或 TOML
        // 暂时写坏了）不能拖垮整个列表：列表用的是库里已保存的数据，这次收编
        // 跳过即可，等文件恢复后下次打开设置再同步。
        let detected = match detect_live(kind) {
            Ok(detected) => detected,
            Err(err) => {
                eprintln!("adopt_live: 跳过 {kind:?}，读配置失败：{err:?}");
                continue;
            }
        };
        let Some((name, base_url, api_key, model)) = detected else {
            continue;
        };
        // 库里已有同 base_url 的条目就不动，避免每次打开设置重复导入。
        if store
            .agent(kind)
            .providers
            .iter()
            .any(|item| item.base_url == base_url)
        {
            continue;
        }
        let config = ProviderConfig {
            id: ulid::Ulid::generate().to_string(),
            name: name.trim().to_string(),
            base_url,
            api_key,
            model,
            created_at: now_millis(),
        };
        let id = config.id.clone();
        let agent = store.agent_mut(kind);
        agent.providers.push(config);
        agent.current_id = Some(id);
        changed = true;
    }
    Ok(changed)
}

type LiveProvider = Option<(String, String, String, String)>;

fn detect_live(kind: AgentKind) -> Result<LiveProvider, AppError> {
    match kind {
        AgentKind::Claude => {
            let settings = claude::read_settings()?;
            Ok(
                claude::detect_live(&settings).map(|(base_url, api_key, model)| {
                    (ADOPTED_NAME.to_string(), base_url, api_key, model)
                }),
            )
        }
        AgentKind::Codex => {
            let doc = codex::read_config()?;
            Ok(codex::detect_live(&doc)
                .map(|(name, base_url, model, api_key)| (name, base_url, api_key, model)))
        }
    }
}

fn build(store: &StoreFile) -> ProviderCatalog {
    let agents = AgentKind::ALL
        .into_iter()
        .map(|kind| {
            let agent = store.agent(kind);
            AgentProviderGroup {
                kind,
                providers: agent.providers,
                current_id: agent.current_id,
            }
        })
        .collect();
    ProviderCatalog {
        agents,
        env_conflicts: envcheck::detect(),
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_lists_every_agent_even_when_empty() {
        // 面板要能显示「这个 agent 还没配过 provider」，而不是干脆不出现。
        let catalog = build(&StoreFile::default());
        assert_eq!(catalog.agents.len(), AgentKind::ALL.len());
        assert!(
            catalog
                .agents
                .iter()
                .all(|group| group.providers.is_empty())
        );
        assert!(
            catalog
                .agents
                .iter()
                .all(|group| group.current_id.is_none())
        );
    }

    #[test]
    fn applying_a_live_provider_creates_a_new_entry_and_marks_it_current() {
        let mut store = StoreFile::default();

        apply_live_to_store(
            &mut store,
            AgentKind::Codex,
            Some((
                "中转".to_string(),
                "https://relay.example.com".to_string(),
                "sk-1".to_string(),
                "gpt-x".to_string(),
            )),
        );

        let agent = store.agent(AgentKind::Codex);
        assert_eq!(agent.providers.len(), 1);
        assert_eq!(agent.providers[0].base_url, "https://relay.example.com");
        assert_eq!(agent.providers[0].model, "gpt-x");
        assert_eq!(
            agent.current_id.as_deref(),
            Some(agent.providers[0].id.as_str()),
            "刚配置的 provider 应直接成为当前生效"
        );
    }

    #[test]
    fn applying_a_live_provider_updates_the_matching_entry() {
        let mut store = StoreFile::default();
        apply_live_to_store(
            &mut store,
            AgentKind::Codex,
            Some((
                "旧名".to_string(),
                "https://relay.example.com".to_string(),
                "sk-old".to_string(),
                String::new(),
            )),
        );
        let old_id = store.agent(AgentKind::Codex).providers[0].id.clone();

        apply_live_to_store(
            &mut store,
            AgentKind::Codex,
            Some((
                "新名".to_string(),
                "https://relay.example.com".to_string(),
                "sk-new".to_string(),
                "gpt-new".to_string(),
            )),
        );

        let agent = store.agent(AgentKind::Codex);
        assert_eq!(agent.providers.len(), 1, "同一 base_url 不该重复建条目");
        assert_eq!(agent.providers[0].id, old_id);
        assert_eq!(agent.providers[0].name, "新名");
        assert_eq!(agent.providers[0].api_key, "sk-new");
    }

    #[test]
    fn applying_none_leaves_the_store_untouched() {
        let mut store = StoreFile::default();

        apply_live_to_store(&mut store, AgentKind::Claude, None);

        assert!(store.agent(AgentKind::Claude).providers.is_empty());
        assert!(store.agent(AgentKind::Claude).current_id.is_none());
    }
}
