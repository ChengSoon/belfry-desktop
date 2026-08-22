//! Codex 的 `~/.codex/config.toml` 与 `~/.codex/auth.json`。
//!
//! config.toml 里住着 MCP 服务器定义和一长串 `[projects."..."]` 信任记录，
//! 都是 Codex 自己持续写入的。所以这里用 toml_edit 做外科手术式修改：
//! 只碰 `model_provider`、`model` 和 `[model_providers.belfry]` 这张表，
//! 注释、空行、键序原样保留。
//!
//! auth.json 更要小心——它存的是 ChatGPT 的 OAuth 令牌而不是 API key，
//! 直接覆盖等于把用户登出。切走之前先把原文存进 Belfry 的库里，切回来时还原。

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use toml_edit::{DocumentMut, Item, value};

use crate::terminal::AppError;

use crate::atomic::{read_text_optional, write_atomic};
use super::contracts::{ConfigFilePreview, ProviderConfig};

/// Belfry 在 config.toml 里的所有权哨兵：只有这个名字的表归我们管，
/// 用户自己定义的其它 `[model_providers.*]` 一概不碰。
const TABLE: &str = "belfry";

/// Codex 0.147 起 `wire_api` 只接受 "responses"，写 "chat" 会直接启动失败。
const WIRE_API: &str = "responses";

fn codex_home() -> Result<PathBuf, AppError> {
    // CODEX_HOME 会把整个配置目录挪走，Codex 自己认这个变量，我们也得认。
    if let Some(dir) = std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    let home = crate::usage::home_dir()
        .ok_or_else(|| AppError::not_found("找不到当前用户的 home 目录"))?;
    Ok(home.join(".codex"))
}

pub(super) fn read_config() -> Result<DocumentMut, AppError> {
    read_config_in(&codex_home()?)
}

fn read_config_in(dir: &Path) -> Result<DocumentMut, AppError> {
    let path = dir.join("config.toml");
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(AppError::io(format!("读不了 {}：{err}", path.display()))),
    };
    text.parse::<DocumentMut>().map_err(|err| {
        AppError::invalid_argument(format!(
            "{} 不是合法的 TOML，请先修好再切换 provider：{err}",
            path.display()
        ))
    })
}

/// 把 provider 写进内存里的文档。`None` 表示切回官方。
pub(super) fn apply(
    doc: &mut DocumentMut,
    provider: Option<&ProviderConfig>,
) -> Result<(), AppError> {
    let root = doc.as_table_mut();

    let Some(provider) = provider else {
        // 只在指向我们自己那张表时才摘掉，用户手动改成别的就别插手了。
        if root.get("model_provider").and_then(Item::as_str) == Some(TABLE) {
            root.remove("model_provider");
        }
        if let Some(providers) = root.get_mut("model_providers").and_then(Item::as_table_mut) {
            providers.remove(TABLE);
            // 只收走自己建的那个空壳。用户手写的 [model_providers] 表头哪怕是空的，
            // 也是他文件里的一行，不该顺手删掉。
            if providers.is_empty() && providers.is_implicit() {
                root.remove("model_providers");
            }
        }
        // `model` 不删：它本来就是用户在 config.toml 里管的东西，
        // Belfry 只在某个 provider 明确指定了模型时才代写。
        return Ok(());
    };

    root["model_provider"] = value(TABLE);
    if !provider.model.trim().is_empty() {
        root["model"] = value(provider.model.trim());
    }

    let existed = root.contains_key("model_providers");
    let providers = root
        .entry("model_providers")
        .or_insert(toml_edit::table())
        .as_table_mut()
        .ok_or_else(|| AppError::invalid_argument("config.toml 的 model_providers 必须是一张表"))?;
    // 只有我们自己新建的父表才设成隐式（只输出 [model_providers.belfry]）。
    // 用户文件里已经有一行光秃秃的 [model_providers] 时，那是他的排版，动它就等于删了一行。
    if !existed {
        providers.set_implicit(true);
    }

    let entry = providers
        .entry(TABLE)
        .or_insert(toml_edit::table())
        .as_table_mut()
        .ok_or_else(|| {
            AppError::invalid_argument("config.toml 的 model_providers.belfry 必须是一张表")
        })?;
    entry["name"] = value(provider.name.trim());
    entry["base_url"] = value(provider.base_url.trim());
    entry["wire_api"] = value(WIRE_API);
    // 这个开关让 Codex 去 auth.json 里取 OPENAI_API_KEY。
    entry["requires_openai_auth"] = value(true);

    Ok(())
}

