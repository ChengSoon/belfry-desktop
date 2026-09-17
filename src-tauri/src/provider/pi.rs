//! Pi 的 `~/.pi/agent/models.json` 与 `~/.pi/agent/settings.json`。
//!
//! Pi 的路由模型和 Codex 不同：三方中转要以「自定义 provider」的形式登记进
//! models.json（baseUrl + api + apiKey + models），再让 settings.json 在启动时
//! 选中它（defaultProvider / defaultModel）。Belfry 只认领 `providers.belfry`
//! 这一个名字，其余 provider 逐字不动——那是用户在 `/model` 里自己加的。
//!
//! apiKey 以字面量写进 models.json（Pi 文档支持字面量 / `$ENV` / `!cmd` 三种写法），
//! 所以这个文件落盘用 0600。

use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};

use crate::terminal::AppError;

use super::contracts::{ConfigFilePreview, ProviderConfig};
use crate::atomic::{read_text_optional, write_atomic};

/// Belfry 在 models.json 里的所有权哨兵：只有这个名字的 provider 归我们管。
const TABLE: &str = "belfry";
/// OpenAI 兼容中转最常用的 API 类型；Pi 文档列它为「most compatible」。
const API: &str = "openai-completions";

fn config_dir() -> Result<PathBuf, AppError> {
    crate::history::scan::pi_config_dir().ok_or_else(|| AppError::not_found("找不到当前用户的 home 目录"))
}

pub(super) fn models_path() -> Result<PathBuf, AppError> {
    Ok(config_dir()?.join("models.json"))
}

fn settings_path() -> Result<PathBuf, AppError> {
    Ok(config_dir()?.join("settings.json"))
}

pub(super) fn read_models() -> Result<Value, AppError> {
    read_json(&models_path()?)
}

pub(super) fn read_settings() -> Result<Value, AppError> {
    read_json(&settings_path()?)
}

/// 读现有配置，文件不存在或为空返回空对象。
fn read_json(path: &Path) -> Result<Value, AppError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Value::Object(Map::new()));
        }
        Err(err) => return Err(AppError::io(format!("读不了 {}：{err}", path.display()))),
    };
    if text.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(&text).map_err(|err| {
        AppError::invalid_argument(format!(
            "{} 不是合法的 JSON，请先修好再切换 provider：{err}",
            path.display()
        ))
    })
}

/// 把 provider 写进内存中的两个配置对象。`None` 表示切回官方。
pub(super) fn apply(
    models: &mut Value,
    settings: &mut Value,
    provider: Option<&ProviderConfig>,
) -> Result<(), AppError> {
    // `providers` 是 models.json 的 schema 必填字段，先把容器坐实：文件原本不存在
    // （read_json 给出 `{}`）时落盘也得是 `{"providers":{}}`，否则 pi 启动即报错。
    let models_root = models
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_argument("models.json 的顶层必须是一个对象"))?;
    let providers = models_root
        .entry("providers")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_argument("models.json 的 providers 必须是一个对象"))?;

    let Some(provider) = provider else {
        providers.remove(TABLE);
        let settings_root = settings.as_object_mut().ok_or_else(|| {
            AppError::invalid_argument("settings.json 的顶层必须是一个对象")
        })?;
        // defaultModel 是不带 provider 前缀的裸 id，认不出归属，只能靠 defaultProvider
        // 判断：指着我们时两个一起摘，否则是用户自己选的，一个都不动。
        if settings_root.get("defaultProvider").and_then(Value::as_str) == Some(TABLE) {
            settings_root.remove("defaultProvider");
            settings_root.remove("defaultModel");
        }
        return Ok(());
    };

    let entry = providers
        .entry(TABLE.to_string())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_argument("models.json 的 providers.belfry 必须是一个对象"))?;
    entry.insert("baseUrl".into(), Value::String(provider.base_url.trim().to_string()));
    entry.insert("api".into(), Value::String(API.to_string()));
    entry.insert("apiKey".into(), Value::String(provider.api_key.trim().to_string()));
    // models[].id 的 schema 是 minLength 1，没填模型时写 [{"id":""}] 会让 pi 启动即报
    // 「Invalid models.json schema」。models 本身是可选的，此时整个字段省掉。
    let model = provider.model.trim();
    if model.is_empty() {
        entry.remove("models");
    } else {
        entry.insert("models".into(), json!([{"id": model}]));
    }

    let settings_root = settings
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_argument("settings.json 的顶层必须是一个对象"))?;
    settings_root.insert("defaultProvider".into(), Value::String(TABLE.to_string()));
    // defaultModel 要的是裸 model id：pi 用 (defaultProvider, defaultModel) 精确查表，
    // 带上 "belfry/" 前缀会查不到，静默回落到别的模型。
    if model.is_empty() {
        settings_root.remove("defaultModel");
    } else {
        settings_root.insert("defaultModel".into(), Value::String(model.to_string()));
    }
    Ok(())
}

