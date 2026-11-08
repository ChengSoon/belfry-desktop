//! Provider routing for Antigravity, OpenCode v2 and Kimi Code v2.
use super::{
    contracts::{ConfigFilePreview, ProviderConfig},
    json_config,
};
use crate::{
    agent::{AgentKind, paths},
    atomic::{read_text_optional, write_atomic},
    terminal::AppError,
};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use toml_edit::{DocumentMut, Item, Table, value};

const OWNER: &str = "belfry";
const AGY_MODEL: &str = "Belfry";

pub(super) fn config_path(kind: AgentKind) -> Result<PathBuf, AppError> {
    let dir = paths::config_dir(kind).ok_or_else(|| AppError::not_found("找不到 CLI 配置目录"))?;
    Ok(match kind {
        AgentKind::Antigravity => dir.join("settings.json"),
        AgentKind::Kimi => dir.join("config.toml"),
        AgentKind::Opencode => {
            let jsonc = dir.join("opencode.jsonc");
            if jsonc.exists() {
                jsonc
            } else {
                dir.join("opencode.json")
            }
        }
        _ => return Err(AppError::invalid_argument("不支持的 Provider 类型")),
    })
}

pub(super) fn validate_model(kind: AgentKind, model: &str) -> Result<(), AppError> {
    if matches!(
        kind,
        AgentKind::Antigravity | AgentKind::Opencode | AgentKind::Kimi
    ) && (model.trim().is_empty() || model.chars().any(char::is_control))
    {
        return Err(AppError::invalid_argument(
            "此 CLI 的自定义 Provider 需要填写模型 ID",
        ));
    }
    Ok(())
}
fn toml(text: &str) -> Result<DocumentMut, AppError> {
    text.parse()
        .map_err(|_| AppError::invalid_argument("Kimi 配置不是有效 TOML，已保留原文件"))
}
fn selection_path(path: &Path) -> PathBuf {
    path.with_file_name("belfry-provider-selection.json")
}
fn original(path: &Path) -> Result<Value, AppError> {
    json_config::parse(&read_text_optional(&selection_path(path))?)
}

pub(super) fn apply_live(
    kind: AgentKind,
    provider: Option<&ProviderConfig>,
) -> Result<(), AppError> {
    let path = config_path(kind)?;
    apply_at(kind, &path, provider)
}

fn apply_at(
    kind: AgentKind,
    path: &Path,
    provider: Option<&ProviderConfig>,
) -> Result<(), AppError> {
    let before = read_text_optional(&path)?;
    let mut backup = original(&path)?;
    if provider.is_none() && backup["belfryManaged"] != true {
        return Ok(());
    }
    if provider.is_some() && !selection_path(&path).exists() {
        ensure_available(kind, &before, &backup)?;
        backup = if kind == AgentKind::Kimi {
            json!({"default_model":toml(&before)?.get("default_model").and_then(Item::as_str)})
        } else {
            let parsed = json_config::parse(&before)?;
            if kind == AgentKind::Antigravity {
                json!({"model":parsed["model"], "modelProvider":parsed["modelProvider"]})
            } else {
                json!({"model":parsed["model"]})
            }
        };
        backup["belfryManaged"] = json!(true);
    }
    let after = apply(kind, &before, provider, &backup)?;
    if provider.is_some() && !selection_path(&path).exists() {
        write_atomic(&selection_path(&path), &backup.to_string(), true)?;
    }
    write_atomic(&path, &after, true)?;
    if provider.is_none() && selection_path(&path).exists() {
        std::fs::remove_file(selection_path(&path)).map_err(|e| AppError::io(e.to_string()))?;
    }
    Ok(())
}

