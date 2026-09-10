//! 插件模型网关：只读既有 Provider；凭据仅返回给宿主进程的内部解析请求。
use crate::agent::AgentKind;
use serde::Serialize;
use serde_json::{Value, json};
use tauri::AppHandle;

use super::{claude, codex, contracts::ProviderConfig, store};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelInfo {
    key: String,
    provider_id: String,
    provider_name: String,
    model_id: String,
    label: String,
    supports_reasoning: bool,
    thinking_levels: Vec<&'static str>,
}
struct ModelRoute {
    info: ModelInfo,
    config: ProviderConfig,
    protocol: &'static str,
}
fn route(kind: AgentKind, config: ProviderConfig, fallback: &str) -> Option<ModelRoute> {
    let model = if config.model.trim().is_empty() {
        fallback
    } else {
        config.model.trim()
    };
    if model.is_empty() || config.base_url.trim().is_empty() {
        return None;
    }
    let thinking_levels = reasoning_levels(kind, model);
    let info = ModelInfo {
        key: format!("{}/{model}", config.id),
        provider_id: config.id.clone(),
        provider_name: config.name.clone(),
        model_id: model.into(),
        label: format!("{} · {model}", config.name),
        supports_reasoning: !thinking_levels.is_empty(),
        thinking_levels,
    };
    Some(ModelRoute {
        info,
        config,
        protocol: if kind == AgentKind::Codex {
            "responses"
        } else {
            "anthropic"
        },
    })
}
fn reasoning_levels(kind: AgentKind, model: &str) -> Vec<&'static str> {
    if kind == AgentKind::Codex {
        response_reasoning_levels(model)
    } else if ["claude-3-7", "claude-sonnet-4", "claude-opus-4"]
        .iter()
        .any(|prefix| model.starts_with(prefix))
    {
        vec!["off", "low", "medium", "high"]
    } else {
        vec![]
    }
}
fn matches_model(model: &str, name: &str) -> bool {
    if model == name {
        return true;
    }
    model.strip_prefix(name).is_some_and(|suffix| {
        suffix.len() == 11
            && suffix.bytes().enumerate().all(|(index, byte)| {
                if [0, 5, 8].contains(&index) {
                    byte == b'-'
                } else {
                    byte.is_ascii_digit()
                }
            })
    })
}
fn response_reasoning_levels(model: &str) -> Vec<&'static str> {
    // 按官方模型页核验（2026-09-10）；未知别名不推断 none/xhigh 等能力。
    // https://developers.openai.com/api/docs/models/gpt-5
    let one_of = |names: &[&str]| names.iter().any(|name| matches_model(model, name));
    if one_of(&["gpt-5", "gpt-5-mini", "gpt-5-nano"]) {
        vec!["minimal", "low", "medium", "high"]
    } else if one_of(&["gpt-5-pro"]) {
        vec!["high"]
    } else if one_of(&["gpt-5.2-pro"]) {
        vec!["medium", "high", "xhigh"]
    } else if one_of(&["gpt-5.1"]) {
        vec!["none", "low", "medium", "high"]
    } else if one_of(&["gpt-5.2", "gpt-5.4"]) {
        vec!["none", "low", "medium", "high", "xhigh"]
    } else if one_of(&[
        "gpt-5-codex",
        "gpt-5.1-codex",
        "gpt-5.2-codex",
        "gpt-5.3-codex",
        "o1",
        "o3",
        "o4-mini",
    ]) {
        vec!["low", "medium", "high"]
    } else {
        vec![]
    }
}
fn live(kind: AgentKind) -> (String, Option<ProviderConfig>) {
    let (fallback, detected) = match kind {
        AgentKind::Codex => {
            let Ok(doc) = codex::read_config() else {
                return (String::new(), None);
            };
            let model = doc
                .get("model")
                .and_then(toml_edit::Item::as_str)
                .unwrap_or_default()
                .to_owned();
            (model, codex::detect_live(&doc))
        }
        AgentKind::Claude => {
            let Ok(settings) = claude::read_settings() else {
                return (String::new(), None);
            };
            let model = settings["env"]["ANTHROPIC_MODEL"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            (
                model,
                claude::detect_live(&settings)
                    .map(|(url, key, model)| ("当前 Claude Provider".into(), url, model, key)),
            )
        }
    };
    let config = detected.map(|(name, base_url, model, api_key)| ProviderConfig {
        id: format!("{}-live", kind.command_name()),
        name,
        base_url,
        api_key,
        model,
        created_at: 0,
    });
    (fallback, config)
}
fn routes(app: &AppHandle) -> Result<Vec<ModelRoute>, String> {
    let store = store::load(app).map_err(|error| error.message)?;
    let mut result = vec![];
    for kind in AgentKind::ALL {
        let (fallback, active) = live(kind);
        let mut providers = store.agent(kind).providers;
        if let Some(active) = active {
            if !providers.iter().any(|provider| {
                provider.base_url == active.base_url
                    && (provider.model.is_empty() || provider.model == active.model)
            }) {
                providers.push(active);
            }
        }
        result.extend(
            providers
                .into_iter()
                .filter_map(|config| route(kind, config, &fallback)),
        );
    }
    Ok(result)
}
pub(crate) fn dispatch(app: &AppHandle, api: &str, args: &Value) -> Result<Value, String> {
    let models = routes(app)?;
    if api == "models.list" {
        return serde_json::to_value(models.iter().map(|route| &route.info).collect::<Vec<_>>())
            .map_err(|error| error.to_string());
    }
    let key = args[0].as_str().ok_or("模型标识无效")?;
    let model = models
        .into_iter()
        .find(|route| route.info.key == key)
        .ok_or("模型未配置或已移除，请在 Provider 中设置模型")?;
    let mut value = serde_json::to_value(model.info).map_err(|error| error.to_string())?;
    value["protocol"] = json!(model.protocol);
    value["baseUrl"] = json!(model.config.base_url);
    value["apiKey"] = json!(model.config.api_key);
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config(model: &str) -> ProviderConfig {
        ProviderConfig {
            id: "my-route".into(),
            name: "我的服务".into(),
            base_url: "https://example.invalid/v1".into(),
            api_key: "private-test-key".into(),
            model: model.into(),
            created_at: 0,
        }
    }
    #[test]
    fn model_catalog_never_serializes_route_credentials() {
        let model = route(AgentKind::Codex, config("gpt-5"), "").unwrap();
        let public = serde_json::to_value(model.info).unwrap();
        assert_eq!(json!("my-route/gpt-5"), public["key"]);
        assert_eq!(Value::Null, public["apiKey"]);
        assert!(!public.to_string().contains("private-test-key"));
        assert_eq!("responses", model.protocol);
    }
    #[test]
    fn unnamed_models_use_the_existing_cli_choice_without_inventing_a_default() {
        assert!(route(AgentKind::Claude, config(""), "").is_none());
        let model = route(AgentKind::Claude, config(""), "custom-model").unwrap();
        assert_eq!("custom-model", model.info.model_id);
        assert_eq!("anthropic", model.protocol);
    }
    #[test]
    fn reasoning_levels_respect_model_specific_support() {
        assert_eq!(
            vec!["minimal", "low", "medium", "high"],
            reasoning_levels(AgentKind::Codex, "gpt-5")
        );
        assert_eq!(
            vec!["none", "low", "medium", "high"],
            reasoning_levels(AgentKind::Codex, "gpt-5.1-2025-11-13")
        );
        assert_eq!(
            vec!["high"],
            reasoning_levels(AgentKind::Codex, "gpt-5-pro")
        );
        assert_eq!(
            vec!["medium", "high", "xhigh"],
            reasoning_levels(AgentKind::Codex, "gpt-5.2-pro")
        );
        assert_eq!(
            vec!["low", "medium", "high"],
            reasoning_levels(AgentKind::Codex, "gpt-5-codex")
        );
        assert!(reasoning_levels(AgentKind::Codex, "gpt-5.1-chat-latest").is_empty());
        assert!(reasoning_levels(AgentKind::Codex, "o1-mini").is_empty());
        assert!(reasoning_levels(AgentKind::Codex, "gpt-5-custom-unknown").is_empty());
    }
}