/// auth.json 当前是不是 ChatGPT 登录态（而不是一把 API key）。
fn is_oauth(auth: &Value) -> bool {
    auth.get("tokens").is_some_and(|tokens| !tokens.is_null())
}

fn read_auth_in(dir: &Path) -> Result<Option<Value>, AppError> {
    let path = dir.join("auth.json");
    match std::fs::read_to_string(&path) {
        Ok(text) if text.trim().is_empty() => Ok(None),
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(|err| {
            AppError::invalid_argument(format!("{} 不是合法的 JSON：{err}", path.display()))
        }),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(AppError::io(format!("读不了 {}：{err}", path.display()))),
    }
}

fn write_auth_in(dir: &Path, auth: &Value) -> Result<(), AppError> {
    let mut text = serde_json::to_string_pretty(auth)
        .map_err(|err| AppError::io(format!("序列化 auth.json 失败：{err}")))?;
    text.push('\n');
    write_atomic(&dir.join("auth.json"), &text, true)
}

fn write_config_in(dir: &Path, doc: &DocumentMut) -> Result<(), AppError> {
    write_atomic(&dir.join("config.toml"), &doc.to_string(), true)
}

/// 保存用户在界面上编辑后的 Codex 配置全文。
///
/// 只认 `config.toml` 与 `auth.json` 两个文件；格式先校验再落盘，
/// 校验失败时原文件一个字都不动。
pub(super) fn save_config_file(path: &Path, content: &str) -> Result<(), AppError> {
    let dir = codex_home()?;
    let config = dir.join("config.toml");
    let auth = dir.join("auth.json");

    if path == config {
        content.parse::<DocumentMut>().map_err(|err| {
            AppError::invalid_argument(format!(
                "{} 不是合法的 TOML，文件没有改动：{err}",
                config.display()
            ))
        })?;
        return write_atomic(&config, content, true);
    }
    if path == auth {
        serde_json::from_str::<Value>(content).map_err(|err| {
            AppError::invalid_argument(format!(
                "{} 不是合法的 JSON，文件没有改动：{err}",
                auth.display()
            ))
        })?;
        return write_atomic(&auth, content, true);
    }
    Err(AppError::invalid_argument(
        "只允许修改 Codex 的 config.toml 和 auth.json",
    ))
}

/// 切换 Codex 的 provider。两个文件要么一起成，要么一起不动。
///
/// `official_auth` 是 Belfry 库里存的那份 ChatGPT 登录态，会被就地更新。
pub(super) fn switch(
    provider: Option<&ProviderConfig>,
    official_auth: &mut Option<Value>,
) -> Result<(), AppError> {
    switch_in(&codex_home()?, provider, official_auth)
}

