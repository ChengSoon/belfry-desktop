//! 两个扫描器共用的聚合层：模型名归一、按模型/项目累加。

use std::collections::HashMap;
use std::path::Path;

use crate::agent::AgentKind;

use super::contracts::{ModelUsage, ProjectUsage, TokenTotals};

/// 一次扫描的累加结果。
#[derive(Debug, Default)]
pub struct UsageAccumulator {
    models: HashMap<(AgentKind, String), ModelBucket>,
    projects: HashMap<String, TokenTotals>,
}

#[derive(Debug, Default)]
struct ModelBucket {
    tokens: TokenTotals,
    requests: u64,
    last_used_at: Option<i64>,
    /// 同族的原始写法计数，用出现最多的那个展示。
    spellings: HashMap<String, u64>,
}

impl UsageAccumulator {
    /// 记一笔用量。`raw_model` 用原始写法传入，归一在内部做。
    pub fn record(
        &mut self,
        agent: AgentKind,
        raw_model: &str,
        tokens: TokenTotals,
        at: Option<i64>,
        cwd: Option<&str>,
    ) {
        if tokens.is_empty() {
            return;
        }
        let bucket = self
            .models
            .entry((agent, fold_model_name(raw_model)))
            .or_default();
        bucket.tokens.add(tokens);
        bucket.requests += 1;
        bucket.last_used_at = bucket.last_used_at.max(at);
        *bucket.spellings.entry(raw_model.to_string()).or_default() += 1;

        if let Some(path) = cwd.filter(|value| !value.is_empty()) {
            self.projects
                .entry(path.to_string())
                .or_default()
                .add(tokens);
        }
    }

    pub fn models(&self) -> Vec<ModelUsage> {
        let mut models: Vec<ModelUsage> = self
            .models
            .iter()
            .map(|((agent, fold), bucket)| ModelUsage {
                agent: *agent,
                model: bucket.display_name(fold),
                tokens: bucket.tokens,
                requests: bucket.requests,
                last_used_at: bucket.last_used_at,
            })
            .collect();
        // token 总量降序，同量按模型名稳定排序，避免 HashMap 顺序抖动。
        models.sort_by(|a, b| {
            b.tokens
                .total()
                .cmp(&a.tokens.total())
                .then_with(|| a.model.cmp(&b.model))
        });
        models
    }

    pub fn totals(&self) -> TokenTotals {
        let mut totals = TokenTotals::default();
        for bucket in self.models.values() {
            totals.add(bucket.tokens);
        }
        totals
    }

    /// 按项目聚合。会话 cwd 可能是项目子目录，这里保留原始路径，由调用方决定是否合并。
    pub fn projects(&self) -> Vec<ProjectUsage> {
        let mut projects: Vec<ProjectUsage> = self
            .projects
            .iter()
            .map(|(root_path, tokens)| ProjectUsage {
                root_path: root_path.clone(),
                name: project_name(root_path),
                tokens: *tokens,
            })
            .collect();
        projects.sort_by(|a, b| {
            b.tokens
                .total()
                .cmp(&a.tokens.total())
                .then_with(|| a.root_path.cmp(&b.root_path))
        });
        projects
    }
}

impl ModelBucket {
    fn display_name(&self, fallback: &str) -> String {
        self.spellings
            .iter()
            // 次数相同时取字典序最大，让带点号的规范写法（claude-opus-4.8）胜出。
            .max_by(|a, b| a.1.cmp(b.1).then_with(|| a.0.cmp(b.0)))
            .map(|(name, _)| name.clone())
            .unwrap_or_else(|| fallback.to_string())
    }
}

/// 归一模型名：转小写并去掉所有分隔符，让 `claude-opus-4-8` 和 `claude-opus-4.8` 落进同一桶。
/// 两家官方都用过这两种写法指同一模型，不合并会把一个模型拆成两行。
fn fold_model_name(model: &str) -> String {
    model
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn project_name(root_path: &str) -> String {
    Path::new(root_path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(root_path)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens(output: u64) -> TokenTotals {
        TokenTotals {
            output,
            ..TokenTotals::default()
        }
    }

    #[test]
    fn merges_separator_variants_of_the_same_model() {
        let mut acc = UsageAccumulator::default();
        acc.record(AgentKind::Claude, "claude-opus-4-8", tokens(10), None, None);
        acc.record(AgentKind::Claude, "claude-opus-4.8", tokens(5), None, None);
        acc.record(AgentKind::Claude, "claude-opus-4.8", tokens(5), None, None);

        let models = acc.models();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].tokens.output, 20);
        assert_eq!(models[0].requests, 3);
        // 出现两次的规范写法胜出
        assert_eq!(models[0].model, "claude-opus-4.8");
    }

    #[test]
    fn keeps_distinct_models_and_agents_apart() {
        let mut acc = UsageAccumulator::default();
        acc.record(AgentKind::Claude, "claude-opus-5", tokens(1), None, None);
        acc.record(AgentKind::Claude, "claude-sonnet-5", tokens(1), None, None);
        // 同名模型跨 Agent 不合并
        acc.record(AgentKind::Codex, "claude-opus-5", tokens(1), None, None);
        assert_eq!(acc.models().len(), 3);
    }

    #[test]
    fn ignores_zero_token_records() {
        let mut acc = UsageAccumulator::default();
        acc.record(AgentKind::Claude, "<synthetic>", tokens(0), None, None);
        assert!(acc.models().is_empty());
        assert_eq!(acc.totals().total(), 0);
    }

    #[test]
    fn tracks_latest_use_and_totals_across_models() {
        let mut acc = UsageAccumulator::default();
        acc.record(AgentKind::Claude, "m", tokens(1), Some(100), None);
        acc.record(AgentKind::Claude, "m", tokens(1), Some(50), None);
        assert_eq!(acc.models()[0].last_used_at, Some(100));
        assert_eq!(acc.totals().output, 2);
    }

    #[test]
    fn sorts_models_by_total_tokens_descending() {
        let mut acc = UsageAccumulator::default();
        acc.record(AgentKind::Claude, "small", tokens(1), None, None);
        acc.record(AgentKind::Claude, "big", tokens(100), None, None);
        let models = acc.models();
        assert_eq!(models[0].model, "big");
        assert_eq!(models[1].model, "small");
    }

    #[test]
    fn aggregates_projects_by_session_cwd() {
        let mut acc = UsageAccumulator::default();
        let root = if cfg!(windows) {
            "C:\\work\\belfry"
        } else {
            "/work/belfry"
        };
        acc.record(AgentKind::Claude, "m", tokens(7), None, Some(root));
        acc.record(AgentKind::Claude, "m", tokens(3), None, Some(""));

        let projects = acc.projects();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].tokens.output, 7);
        assert_eq!(projects[0].name, "belfry");
    }
}
