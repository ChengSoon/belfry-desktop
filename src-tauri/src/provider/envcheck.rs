//! shell 里已有的同名环境变量会盖过配置文件，这是 provider 切换「看着没生效」
//! 的头号原因：Belfry 明明把 `~/.claude/settings.json` 改对了，Claude Code 启动
//! 时却优先用了 `.zshrc` 里那个 `export ANTHROPIC_BASE_URL`。
//!
//! 第一版只检测并提示。改用户的 rc 文件风险太高——那里可能有条件判断、有
//! 别的工具依赖的定义，删错一行的代价远大于多提示一句。

use std::collections::HashMap;

use crate::agent::AgentKind;

use super::contracts::{EnvConflict, EnvConflictSource};

/// 会真正夺走控制权的变量。只列这些，不做前缀通配：
/// `ANTHROPIC_DEFAULT_OPUS_MODEL` 这种映射变量跟 provider 路由无关，
/// 报出来只会让人以为哪里出了问题。
fn watched(kind: AgentKind) -> &'static [&'static str] {
    match kind {
        AgentKind::Claude => &[
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_MODEL",
        ],
        AgentKind::Codex => &["OPENAI_API_KEY", "OPENAI_BASE_URL"],
    }
}

pub(super) fn detect() -> Vec<EnvConflict> {
    let process: HashMap<String, String> = std::env::vars().collect();
    detect_from(crate::agent::login_shell_env(), &process)
}

fn detect_from(
    shell: &HashMap<String, String>,
    process: &HashMap<String, String>,
) -> Vec<EnvConflict> {
    let mut conflicts = Vec::new();
    for kind in AgentKind::ALL {
        for name in watched(kind) {
            // shell 优先：两边都有说明进程是从 shell 继承来的，而用户能动手
            // 改掉的是 rc 文件那一处，报这个才有下一步动作。
            let source = if is_set(shell, name) {
                EnvConflictSource::Shell
            } else if is_set(process, name) {
                EnvConflictSource::Process
            } else {
                continue;
            };
            conflicts.push(EnvConflict {
                kind,
                name: (*name).to_string(),
                source,
            });
        }
    }
    conflicts
}

fn is_set(env: &HashMap<String, String>, name: &str) -> bool {
    env.get(name).is_some_and(|value| !value.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    #[test]
    fn a_shell_export_wins_over_the_inherited_process_value() {
        let shell = env(&[("ANTHROPIC_BASE_URL", "https://shell.example.com")]);
        let process = env(&[("ANTHROPIC_BASE_URL", "https://shell.example.com")]);

        let conflicts = detect_from(&shell, &process);

        assert_eq!(conflicts.len(), 1, "同一个变量只该报一次");
        assert_eq!(conflicts[0].source, EnvConflictSource::Shell);
        assert_eq!(conflicts[0].kind, AgentKind::Claude);
    }

    #[test]
    fn a_gui_only_value_is_reported_as_process() {
        let conflicts = detect_from(&env(&[]), &env(&[("OPENAI_API_KEY", "sk-x")]));
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].source, EnvConflictSource::Process);
        assert_eq!(conflicts[0].kind, AgentKind::Codex);
    }

    #[test]
    fn an_empty_value_is_not_a_conflict() {
        // `export ANTHROPIC_BASE_URL=` 不会夺走控制权，报它纯属噪声。
        let conflicts = detect_from(&env(&[("ANTHROPIC_BASE_URL", "   ")]), &env(&[]));
        assert!(conflicts.is_empty());
    }

    #[test]
    fn model_mapping_variables_are_not_watched() {
        // 这些跟路由正交，用户设了是有意为之，不该报成冲突。
        let noisy = env(&[
            ("ANTHROPIC_DEFAULT_OPUS_MODEL", "x"),
            ("CLAUDE_CODE_SUBAGENT_MODEL", "y"),
            ("HTTP_PROXY", "http://127.0.0.1:7890"),
        ]);
        assert!(detect_from(&noisy, &env(&[])).is_empty());
    }

    #[test]
    fn a_clean_environment_reports_nothing() {
        assert!(detect_from(&env(&[]), &env(&[])).is_empty());
    }
}