fn switch_in(
    dir: &Path,
    provider: Option<&ProviderConfig>,
    official_auth: &mut Option<Value>,
) -> Result<(), AppError> {
    let mut doc = read_config_in(dir)?;
    apply(&mut doc, provider)?;

    let live_auth = read_auth_in(dir)?;
    let next_auth = match provider {
        Some(provider) => {
            // 切走之前把 ChatGPT 登录态收进库里，不然这一步就把它冲掉了。
            if let Some(current) = &live_auth
                && is_oauth(current)
            {
                *official_auth = Some(current.clone());
            }
            let mut map = Map::new();
            map.insert(
                "OPENAI_API_KEY".to_string(),
                Value::String(provider.api_key.clone()),
            );
            Some(Value::Object(map))
        }
        // 切回官方：把当初存下的登录态放回去。没存过就别动人家的 auth.json。
        None => official_auth.take(),
    };

    if let Some(next) = &next_auth {
        write_auth_in(dir, next)?;
    }

    // config.toml 写失败就把 auth.json 退回去，否则会留下
    // 「凭据已经换成三方、路由还指着官方」这种谁都跑不通的中间态。
    if let Err(error) = write_config_in(dir, &doc) {
        if next_auth.is_some() {
            match &live_auth {
                Some(previous) => {
                    let _ = write_auth_in(dir, previous);
                }
                None => {
                    let _ = std::fs::remove_file(dir.join("auth.json"));
                }
            }
            // 备份也一并退回，保持内存与磁盘一致。
            if provider.is_some() {
                *official_auth = None;
            } else {
                *official_auth = next_auth;
            }
        }
        return Err(error);
    }
    Ok(())
}

