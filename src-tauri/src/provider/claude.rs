//! Claude Code 的 `~/.claude/settings.json`。
//!
//! 这个文件是用户的地盘：hooks、enabledPlugins、tui、几十个 env 变量都在里面。
//! Belfry 只认领 `env` 下的四个键，其余逐字不动——包括键的顺序，靠的是
//! serde_json 的 `preserve_order` feature（见 Cargo.toml）。

use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::terminal::AppError;

use crate::atomic::write_atomic;
use super::contracts::ProviderConfig;

const BASE_URL: &str = "ANTHROPIC_BASE_URL";
const AUTH_TOKEN: &str = "ANTHROPIC_AUTH_TOKEN";
/// 和 AUTH_TOKEN 是同一件事的两种写法。两个并存时 Claude Code 用哪个不好说，
/// 所以切换时统一收敛到 AUTH_TOKEN，把这个删掉，免得旧凭据悄悄生效。
const API_KEY: &str = "ANTHROPIC_API_KEY";
const MODEL: &str = "ANTHROPIC_MODEL";

pub(super) fn settings_path() -> Result<PathBuf, AppError> {
    // CLAUDE_CONFIG_DIR 会把整个配置目录挪走，Claude Code 自己认这个变量，我们也得认。
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(dir).join("settings.json"));
    }
    let home = crate::usage::home_dir()
        .ok_or_else(|| AppError::not_found("找不到当前用户的 home 目录"))?;
    Ok(home.join(".claude").join("settings.json"))
}

/// 读现有配置。文件不存在返回空对象——首次使用 Claude Code 的机器就是这样。
pub(super) fn read_settings() -> Result<Value, AppError> {
    let path = settings_path()?;
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Value::Object(Map::new()));
        }
        Err(err) => {
            return Err(AppError::io(format!("读不了 {}：{err}", path.display())));
        }
    };
    if text.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(&text).map_err(|err| {
        // 解析不了就停手。这里要是猜着写，用户的 hooks 就没了。
        AppError::invalid_argument(format!(
            "{} 不是合法的 JSON，请先修好再切换 provider：{err}",
            path.display()
        ))
    })
}

/// 把 provider 写进内存里的配置对象。`None` 表示切回官方。
///
/// 只碰 `env` 下那四个键，其余原样保留。
pub(super) fn apply(
    settings: &mut Value,
    provider: Option<&ProviderConfig>,
) -> Result<(), AppError> {
    let root = settings
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_argument("settings.json 的顶层必须是一个对象"))?;

    let Some(provider) = provider else {
        // 切回官方：把 Belfry 写过的键摘掉，让 Claude Code 自己的登录态接管。
        if let Some(env) = root.get_mut("env").and_then(Value::as_object_mut) {
            for key in [BASE_URL, AUTH_TOKEN, API_KEY, MODEL] {
                env.remove(key);
            }
        }
        return Ok(());
    };

    let env = root
        .entry("env")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| AppError::invalid_argument("settings.json 的 env 必须是一个对象"))?;

    env.insert(
        BASE_URL.to_string(),
        Value::String(provider.base_url.clone()),
    );
    env.insert(
        AUTH_TOKEN.to_string(),
        Value::String(provider.api_key.clone()),
    );
    env.remove(API_KEY);

    if provider.model.trim().is_empty() {
        env.remove(MODEL);
    } else {
        env.insert(MODEL.to_string(), Value::String(provider.model.clone()));
    }
    Ok(())
}

pub(super) fn write_settings(settings: &Value) -> Result<(), AppError> {
    let path = settings_path()?;
    let mut text = serde_json::to_string_pretty(settings)
        .map_err(|err| AppError::io(format!("序列化 settings.json 失败：{err}")))?;
    // to_string_pretty 不带结尾换行，补上，跟手写的文件保持一致。
    text.push('\n');
    write_atomic(&path, &text, true)
}

/// 保存用户在界面上编辑后的 settings.json 全文。
///
/// 路径必须是 `settings_path()` 算出来的那个，别的文件一概不碰。
/// 写之前先校验 JSON：文件里可能住着 hooks，坏了 Claude Code 直接跑不起来。
pub(super) fn save_config_file(path: &std::path::Path, content: &str) -> Result<(), AppError> {
    let expected = settings_path()?;
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
    write_atomic(&expected, content, true)
}