pub(super) fn apply(
    kind: AgentKind,
    text: &str,
    provider: Option<&ProviderConfig>,
    backup: &Value,
) -> Result<String, AppError> {
    if let Some(provider) = provider {
        validate_model(kind, &provider.model)?;
    }
    if provider.is_some() {
        ensure_available(kind, text, backup)?;
    } else if backup["belfryManaged"] != true {
        return Ok(text.into());
    }
    if kind == AgentKind::Kimi {
        return apply_kimi(text, provider, backup);
    }
    let before = json_config::parse(text)?;
    let mut out = if text.trim().is_empty() {
        "{}\n".into()
    } else {
        text.to_string()
    };
    let mut set = |path: &[&str], value: Option<Value>| -> Result<(), AppError> {
        out = json_config::set(&out, path, value.as_ref())?;
        Ok(())
    };
    match kind {
        AgentKind::Opencode => {
            if let Some(p) = provider {
                set(&["providers", OWNER], Some(opencode_provider(p)))?;
                set(
                    &["model"],
                    Some(json!(format!("{OWNER}/{}", p.model.trim()))),
                )?;
            } else {
                set(&["providers", OWNER], None)?;
                if before["model"]
                    .as_str()
                    .is_some_and(|m| m.starts_with("belfry/"))
                {
                    set(
                        &["model"],
                        backup.get("model").filter(|v| !v.is_null()).cloned(),
                    )?;
                }
            }
        }
        AgentKind::Antigravity => {
            if let Some(p) = provider {
                // In Gemini API mode agy 1.5 sends modelName verbatim to /models/.
                // The endpoint is supplied separately through GOOGLE_GEMINI_BASE_URL.
                set(
                    &["customModelsConfig", "customModels", OWNER],
                    Some(json!({"modelName":p.model.trim(), "label":AGY_MODEL})),
                )?;
                set(&["modelProvider"], Some(json!("gemini")))?;
                set(&["model"], Some(json!(AGY_MODEL)))?;
            } else {
                set(&["customModelsConfig", "customModels", OWNER], None)?;
                if before["model"] == AGY_MODEL {
                    for key in ["model", "modelProvider"] {
                        set(&[key], backup.get(key).filter(|v| !v.is_null()).cloned())?;
                    }
                }
            }
        }
        _ => return Err(AppError::invalid_argument("不支持的 Provider 类型")),
    }
    Ok(out)
}

fn ensure_available(kind: AgentKind, text: &str, backup: &Value) -> Result<(), AppError> {
    if backup["belfryManaged"] == true {
        return Ok(());
    }
    let occupied = if kind == AgentKind::Kimi {
        let doc = toml(text)?;
        ["providers", "models"]
            .iter()
            .any(|key| doc.get(key).and_then(|t| t.get(OWNER)).is_some())
    } else {
        let doc = json_config::parse(text)?;
        if kind == AgentKind::Opencode {
            doc["providers"].get(OWNER).is_some()
        } else {
            doc["customModelsConfig"]["customModels"]
                .as_object()
                .is_some_and(|m| {
                    m.contains_key(OWNER) || m.values().any(|v| v["label"] == AGY_MODEL)
                })
        }
    };
    if occupied {
        return Err(AppError::invalid_argument(
            "CLI 中 belfry Provider 名称已被现有配置占用，未覆盖；请先重命名原生配置中的该条目",
        ));
    }
    Ok(())
}

pub(super) fn opencode_provider(p: &ProviderConfig) -> Value {
    json!({"name":p.name, "package":"@opencode/ai/providers/openai-compatible",
        "settings":{"baseURL":p.base_url, "apiKey":p.api_key},
        "models":{p.model.trim():{"name":p.model.trim()}}})
}
fn apply_kimi(
    text: &str,
    provider: Option<&ProviderConfig>,
    backup: &Value,
) -> Result<String, AppError> {
    let mut doc = toml(text)?;
    if let Some(p) = provider {
        for key in ["providers", "models"] {
            if doc.get(key).is_none() {
                doc[key] = Item::Table(Table::new());
            }
            if !doc[key].is_table_like() {
                return Err(AppError::invalid_argument(
                    "Kimi providers / models 必须为表",
                ));
            }
        }
        let mut table = Table::new();
        table["type"] = value("openai");
        table["base_url"] = value(p.base_url.trim());
        table["api_key"] = value(p.api_key.as_str());
        doc["providers"][OWNER] = Item::Table(table);
        let mut model = Table::new();
        model["provider"] = value(OWNER);
        model["model"] = value(p.model.trim());
        doc["models"][OWNER] = Item::Table(model);
        doc["default_model"] = value(OWNER);
    } else {
        for key in ["providers", "models"] {
            if let Some(table) = doc.get_mut(key).and_then(Item::as_table_like_mut) {
                table.remove(OWNER);
            }
        }
        if doc.get("default_model").and_then(Item::as_str) == Some(OWNER) {
            if let Some(previous) = backup["default_model"].as_str() {
                doc["default_model"] = value(previous);
            } else {
                doc.remove("default_model");
            }
        }
    }
    Ok(doc.to_string())
}