fn write_json(path: &Path, value: &Value) -> Result<(), AppError> {
    let mut text = serde_json::to_string_pretty(value)
        .map_err(|err| AppError::io(format!("序列化 {} 失败：{err}", path.display())))?;
    text.push('\n');
    // models.json 里带着明文 API key，权限收紧到 0600。
    write_atomic(path, &text, path.file_name().is_some_and(|n| n == "models.json"))
}

/// 切换的原子写：两个文件一起改。先写 models.json 再写 settings.json；
/// 中途失败会留下「provider 登记了但没选中」，下次切换是幂等的，可自愈。
pub(super) fn apply_live(provider: Option<&ProviderConfig>) -> Result<(), AppError> {
    let mut models = read_models()?;
    let mut settings = read_settings()?;
    apply(&mut models, &mut settings, provider)?;
    write_json(&models_path()?, &models)?;
    write_json(&settings_path()?, &settings)
}

/// 保存界面上编辑后的配置文件全文；路径白名单只认这两个文件。
pub(super) fn save_config_file(path: &Path, content: &str) -> Result<(), AppError> {
    let expected = match path.file_name().and_then(|value| value.to_str()) {
        Some("models.json") => models_path()?,
        Some("settings.json") => settings_path()?,
        _ => {
            return Err(AppError::invalid_argument(format!(
                "只允许修改 {} 或 {}，不能动别的文件",
                models_path()?.display(),
                settings_path()?.display()
            )))
        }
    };
    if path != expected {
        return Err(AppError::invalid_argument(format!(
            "只允许修改 {}，不能动别的文件",
            expected.display()
        )));
    }
    serde_json::from_str::<Value>(content).map_err(|err| {
        AppError::invalid_argument(format!(
            "{} 不是合法的 JSON，文件没有改动：{err}",
            expected.display()
        ))
    })?;
    write_atomic(&expected, content, path.file_name().is_some_and(|n| n == "models.json"))
}

/// 从现有配置里认出一份 provider 设置，用于首次接管。返回 (name, base_url, model, api_key)。
pub(super) fn detect_live(models: &Value, settings: &Value) -> Option<(String, String, String, String)> {
    let entry = models.get("providers")?.get(TABLE)?.as_object()?;
    let base_url = entry.get("baseUrl")?.as_str()?.trim();
    if base_url.is_empty() {
        return None;
    }
    let api_key = entry.get("apiKey").and_then(Value::as_str).unwrap_or_default();
    if api_key.trim().is_empty() {
        return None;
    }
    // defaultModel 存的是裸 id，只有 defaultProvider 指着我们时它才属于这份配置。
    let model = match settings.get("defaultProvider").and_then(Value::as_str) {
        Some(TABLE) => settings
            .get("defaultModel")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        _ => "",
    };
    Some((
        TABLE.to_string(),
        base_url.to_string(),
        model.to_string(),
        api_key.to_string(),
    ))
}

/// 当前生效的 Pi 配置文件原文。
pub(super) fn config_files() -> Result<Vec<ConfigFilePreview>, AppError> {
    let mut files = Vec::new();
    for (path, format) in [
        (models_path()?, "json"),
        (settings_path()?, "json"),
    ] {
        if path.exists() {
            files.push(ConfigFilePreview {
                path: path.display().to_string(),
                format: format.to_string(),
                content: read_text_optional(&path)?,
            });
        }
    }
    Ok(files)
}

/// Provider 套用后的内存预览，不写入磁盘。
pub(super) fn config_files_for_provider(provider: &ProviderConfig) -> Result<Vec<ConfigFilePreview>, AppError> {
    let mut models = read_models()?;
    let mut settings = read_settings()?;
    apply(&mut models, &mut settings, Some(provider))?;
    Ok(vec![
        ConfigFilePreview {
            path: models_path()?.display().to_string(),
            format: "json".to_string(),
            content: pretty(&models)?,
        },
        ConfigFilePreview {
            path: settings_path()?.display().to_string(),
            format: "json".to_string(),
            content: pretty(&settings)?,
        },
    ])
}

