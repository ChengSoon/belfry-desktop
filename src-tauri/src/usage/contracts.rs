use serde::{Deserialize, Serialize};

use crate::agent::AgentKind;

/// 用量查询范围。`window_days` 为 None 表示不限时间；`project_root` 为 None 表示全部项目。
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageQuery {
    pub window_days: Option<u32>,
    pub project_root: Option<String>,
}

/// 四类 token 的统一口径。两家 Agent 的原始字段语义不同，入库前必须先归一到这里：
/// `input` 只算未命中缓存的新增输入，`cached_input` 是缓存读，`cache_write` 是缓存写入。
/// 因此 `total()` = input + cached_input + cache_write + output，两家可直接对比。
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenTotals {
    pub input: u64,
    pub cached_input: u64,
    pub cache_write: u64,
    pub output: u64,
}

impl TokenTotals {
    pub fn total(&self) -> u64 {
        self.input + self.cached_input + self.cache_write + self.output
    }

    pub fn is_empty(&self) -> bool {
        self.total() == 0
    }

    pub fn add(&mut self, other: Self) {
        self.input += other.input;
        self.cached_input += other.cached_input;
        self.cache_write += other.cache_write;
        self.output += other.output;
    }
}

/// 单个模型的用量。`model` 是同族里出现次数最多的原始写法，
/// 例如 `claude-opus-4-8` 与 `claude-opus-4.8` 会合并成一条。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub agent: AgentKind,
    pub model: String,
    pub tokens: TokenTotals,
    /// Claude 为去重后的 assistant 消息数；Codex 为产生用量增量的轮次数。
    pub requests: u64,
    pub last_used_at: Option<i64>,
}

/// 一个额度窗口。目前只有 Codex 在会话日志里提供，Claude 日志不含任何额度字段。
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub used_percent: f64,
    pub window_minutes: Option<u64>,
    pub resets_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentQuota {
    pub agent: AgentKind,
    pub plan_type: Option<String>,
    pub primary: Option<QuotaWindow>,
    pub secondary: Option<QuotaWindow>,
    pub observed_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUsage {
    pub root_path: String,
    pub name: String,
    pub tokens: TokenTotals,
}

/// 时间戳统一用 epoch 秒返回，交给前端本地化格式化。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub models: Vec<ModelUsage>,
    pub totals: TokenTotals,
    pub quotas: Vec<AgentQuota>,
    pub projects: Vec<ProjectUsage>,
    pub scanned_files: u32,
    pub skipped_files: u32,
    pub window_days: Option<u32>,
    pub generated_at: i64,
}