/// 从现有配置里认出一份 provider 设置，用于首次接管。
///
/// 用户在装 Belfry 之前多半已经配好了某个中转服务，那份配置必须变成一条
/// 可以切回去的条目，而不是被下一次切换静默覆盖掉。
pub(super) fn detect_live(settings: &Value) -> Option<(String, String, String)> {
    let env = settings.get("env")?.as_object()?;
    let base_url = env.get(BASE_URL)?.as_str()?.trim().to_string();
    if base_url.is_empty() {
        return None;
    }
    let api_key = env
        .get(AUTH_TOKEN)
        .or_else(|| env.get(API_KEY))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let model = env
        .get(MODEL)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    Some((base_url, api_key, model))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 照用户真机上那份 settings.json 的形状搭的：顶层混着 hooks 和标量，
    /// env 里既有路由变量也有一堆无关的。
    fn live_settings() -> Value {
        serde_json::json!({
            "cleanupPeriodDays": 720,
            "env": {
                "ANTHROPIC_AUTH_TOKEN": "sk-old",
                "ANTHROPIC_BASE_URL": "https://old.example.com",
                "ANTHROPIC_DEFAULT_OPUS_MODEL": "opus-mapped",
                "CLAUDE_CODE_SUBAGENT_MODEL": "subagent-mapped",
                "HTTP_PROXY": "http://127.0.0.1:7890",
                "MCP_TIMEOUT": "30000"
            },
            "includeCoAuthoredBy": false,
            "model": "opusplan",
            "hooks": { "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "say done" }] }] },
            "enabledPlugins": { "some-plugin@marketplace": true },
            "tui": { "theme": "dark" }
        })
    }

    fn provider(model: &str) -> ProviderConfig {
        ProviderConfig {
            id: "p1".into(),
            name: "Kimi".into(),
            base_url: "https://api.moonshot.cn/anthropic".into(),
            api_key: "sk-new".into(),
            model: model.into(),
            created_at: 0,
        }
    }

    #[test]
    fn switching_touches_only_the_routing_keys() {
        let mut settings = live_settings();
        apply(&mut settings, Some(&provider("kimi-k2"))).unwrap();

        let env = settings["env"].as_object().unwrap();
        assert_eq!(
            env["ANTHROPIC_BASE_URL"],
            "https://api.moonshot.cn/anthropic"
        );
        assert_eq!(env["ANTHROPIC_AUTH_TOKEN"], "sk-new");
        assert_eq!(env["ANTHROPIC_MODEL"], "kimi-k2");

        // 模型映射和代理设置跟 provider 路由正交，一个都不许动。
        assert_eq!(env["ANTHROPIC_DEFAULT_OPUS_MODEL"], "opus-mapped");
        assert_eq!(env["CLAUDE_CODE_SUBAGENT_MODEL"], "subagent-mapped");
        assert_eq!(env["HTTP_PROXY"], "http://127.0.0.1:7890");
        assert_eq!(env["MCP_TIMEOUT"], "30000");
    }

    #[test]
    fn top_level_user_settings_survive_untouched() {
        let mut settings = live_settings();
        let hooks_before = settings["hooks"].clone();
        apply(&mut settings, Some(&provider(""))).unwrap();

        assert_eq!(settings["hooks"], hooks_before, "hooks 丢了就是灾难");
        assert_eq!(settings["enabledPlugins"]["some-plugin@marketplace"], true);
        assert_eq!(settings["tui"]["theme"], "dark");
        assert_eq!(settings["cleanupPeriodDays"], 720);
        assert_eq!(settings["model"], "opusplan");
    }

    #[test]
    fn key_order_is_preserved_so_diffs_stay_readable() {
        // 这条守的是 Cargo.toml 里的 preserve_order feature。它要是被摘掉，
        // 13 个顶层键会按字母重排，每次切换都产生一屏无关 diff。
        let mut settings = live_settings();
        apply(&mut settings, Some(&provider("kimi-k2"))).unwrap();

        let top: Vec<&str> = settings
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            top,
            vec![
                "cleanupPeriodDays",
                "env",
                "includeCoAuthoredBy",
                "model",
                "hooks",
                "enabledPlugins",
                "tui"
            ]
        );
        let env: Vec<&str> = settings["env"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(env[0], "ANTHROPIC_AUTH_TOKEN", "原有键必须留在原位");
        assert_eq!(env[1], "ANTHROPIC_BASE_URL");
    }

    #[test]
    fn an_empty_model_removes_the_override_instead_of_writing_a_blank() {
        let mut settings = live_settings();
        apply(&mut settings, Some(&provider("kimi-k2"))).unwrap();
        assert!(settings["env"].get("ANTHROPIC_MODEL").is_some());

        apply(&mut settings, Some(&provider(""))).unwrap();
        assert!(
            settings["env"].get("ANTHROPIC_MODEL").is_none(),
            "空模型该是「不覆盖」，不是「覆盖成空串」"
        );
    }

    #[test]
    fn switching_back_to_official_clears_every_claimed_key() {
        let mut settings = live_settings();
        settings["env"]["ANTHROPIC_API_KEY"] = Value::String("sk-legacy".into());

        apply(&mut settings, None).unwrap();

        let env = settings["env"].as_object().unwrap();
        for key in [BASE_URL, AUTH_TOKEN, API_KEY, MODEL] {
            assert!(env.get(key).is_none(), "{key} 该被清掉");
        }
        // 清的是路由，不是用户的其它设置。
        assert_eq!(env["HTTP_PROXY"], "http://127.0.0.1:7890");
        assert_eq!(
            settings["hooks"]["Stop"][0]["hooks"][0]["command"],
            "say done"
        );
    }

    #[test]
    fn a_legacy_api_key_is_folded_into_the_auth_token() {
        let mut settings = serde_json::json!({
            "env": { "ANTHROPIC_API_KEY": "sk-legacy", "ANTHROPIC_BASE_URL": "https://old.example.com" }
        });
        apply(&mut settings, Some(&provider(""))).unwrap();

        let env = settings["env"].as_object().unwrap();
        assert_eq!(env["ANTHROPIC_AUTH_TOKEN"], "sk-new");
        assert!(
            env.get("ANTHROPIC_API_KEY").is_none(),
            "两个凭据键并存时行为不可预测，得收敛到一个"
        );
    }

    #[test]
    fn detects_an_existing_setup_for_first_run_adoption() {
        let (base_url, api_key, model) = detect_live(&live_settings()).unwrap();
        assert_eq!(base_url, "https://old.example.com");
        assert_eq!(api_key, "sk-old");
        assert_eq!(model, "");
    }

    #[test]
    fn detects_nothing_when_the_user_is_on_the_official_endpoint() {
        let settings = serde_json::json!({ "env": { "HTTP_PROXY": "http://127.0.0.1:7890" } });
        assert!(detect_live(&settings).is_none());
    }

    #[test]
    fn adding_env_to_a_file_that_has_none() {
        let mut settings = serde_json::json!({ "model": "opusplan" });
        apply(&mut settings, Some(&provider(""))).unwrap();
        assert_eq!(
            settings["env"]["ANTHROPIC_BASE_URL"],
            "https://api.moonshot.cn/anthropic"
        );
        assert_eq!(settings["model"], "opusplan");
    }

    /// 拿一份真实的 settings.json 跑一遍改写，报告到底动了哪些键。
    ///
    /// `BELFRY_REAL_CLAUDE_SETTINGS=/path/to/settings.json cargo test claude::tests::dump_real -- --ignored --nocapture`
    ///
    /// 只打印键名，不打印值——这个文件里有 token。
    #[ignore]
    #[test]
    fn dump_real_settings_diff() {
        let Ok(path) = std::env::var("BELFRY_REAL_CLAUDE_SETTINGS") else {
            println!("未设置 BELFRY_REAL_CLAUDE_SETTINGS，跳过");
            return;
        };
        let source = std::fs::read_to_string(&path).expect("读不到指定的 settings.json");
        let before: Value = serde_json::from_str(&source).expect("这份 settings.json 解析不了");
        let mut after = before.clone();
        apply(&mut after, Some(&provider("probe-model"))).unwrap();

        let keys = |value: &Value, pointer: &str| -> Vec<String> {
            value
                .pointer(pointer)
                .and_then(Value::as_object)
                .map(|map| map.keys().cloned().collect())
                .unwrap_or_default()
        };

        let top_before = keys(&before, "");
        let top_after = keys(&after, "");
        println!("顶层键 {} 个 → {} 个", top_before.len(), top_after.len());
        assert_eq!(top_before, top_after, "顶层键的集合与顺序都不该变");

        let env_before = keys(&before, "/env");
        let env_after = keys(&after, "/env");
        println!("env 键 {} 个 → {} 个", env_before.len(), env_after.len());

        let changed: Vec<&String> = env_after
            .iter()
            .filter(|key| {
                before.pointer("/env").and_then(|env| env.get(*key))
                    != after.pointer("/env").and_then(|env| env.get(*key))
            })
            .collect();
        println!("值发生变化的 env 键：{changed:?}");
        let dropped: Vec<&String> = env_before
            .iter()
            .filter(|key| !env_after.contains(key))
            .collect();
        println!("被移除的 env 键：{dropped:?}");

        assert!(
            changed
                .iter()
                .all(|key| key.starts_with("ANTHROPIC_BASE_URL")
                    || key.starts_with("ANTHROPIC_AUTH_TOKEN")
                    || key.starts_with("ANTHROPIC_MODEL")),
            "只该动路由三要素：{changed:?}"
        );
        assert!(
            dropped.iter().all(|key| *key == "ANTHROPIC_API_KEY"),
            "除了被收敛掉的 ANTHROPIC_API_KEY，不该有 env 键消失：{dropped:?}"
        );
    }
}
