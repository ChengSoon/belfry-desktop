use super::contracts::{CheckKind, CheckState, EnvironmentCheck};
use crate::agent::{AgentKind, paths};
use serde_json::Value;

pub(super) fn checks(kind: AgentKind, version: &str) -> Vec<EnvironmentCheck> {
    let minimum = match kind {
        AgentKind::Antigravity => "1.5.3",
        AgentKind::Opencode => "2.2.6",
        AgentKind::Kimi => "2.5.2",
        _ => unreachable!(),
    };
    let supported = crate::agent::hooks::features::supported(kind, Some(version));
    let mut checks = vec![EnvironmentCheck::new(
        CheckKind::Doctor(kind),
        if supported {
            CheckState::Ok
        } else {
            CheckState::Warning
        },
        if supported {
            belfry_i18n::text("支持 Belfry 状态、历史和插件集成").into()
        } else {
            belfry_i18n::lformat!(
                "完整集成需要 {} {minimum} 或更新版本，请在关于页更新",
                kind.display_name()
            )
        },
    )];
    let Some(root) = paths::config_dir(kind) else {
        return checks;
    };
    let configured = match kind {
        AgentKind::Kimi => {
            let doc = std::fs::read_to_string(root.join("config.toml"))
                .ok()
                .and_then(|s| s.parse::<toml_edit::DocumentMut>().ok());
            doc.as_ref().is_some_and(|d| {
                d.get("providers")
                    .and_then(toml_edit::Item::as_table_like)
                    .is_some_and(|t| !t.is_empty())
            }) || std::fs::read_dir(root.join("credentials")).is_ok_and(|mut e| {
                e.any(|f| f.is_ok_and(|f| f.path().extension().is_some_and(|s| s == "json")))
            }) || env("KIMI_MODEL_API_KEY")
        }
        AgentKind::Opencode => {
            let config = if root.join("opencode.jsonc").is_file() {
                root.join("opencode.jsonc")
            } else {
                root.join("opencode.json")
            };
            let providers = std::fs::read_to_string(config)
                .ok()
                .and_then(|s| crate::provider::json_config::parse(&s).ok());
            let auth = paths::data_dir(kind)
                .and_then(|d| std::fs::read_to_string(d.join("auth.json")).ok())
                .and_then(|s| serde_json::from_str::<Value>(&s).ok());
            providers
                .as_ref()
                .is_some_and(|v| v["providers"].as_object().is_some_and(|m| !m.is_empty()))
                || auth
                    .as_ref()
                    .is_some_and(|v| v.as_object().is_some_and(|m| !m.is_empty()))
                || paths::data_dir(kind)
                    .is_some_and(|data| opencode_credentials(&paths::opencode_database(&data)))
        }
        AgentKind::Antigravity => {
            let settings = std::fs::read_to_string(root.join("settings.json"))
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok());
            env("GEMINI_API_KEY")
                || settings
                    .as_ref()
                    .is_some_and(|v| v["customModelsConfig"]["customModels"]["belfry"].is_object())
        }
        _ => false,
    };
    let help = match kind {
        AgentKind::Opencode => belfry_i18n::text("在会话中执行 /connect，或在 Provider 设置中配置接口"),
        AgentKind::Kimi => belfry_i18n::text("执行 kimi login，或在 Provider 设置中配置接口"),
        _ => belfry_i18n::text("启动 agy 完成 Google 登录，或在 Provider 设置中配置 Gemini API"),
    };
    checks.push(EnvironmentCheck::new(
        CheckKind::Auth(kind),
        if configured {
            CheckState::Ok
        } else {
            CheckState::Warning
        },
        if configured {
            belfry_i18n::text("已检测到 Provider 或凭据配置；联网鉴权由 CLI 完成")
        } else {
            help
        },
    ));
    checks
}
fn env(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .or_else(|| crate::agent::login_shell_env().get(name).cloned())
        .is_some_and(|s| !s.trim().is_empty())
}

fn opencode_credentials(path: &std::path::Path) -> bool {
    // v2 stores credentials in SQLite. Inspect existence only; never load secrets.
    let Ok(db) =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return false;
    };
    let _ = db.busy_timeout(std::time::Duration::from_millis(250));
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM credential WHERE active=1)",
        [],
        |row| row.get::<_, bool>(0),
    )
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opencode_detects_v2_credentials_without_reading_secret_values() {
        let path =
            std::env::temp_dir().join(format!("belfry-credentials-{}.db", ulid::Ulid::generate()));
        assert!(!opencode_credentials(&path));
        assert!(!path.exists());
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE credential (active INTEGER); INSERT INTO credential VALUES (0);",
        )
        .unwrap();
        assert!(!opencode_credentials(&path));
        db.execute("UPDATE credential SET active=1", []).unwrap();
        assert!(opencode_credentials(&path));
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
}