/// 从现有配置里认出一份 provider 设置，用于首次接管。
///
/// 返回 (name, base_url, model, api_key)。
pub(super) fn detect_live(doc: &DocumentMut) -> Option<(String, String, String, String)> {
    let root = doc.as_table();
    let current = root.get("model_provider")?.as_str()?;
    let entry = root
        .get("model_providers")?
        .as_table_like()?
        .get(current)?
        .as_table_like()?;
    let base_url = entry.get("base_url")?.as_str()?.trim().to_string();
    if base_url.is_empty() {
        return None;
    }
    let name = entry
        .get("name")
        .and_then(Item::as_str)
        .unwrap_or(current)
        .to_string();
    let model = root
        .get("model")
        .and_then(Item::as_str)
        .unwrap_or_default()
        .to_string();
    // key 有两个可能的落点：cc-switch 这类工具为了不动 auth.json 里的 ChatGPT
    // 登录态，会把 key 降级写进 experimental_bearer_token；否则就在 auth.json 里。
    let api_key = entry
        .get("experimental_bearer_token")
        .and_then(Item::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(auth_file_key);
    Some((name, base_url, model, api_key))
}

/// 当前生效的 Codex 配置文件原文：config.toml（路由）和 auth.json（凭据）。
/// 两个文件都可能还没建，不存在的跳过。
pub(super) fn config_files() -> Result<Vec<ConfigFilePreview>, AppError> {
    let dir = codex_home()?;
    let mut files = Vec::new();
    for (name, format) in [("config.toml", "toml"), ("auth.json", "json")] {
        let path = dir.join(name);
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

/// 生成某个 Provider 套用后的内存配置预览。
///
/// 和 `switch_in` 使用同一套字段改写规则，但不写入 config.toml/auth.json；
/// 即使文件还不存在，也返回将要创建的完整内容，方便新增 Provider 时对照。
pub(super) fn config_files_for_provider(
    provider: &ProviderConfig,
) -> Result<Vec<ConfigFilePreview>, AppError> {
    let dir = codex_home()?;
    config_files_for_provider_in(&dir, provider)
}

fn config_files_for_provider_in(
    dir: &Path,
    provider: &ProviderConfig,
) -> Result<Vec<ConfigFilePreview>, AppError> {
    let mut config = read_config_in(dir)?;
    apply(&mut config, Some(provider))?;

    let config_path = dir.join("config.toml");
    let auth_path = dir.join("auth.json");
    let mut auth = Map::new();
    auth.insert(
        "OPENAI_API_KEY".to_string(),
        Value::String(provider.api_key.clone()),
    );
    let mut auth_content = serde_json::to_string_pretty(&Value::Object(auth))
        .map_err(|err| AppError::io(format!("序列化 auth.json 预览失败：{err}")))?;
    auth_content.push('\n');

    Ok(vec![
        ConfigFilePreview {
            path: config_path.display().to_string(),
            format: "toml".to_string(),
            content: config.to_string(),
        },
        ConfigFilePreview {
            path: auth_path.display().to_string(),
            format: "json".to_string(),
            content: auth_content,
        },
    ])
}

/// auth.json 里的 API key。ChatGPT 登录态不算 key。
fn auth_file_key() -> String {
    codex_home()
        .and_then(|dir| read_auth_in(&dir))
        .ok()
        .flatten()
        .and_then(|auth| {
            auth.get("OPENAI_API_KEY")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 照用户真机那份 config.toml 的形状：MCP 定义、嵌套 env、带中文的项目路径、注释。
    const LIVE: &str = r#"model = "gpt-5.6-sol"
sandbox_mode = "workspace-write"
# 这行注释必须活下来
approval_policy = "on-request"
model_catalog_json = "custom-catalog.json"

[mcp_servers.node_repl]
command = "node"
startup_timeout_sec = 30

[mcp_servers.node_repl.env]
NODE_REPL_NODE_PATH = "/usr/local/lib/node_modules"
CODEX_HOME = "/Users/cheng/.codex"

[projects."/Users/cheng/work/Project/tool/打卡工具"]
trust_level = "trusted"
"#;

    fn provider(model: &str) -> ProviderConfig {
        ProviderConfig {
            id: "p1".into(),
            name: "Kimi".into(),
            base_url: "https://api.moonshot.cn/v1".into(),
            api_key: "sk-new".into(),
            model: model.into(),
            created_at: 0,
        }
    }

    #[test]
    fn mcp_servers_and_project_trust_survive_a_switch() {
        let mut doc = LIVE.parse::<DocumentMut>().unwrap();
        apply(&mut doc, Some(&provider("kimi-k2"))).unwrap();
        let out = doc.to_string();

        // 这些是 Codex 自己持续写入的东西，丢一条都是用户的实打实损失。
        assert!(out.contains("[mcp_servers.node_repl]"));
        assert!(out.contains("startup_timeout_sec = 30"));
        assert!(out.contains("[mcp_servers.node_repl.env]"));
        assert!(out.contains("NODE_REPL_NODE_PATH = \"/usr/local/lib/node_modules\""));
        assert!(
            out.contains(r#"[projects."/Users/cheng/work/Project/tool/打卡工具"]"#),
            "带引号和中文的表名往返必须无损"
        );
        assert!(out.contains("trust_level = \"trusted\""));
        assert!(out.contains("# 这行注释必须活下来"));
        // 与 provider 路由正交的顶层键也不许动。
        assert!(out.contains("sandbox_mode = \"workspace-write\""));
        assert!(out.contains("model_catalog_json = \"custom-catalog.json\""));
    }

    #[test]
    fn writes_a_provider_table_codex_actually_accepts() {
        let mut doc = LIVE.parse::<DocumentMut>().unwrap();
        apply(&mut doc, Some(&provider("kimi-k2"))).unwrap();
        let out = doc.to_string();

        assert!(out.contains("model_provider = \"belfry\""));
        assert!(out.contains("[model_providers.belfry]"));
        assert!(out.contains("base_url = \"https://api.moonshot.cn/v1\""));
        // 0.147 起写 "chat" 会让 Codex 直接启动失败。
        assert!(out.contains("wire_api = \"responses\""));
        assert!(out.contains("requires_openai_auth = true"));
        assert!(
            !out.contains("\n[model_providers]"),
            "父表该是隐式的，不该多出一行空表头"
        );
    }

    #[test]
    fn an_empty_model_leaves_the_users_own_choice_alone() {
        let mut doc = LIVE.parse::<DocumentMut>().unwrap();
        apply(&mut doc, Some(&provider(""))).unwrap();
        // 没填模型就是「我自己管」，不该被清掉也不该被写成空串。
        assert!(doc.to_string().contains("model = \"gpt-5.6-sol\""));
    }

    #[test]
    fn switching_back_to_official_removes_only_our_own_table() {
        let mut doc = LIVE.parse::<DocumentMut>().unwrap();
        apply(&mut doc, Some(&provider("kimi-k2"))).unwrap();
        apply(&mut doc, None).unwrap();
        let out = doc.to_string();

        assert!(!out.contains("[model_providers.belfry]"));
        assert!(!out.contains("model_provider ="));
        assert!(!out.contains("[model_providers]"), "空壳也该收走");
        assert!(out.contains("[mcp_servers.node_repl]"));
        assert!(out.contains("# 这行注释必须活下来"));
    }

    #[test]
    fn a_user_defined_provider_table_is_left_untouched() {
        let source = "model_provider = \"mine\"\n\n[model_providers.mine]\nbase_url = \"https://mine.example.com\"\n";
        let mut doc = source.parse::<DocumentMut>().unwrap();
        apply(&mut doc, None).unwrap();
        let out = doc.to_string();

        // model_provider 指着别人的表，说明用户自己配的，我们没有所有权。
        assert!(out.contains("model_provider = \"mine\""));
        assert!(out.contains("[model_providers.mine]"));
    }

    #[test]
    fn switching_twice_does_not_duplicate_the_table() {
        let mut doc = LIVE.parse::<DocumentMut>().unwrap();
        apply(&mut doc, Some(&provider("a"))).unwrap();
        apply(&mut doc, Some(&provider("b"))).unwrap();
        let out = doc.to_string();
        assert_eq!(out.matches("[model_providers.belfry]").count(), 1);
    }

    #[test]
    fn detects_an_existing_setup_for_first_run_adoption() {
        let mut doc = LIVE.parse::<DocumentMut>().unwrap();
        apply(&mut doc, Some(&provider("kimi-k2"))).unwrap();

        let (name, base_url, model, _) = detect_live(&doc).unwrap();
        assert_eq!(name, "Kimi");
        assert_eq!(base_url, "https://api.moonshot.cn/v1");
        assert_eq!(model, "kimi-k2");
    }

    /// 真机上的形态：另一个切换工具（cc-switch）写下的表，外加一行显式的
    /// `[model_providers]` 表头。这两点都是手搓样本里想不到的。
    const CC_SWITCH_STYLE: &str = r#"model = "gpt-5.6-sol"
model_provider = "custom"

[model_providers]

[model_providers.custom]
name = "第三方中转"
wire_api = "responses"
requires_openai_auth = true
base_url = "https://relay.example.com/v1"
experimental_bearer_token = "sk-from-bearer"
"#;

    #[test]
    fn an_explicit_parent_table_header_is_not_swallowed() {
        let mut doc = CC_SWITCH_STYLE.parse::<DocumentMut>().unwrap();
        apply(&mut doc, Some(&provider("kimi-k2"))).unwrap();
        let out = doc.to_string();

        // 用户文件里那一行 `[model_providers]` 是他的排版，set_implicit 会把它抹掉。
        assert!(out.contains("\n[model_providers]\n"), "显式父表头被吞了");
        assert!(out.contains("[model_providers.custom]"), "别人的表不该被动");
        assert!(out.contains("[model_providers.belfry]"));
    }

    #[test]
    fn a_user_written_parent_table_survives_switching_back_to_official() {
        let mut doc = CC_SWITCH_STYLE.parse::<DocumentMut>().unwrap();
        apply(&mut doc, Some(&provider("kimi-k2"))).unwrap();
        apply(&mut doc, None).unwrap();
        let out = doc.to_string();

        assert!(!out.contains("[model_providers.belfry]"));
        assert!(
            out.contains("\n[model_providers]\n"),
            "只收自己的空壳，不动用户的"
        );
        assert!(out.contains("[model_providers.custom]"));
    }

    #[test]
    fn adoption_finds_a_key_that_lives_in_the_bearer_token() {
        // 为了不覆盖 auth.json 里的 ChatGPT 登录态，key 会被降级写进这个字段。
        // 只看 auth.json 的话，接管进来的条目会缺 key，用户切回去就用不了。
        let doc = CC_SWITCH_STYLE.parse::<DocumentMut>().unwrap();
        let (name, base_url, model, api_key) = detect_live(&doc).unwrap();
        assert_eq!(name, "第三方中转");
        assert_eq!(base_url, "https://relay.example.com/v1");
        assert_eq!(model, "gpt-5.6-sol");
        assert_eq!(api_key, "sk-from-bearer");
    }

    #[test]
    fn detects_nothing_on_a_stock_config() {
        let doc = LIVE.parse::<DocumentMut>().unwrap();
        assert!(detect_live(&doc).is_none());
    }

    #[test]
    fn draft_preview_contains_the_provider_base_url_without_writing_files() {
        let dir = sandbox("preview");
        let files = config_files_for_provider_in(&dir, &provider("kimi-k2")).unwrap();

        assert!(
            files[0]
                .content
                .contains("base_url = \"https://api.moonshot.cn/v1\"")
        );
        assert!(files[1].content.contains("\"OPENAI_API_KEY\": \"sk-new\""));
        assert!(!dir.join("config.toml").exists());
        assert!(!dir.join("auth.json").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn oauth_is_told_apart_from_an_api_key() {
        let oauth =
            serde_json::json!({ "auth_mode": "chatgpt", "tokens": { "access_token": "x" } });
        let api_key = serde_json::json!({ "OPENAI_API_KEY": "sk-x" });
        assert!(
            is_oauth(&oauth),
            "有 tokens 就是 ChatGPT 登录态，覆盖它等于把人登出"
        );
        assert!(!is_oauth(&api_key));
    }

    fn sandbox(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "belfry-provider-codex-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 用户真机上的 auth.json 就是这个形状：ChatGPT 登录态，不是 API key。
    fn oauth_auth() -> Value {
        serde_json::json!({
            "auth_mode": "chatgpt",
            "tokens": { "access_token": "at-secret", "refresh_token": "rt-secret" },
            "last_refresh": "2026-08-15T00:00:00Z"
        })
    }

    #[test]
    fn a_round_trip_through_a_third_party_restores_the_chatgpt_login() {
        let dir = sandbox("roundtrip");
        std::fs::write(dir.join("config.toml"), LIVE).unwrap();
        std::fs::write(dir.join("auth.json"), oauth_auth().to_string()).unwrap();
        let mut backup: Option<Value> = None;

        switch_in(&dir, Some(&provider("kimi-k2")), &mut backup).unwrap();

        // 切走：登录态进了库，磁盘上换成 API key。
        assert_eq!(
            backup,
            Some(oauth_auth()),
            "OAuth 没被收进备份，切回来就登出了"
        );
        let live: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("auth.json")).unwrap()).unwrap();
        assert_eq!(live["OPENAI_API_KEY"], "sk-new");
        assert!(live.get("tokens").is_none());

        switch_in(&dir, None, &mut backup).unwrap();

        // 切回：登录态原样躺回磁盘，库里的备份清空。
        let restored: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("auth.json")).unwrap()).unwrap();
        assert_eq!(
            restored,
            oauth_auth(),
            "ChatGPT 登录态没还原，用户得重新登录"
        );
        assert!(backup.is_none(), "还原过就不该再留着备份");
        assert!(
            !std::fs::read_to_string(dir.join("config.toml"))
                .unwrap()
                .contains("belfry")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_config_write_rolls_the_auth_file_back() {
        let dir = sandbox("rollback");
        std::fs::write(dir.join("config.toml"), LIVE).unwrap();
        std::fs::write(dir.join("auth.json"), oauth_auth().to_string()).unwrap();
        // 拿一个目录顶住 config.toml 的位置，让原子写的 rename 必然失败。
        std::fs::remove_file(dir.join("config.toml")).unwrap();
        std::fs::create_dir(dir.join("config.toml")).unwrap();
        let mut backup: Option<Value> = None;

        let result = switch_in(&dir, Some(&provider("kimi-k2")), &mut backup);

        assert!(result.is_err(), "config.toml 写不进去就该整体失败");
        // 关键：不能留下「凭据已换成三方、路由还指着官方」这种谁都跑不通的中间态。
        let auth: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("auth.json")).unwrap()).unwrap();
        assert_eq!(
            auth,
            oauth_auth(),
            "auth.json 没退回去，ChatGPT 登录态就白丢了"
        );
        assert!(backup.is_none(), "内存里的备份也该跟着退回");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn switching_to_official_without_a_backup_leaves_auth_alone() {
        let dir = sandbox("no-backup");
        std::fs::write(dir.join("config.toml"), LIVE).unwrap();
        let existing = serde_json::json!({ "OPENAI_API_KEY": "sk-user-put-this-here" });
        std::fs::write(dir.join("auth.json"), existing.to_string()).unwrap();
        let mut backup: Option<Value> = None;

        switch_in(&dir, None, &mut backup).unwrap();

        // 我们从没备份过东西，就没资格改写人家的 auth.json。
        let auth: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("auth.json")).unwrap()).unwrap();
        assert_eq!(auth, existing);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_api_key_auth_file_is_not_mistaken_for_a_login_worth_saving() {
        let dir = sandbox("apikey");
        std::fs::write(dir.join("config.toml"), LIVE).unwrap();
        std::fs::write(
            dir.join("auth.json"),
            serde_json::json!({ "OPENAI_API_KEY": "sk-previous" }).to_string(),
        )
        .unwrap();
        let mut backup: Option<Value> = None;

        switch_in(&dir, Some(&provider("kimi-k2")), &mut backup).unwrap();

        // 上一把 API key 不是登录态，备份它没有意义，还会在切回官方时被误当成登录材料写回去。
        assert!(backup.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 拿一份真实的 config.toml 跑一遍改写，逐行报告到底动了什么。    ///
    /// 单测用的是手搓样本，覆盖不到真机上那些奇形怪状的写法。排查时跑：
    /// `BELFRY_REAL_CODEX_CONFIG=/path/to/config.toml cargo test codex::tests::dump_real -- --ignored --nocapture`
    ///
    /// 只打印键名和行号，不打印值——这个文件里有 API key。
    #[ignore]
    #[test]
    fn dump_real_config_diff() {
        let Ok(path) = std::env::var("BELFRY_REAL_CODEX_CONFIG") else {
            println!("未设置 BELFRY_REAL_CODEX_CONFIG，跳过");
            return;
        };
        let source = std::fs::read_to_string(&path).expect("读不到指定的 config.toml");
        let mut doc = source
            .parse::<DocumentMut>()
            .expect("这份 config.toml 解析不了");
        apply(&mut doc, Some(&provider("probe-model"))).unwrap();
        let after = doc.to_string();

        let before_lines: Vec<&str> = source.lines().collect();
        let after_lines: Vec<&str> = after.lines().collect();
        println!("行数：{} → {}", before_lines.len(), after_lines.len());

        // 按集合比而不是按行号：插入一张表会让后面所有行号偏移，
        // 逐行索引对比会把整个文件报成「全变了」。
        let key_of = |line: &str| line.split('=').next().unwrap_or(line).trim().to_string();
        let removed: Vec<String> = before_lines
            .iter()
            .filter(|line| !after_lines.contains(line))
            .map(|line| key_of(line))
            .collect();
        let added: Vec<String> = after_lines
            .iter()
            .filter(|line| !before_lines.contains(line))
            .map(|line| key_of(line))
            .collect();

        println!("新增 {} 行：{:?}", added.len(), added);
        println!("移除 {} 行：{:?}", removed.len(), removed);
        assert!(
            removed.is_empty()
                || removed
                    .iter()
                    .all(|key| key == "model" || key == "model_provider"),
            "除了被改写的 model / model_provider，不该有任何行消失：{removed:?}"
        );

        // 真机上这两类内容最容易被误伤，跑到这里必须还在。
        for marker in ["[mcp_servers", "[projects."] {
            assert_eq!(
                source.matches(marker).count(),
                after.matches(marker).count(),
                "{marker} 的数量变了"
            );
        }
    }
}
