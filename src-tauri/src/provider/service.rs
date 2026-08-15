//! provider 的增删改与切换编排。
//!
//! 切换的关键顺序：**先把 live 配置文件写成功，再提交「当前是谁」**。
//! 反过来的话，写文件失败会留下「库里说切了、CLI 那边没切」的不一致，
//! 而用户从界面上看不出来。

use tauri::AppHandle;

use crate::agent::AgentKind;
use crate::terminal::AppError;

use super::contracts::{
    AgentProviderGroup, ProviderCatalog, ProviderConfig, ProviderDraft, SwitchOutcome,
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

/// 把 CLI 配置文件里已有的 provider 设置收编成一条可切回的条目。
///
/// 用户装 Belfry 之前多半已经配好了某个中转服务。不做这一步的话，
/// 他第一次点「切换」就会把原有设置静默覆盖掉，而且没有退路。
/// 只在某个 agent 一条 provider 都没有时执行，所以不会重复导入。
fn adopt_live(store: &mut StoreFile) -> Result<bool, AppError> {
    let mut changed = false;
    for kind in AgentKind::ALL {
        if !store.agent(kind).providers.is_empty() {
            continue;
        }
        let Some((name, base_url, api_key, model)) = detect_live(kind)? else {
            continue;
        };
        let config = ProviderConfig {
            id: ulid::Ulid::generate().to_string(),
            name,
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
            Ok(claude::detect_live(&settings)
                .map(|(base_url, api_key, model)| (ADOPTED_NAME.to_string(), base_url, api_key, model)))
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
        assert!(catalog.agents.iter().all(|group| group.providers.is_empty()));
        assert!(catalog.agents.iter().all(|group| group.current_id.is_none()));
    }
}