fn pretty(value: &Value) -> Result<String, AppError> {
    let mut text = serde_json::to_string_pretty(value)
        .map_err(|err| AppError::io(format!("序列化配置预览失败：{err}")))?;
    text.push('\n');
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(model: &str) -> ProviderConfig {
        ProviderConfig {
            id: "p1".into(),
            name: "中转".into(),
            base_url: "https://relay.example.com/v1".into(),
            api_key: "sk-new".into(),
            model: model.into(),
            created_at: 0,
        }
    }

    #[test]
    fn apply_writes_the_owned_provider_and_selection() {
        let mut models = serde_json::json!({"providers":{"user-ollama":{"baseUrl":"http://x"}}});
        let mut settings = serde_json::json!({"theme":"dark"});

        apply(&mut models, &mut settings, Some(&provider("gpt-x"))).unwrap();

        let entry = &models["providers"][TABLE];
        assert_eq!(entry["baseUrl"], "https://relay.example.com/v1");
        assert_eq!(entry["api"], "openai-completions");
        assert_eq!(entry["apiKey"], "sk-new");
        assert_eq!(entry["models"][0]["id"], "gpt-x");
        assert_eq!(settings["defaultProvider"], TABLE);
        // 裸 id，不带 "belfry/" 前缀：pi 用 (defaultProvider, defaultModel) 精确查表。
        assert_eq!(settings["defaultModel"], "gpt-x");
        // 用户自己的 provider 原样保留。
        assert!(models["providers"].get("user-ollama").is_some());
        assert_eq!(settings["theme"], "dark");
    }

    #[test]
    fn a_provider_without_a_model_omits_the_models_array() {
        // models[].id 的 schema 是 minLength 1；写 [{"id":""}] 会让 pi 启动即报 schema 错。
        let mut models = serde_json::json!({});
        let mut settings = serde_json::json!({});

        apply(&mut models, &mut settings, Some(&provider("  "))).unwrap();

        assert!(models["providers"][TABLE].get("models").is_none());
        assert_eq!(models["providers"][TABLE]["baseUrl"], "https://relay.example.com/v1");
        assert_eq!(settings["defaultProvider"], TABLE);
        assert!(settings.get("defaultModel").is_none());
    }

    #[test]
    fn clearing_the_model_drops_a_previously_written_one() {
        let mut models = serde_json::json!({"providers":{TABLE:{"models":[{"id":"gpt-old"}]}}});
        let mut settings = serde_json::json!({"defaultModel":"gpt-old"});

        apply(&mut models, &mut settings, Some(&provider(""))).unwrap();

        assert!(models["providers"][TABLE].get("models").is_none());
        assert!(settings.get("defaultModel").is_none());
    }

    #[test]
    fn providers_survives_as_an_empty_object() {
        // `providers` 是 schema 必填字段，删到空也不能把整个键摘掉。
        let mut models = serde_json::json!({"providers":{TABLE:{"baseUrl":"https://x"}}});
        let mut settings = serde_json::json!({});

        apply(&mut models, &mut settings, None).unwrap();

        assert_eq!(models, serde_json::json!({"providers":{}}));
    }

    #[test]
    fn a_missing_models_file_still_lands_a_valid_skeleton() {
        // read_json 对不存在的文件给出 `{}`，直接落盘会缺 `providers`。
        let mut models = serde_json::json!({});
        let mut settings = serde_json::json!({});

        apply(&mut models, &mut settings, None).unwrap();

        assert_eq!(models, serde_json::json!({"providers":{}}));
    }

    #[test]
    fn switching_back_removes_only_the_owned_entries() {
        let mut models = serde_json::json!({"providers":{TABLE:{"baseUrl":"https://relay.example.com/v1"},"user":{"baseUrl":"http://x"}}});
        let mut settings = serde_json::json!({"defaultProvider":TABLE,"defaultModel":"gpt-x","defaultThinkingLevel":"high"});

        apply(&mut models, &mut settings, None).unwrap();

        assert!(models["providers"].get(TABLE).is_none());
        assert!(models["providers"].get("user").is_some());
        assert!(settings.get("defaultProvider").is_none());
        assert!(settings.get("defaultModel").is_none());
        assert_eq!(settings["defaultThinkingLevel"], "high");
    }

    #[test]
    fn a_user_selected_model_survives_switching_back() {
        // defaultProvider 不是我们，defaultModel 就是用户自己选的，一个字都不动。
        let mut models = serde_json::json!({});
        let mut settings = serde_json::json!({"defaultProvider":"anthropic","defaultModel":"claude-x"});

        apply(&mut models, &mut settings, None).unwrap();

        assert_eq!(settings["defaultProvider"], "anthropic");
        assert_eq!(settings["defaultModel"], "claude-x");
    }

    #[test]
    fn detect_live_recognizes_the_owned_setup() {
        let models = serde_json::json!({"providers":{TABLE:{"baseUrl":"https://relay.example.com/v1","apiKey":"sk-old"}}});
        let settings = serde_json::json!({"defaultProvider":TABLE,"defaultModel":"gpt-old"});

        let (name, base_url, model, api_key) = detect_live(&models, &settings).unwrap();
        assert_eq!(name, TABLE);
        assert_eq!(base_url, "https://relay.example.com/v1");
        assert_eq!(model, "gpt-old");
        assert_eq!(api_key, "sk-old");
    }

    #[test]
    fn detect_live_ignores_a_model_belonging_to_another_provider() {
        let models = serde_json::json!({"providers":{TABLE:{"baseUrl":"https://x","apiKey":"sk-old"}}});
        let settings = serde_json::json!({"defaultProvider":"anthropic","defaultModel":"claude-x"});

        let (_, _, model, _) = detect_live(&models, &settings).unwrap();
        assert_eq!(model, "");
    }

    #[test]
    fn detect_live_ignores_official_and_keyless_setups() {
        assert!(detect_live(&serde_json::json!({}), &serde_json::json!({})).is_none());
        let keyless = serde_json::json!({"providers":{TABLE:{"baseUrl":"https://x","apiKey":" "}}});
        assert!(detect_live(&keyless, &serde_json::json!({})).is_none());
    }
}