pub(super) fn config_files(
    kind: AgentKind,
    provider: Option<&ProviderConfig>,
) -> Result<Vec<ConfigFilePreview>, AppError> {
    let path = config_path(kind)?;
    let mut content = read_text_optional(&path)?;
    if let Some(p) = provider {
        content = apply(kind, &content, Some(p), &original(&path)?)?;
    }
    Ok(vec![ConfigFilePreview {
        path: path.display().to_string(),
        format: if kind == AgentKind::Kimi {
            "toml"
        } else {
            "json"
        }
        .into(),
        content,
    }])
}
pub(super) fn save_config_file(
    kind: AgentKind,
    path: &Path,
    content: &str,
) -> Result<(), AppError> {
    if path != config_path(kind)? {
        return Err(AppError::invalid_argument("只能编辑当前 CLI 的配置文件"));
    }
    if kind == AgentKind::Kimi {
        toml(content)?;
    } else {
        json_config::parse(content)?;
    }
    write_atomic(path, content, true)
}

pub(super) fn detect_live(
    kind: AgentKind,
) -> Result<Option<(String, String, String, String)>, AppError> {
    let text = read_text_optional(&config_path(kind)?)?;
    let result: (String, String, String, String) = if kind == AgentKind::Kimi {
        let doc = toml(&text)?;
        let alias = doc
            .get("default_model")
            .and_then(Item::as_str)
            .unwrap_or_default();
        let Some(model) = doc.get("models").and_then(|t| t.get(alias)) else {
            return Ok(None);
        };
        let provider = model
            .get("provider")
            .and_then(Item::as_str)
            .unwrap_or_default();
        let Some(p) = doc.get("providers").and_then(|t| t.get(provider)) else {
            return Ok(None);
        };
        if !matches!(
            p.get("type").and_then(Item::as_str),
            Some("openai" | "kimi")
        ) {
            return Ok(None);
        }
        let key = p
            .get("api_key")
            .and_then(Item::as_str)
            .map(str::to_owned)
            .or_else(|| p.get("api_key_env").and_then(Item::as_str).and_then(env))
            .unwrap_or_default();
        (
            provider.into(),
            p.get("base_url")
                .and_then(Item::as_str)
                .unwrap_or_default()
                .into(),
            key,
            model
                .get("model")
                .and_then(Item::as_str)
                .unwrap_or_default()
                .into(),
        )
    } else {
        let doc = json_config::parse(&text)?;
        if kind == AgentKind::Opencode {
            let Some((provider, model)) = doc["model"].as_str().and_then(|s| s.split_once('/'))
            else {
                return Ok(None);
            };
            let p = &doc["providers"][provider];
            if p["package"] != "@opencode/ai/providers/openai-compatible" {
                return Ok(None);
            }
            let raw = p["settings"]["apiKey"].as_str().unwrap_or_default();
            let key = match raw.strip_prefix("{env:").and_then(|s| s.strip_suffix('}')) {
                Some(name) => env(name).unwrap_or_default(),
                None => raw.into(),
            };
            (
                p["name"].as_str().unwrap_or(provider).into(),
                p["settings"]["baseURL"].as_str().unwrap_or_default().into(),
                key,
                model.into(),
            )
        } else {
            if doc["modelProvider"] != "gemini" {
                return Ok(None);
            }
            let Some(p) = doc["customModelsConfig"]["customModels"]
                .as_object()
                .and_then(|items| items.values().find(|p| p["label"] == doc["model"]))
            else {
                return Ok(None);
            };
            let Some(model) = p["modelName"].as_str() else {
                return Ok(None);
            };
            let url = env("GOOGLE_GEMINI_BASE_URL")
                .unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta".into());
            // Managed keys are kept in Belfry's vault and injected only into the launched CLI.
            let Some(key) = env("GEMINI_API_KEY") else {
                return Ok(None);
            };
            ("Antigravity Gemini API".into(), url, key, model.into())
        }
    };
    Ok((!result.1.is_empty()).then_some(result))
}
fn env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .or_else(|| crate::agent::login_shell_env().get(name).cloned())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn provider() -> ProviderConfig {
        ProviderConfig {
            id: "x".into(),
            name: "test".into(),
            base_url: "https://api.example/v1".into(),
            api_key: "test-key".into(),
            model: "model".into(),
            created_at: 0,
        }
    }
    #[test]
    fn opencode_v2_preserves_jsonc_and_restores_selection() {
        let source = "{\n// Keep MCP\n\"mcp\":{\"servers\":{}},\"model\":\"anthropic/old\",\"providers\":{\"mine\":{}},\n}";
        let next = apply(AgentKind::Opencode, source, Some(&provider()), &json!({})).unwrap();
        assert!(next.contains("// Keep MCP"));
        assert_eq!(
            json_config::parse(&next).unwrap()["providers"][OWNER]["settings"]["apiKey"],
            "test-key"
        );
        let restored = apply(
            AgentKind::Opencode,
            &next,
            None,
            &json!({"model":"anthropic/old","belfryManaged":true}),
        )
        .unwrap();
        assert_eq!(
            json_config::parse(&restored).unwrap(),
            json_config::parse(source).unwrap()
        );
    }
    #[test]
    fn kimi_keeps_hooks_and_user_models() {
        let source = "# user comment\ndefault_model = 'mine'\n[models.mine]\nmodel='old'\nprovider='mine'\n[[hooks]]\nevent='Stop'\ncommand='echo done'\n";
        let next = apply(AgentKind::Kimi, source, Some(&provider()), &json!({})).unwrap();
        let restored = apply(
            AgentKind::Kimi,
            &next,
            None,
            &json!({"default_model":"mine","belfryManaged":true}),
        )
        .unwrap();
        let doc = toml(&restored).unwrap();
        assert_eq!(doc["default_model"].as_str(), Some("mine"));
        assert_eq!(doc["hooks"].as_array_of_tables().unwrap().len(), 1);
        assert!(restored.contains("# user comment"));
    }
    #[test]
    fn antigravity_uses_gemini_models_without_persisting_the_key() {
        let next = apply(
            AgentKind::Antigravity,
            "{\"trustedWorkspaces\":[\"/work\"]}",
            Some(&provider()),
            &json!({}),
        )
        .unwrap();
        let doc = json_config::parse(&next).unwrap();
        assert_eq!(doc["modelProvider"], "gemini");
        assert_eq!(
            doc["customModelsConfig"]["customModels"][OWNER]["modelName"],
            "model"
        );
        assert!(!next.contains("test-key"));
        assert_eq!(doc["trustedWorkspaces"], json!(["/work"]));
    }

    #[test]
    fn native_provider_names_are_owned_only_after_belfry_created_them() {
        for (kind, source) in [
            (
                AgentKind::Opencode,
                r#"{"providers":{"belfry":{"name":"User provider"}}}"#,
            ),
            (
                AgentKind::Kimi,
                "[models.belfry]\nmodel='user-model'\nprovider='mine'\n",
            ),
            (
                AgentKind::Antigravity,
                r#"{"customModelsConfig":{"customModels":{"mine":{"label":"Belfry"}}}}"#,
            ),
        ] {
            assert!(apply(kind, source, Some(&provider()), &json!({})).is_err());
            assert_eq!(apply(kind, source, None, &json!({})).unwrap(), source);
        }
    }

    #[test]
    fn selecting_official_login_without_a_managed_provider_creates_no_files() {
        let root =
            std::env::temp_dir().join(format!("belfry-provider-noop-{}", ulid::Ulid::generate()));
        let path = root.join("settings.json");
        apply_at(AgentKind::Antigravity, &path, None).unwrap();
        assert!(!root.exists());
    }

    #[test]
    fn switching_native_providers_restores_the_original_model_and_preserves_manual_selection() {
        let root = std::env::temp_dir().join(format!(
            "belfry-provider-restore-{}",
            ulid::Ulid::generate()
        ));
        let path = root.join("opencode.jsonc");
        std::fs::create_dir_all(&root).unwrap();
        let source = "{ // user comment\n\"model\":\"mine/first\",\"providers\":{\"mine\":{}} }";
        std::fs::write(&path, source).unwrap();
        apply_at(AgentKind::Opencode, &path, Some(&provider())).unwrap();
        let mut next = provider();
        next.model = "second".into();
        apply_at(AgentKind::Opencode, &path, Some(&next)).unwrap();
        apply_at(AgentKind::Opencode, &path, None).unwrap();
        let restored = read_text_optional(&path).unwrap();
        assert_eq!(
            json_config::parse(&restored).unwrap(),
            json_config::parse(source).unwrap()
        );
        assert!(restored.contains("// user comment"));
        assert!(!selection_path(&path).exists());
        apply_at(AgentKind::Opencode, &path, Some(&provider())).unwrap();
        let edited = json_config::set(
            &read_text_optional(&path).unwrap(),
            &["model"],
            Some(&json!("mine/manual")),
        )
        .unwrap();
        std::fs::write(&path, edited).unwrap();
        apply_at(AgentKind::Opencode, &path, None).unwrap();
        assert_eq!(
            json_config::parse(&read_text_optional(&path).unwrap()).unwrap()["model"],
            "mine/manual"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }
}
