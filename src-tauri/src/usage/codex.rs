//! 扫描 Codex 会话日志（`~/.codex/sessions/**/*.jsonl`）。
//!
//! 与 Claude 不同，Codex 的 `token_count` 事件写的是**整个会话的累计值**，
//! 且事件本身不带模型名。所以要：
//! 1. 用 `turn_context.model` 跟踪当前激活模型（实测总先于 token_count 出现）；
//! 2. 对相邻累计快照做差值，把增量记给当时的模型 —— 会话中途换模型的情况真实存在；
//! 3. 累计值下降说明会话被 compact 或重开，此时把当前值整体当作增量。
//!
//! 额度（`rate_limits`）也只有这里有：取全局时间最新的一条非空快照。

use std::collections::HashSet;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;

use serde_json::Value;

use crate::agent::AgentKind;

use super::aggregate::UsageAccumulator;
use super::claude::matches_project;
use super::contracts::{QuotaWindow, TokenTotals};
use super::scan::ScanTally;
#[cfg(test)]
use super::timestamp::parse_rfc3339;

pub fn sessions_dir() -> Option<PathBuf> {
    crate::history::scan::codex_sessions_root()
}

#[derive(Clone, Debug, Default)]
pub struct QuotaSnapshot {
    pub plan_type: Option<String>,
    pub primary: Option<QuotaWindow>,
    pub secondary: Option<QuotaWindow>,
    pub observed_at: Option<i64>,
}

pub struct CodexScan {
    pub tally: ScanTally,
    pub quota: Option<QuotaSnapshot>,
}

#[path = "codex_scan.rs"]
mod scanning;
pub use scanning::scan;
#[cfg(test)]
pub(super) fn scan_fixture(
    root: &std::path::Path,
    accumulator: &mut UsageAccumulator,
    project_root: Option<&str>,
) -> CodexScan {
    scanning::scan_at(
        root,
        accumulator,
        scanning::ScanOptions {
            cutoff: None,
            project_root,
        },
    )
}
#[path = "codex_pending.rs"]
mod pending;
use pending::PendingUsage;
#[path = "codex_record.rs"]
mod record;
pub(super) use record::CodexRecord;
#[path = "codex_memory.rs"]
mod memory;

/// 单个会话文件的扫描状态。
pub(super) struct FileScan<'a> {
    project_root: Option<&'a str>,
    model: Option<String>,
    cwd: Option<String>,
    previous: TokenTotals,
    pub(super) quota: Option<QuotaSnapshot>,
    seen: HashSet<u64>,
    pending: Option<PendingUsage>,
}

impl<'a> FileScan<'a> {
    pub(super) fn new(project_root: Option<&'a str>) -> Self {
        Self {
            project_root,
            model: None,
            cwd: None,
            previous: TokenTotals::default(),
            quota: None,
            seen: HashSet::new(),
            pending: None,
        }
    }

    fn consume(&mut self, line: &str, accumulator: &mut UsageAccumulator, cutoff: Option<i64>) {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            return;
        };
        if let Some(record) = CodexRecord::parse(&record) {
            self.consume_record(&record, accumulator, cutoff);
        }
    }

    pub(super) fn consume_record(
        &mut self,
        record: &CodexRecord,
        accumulator: &mut UsageAccumulator,
        cutoff: Option<i64>,
    ) {
        match record {
            CodexRecord::Meta { cwd, .. } => self.update_context(cwd, &None),
            CodexRecord::Context { cwd, model } => self.update_context(cwd, model),
            CodexRecord::Usage {
                at,
                tokens,
                quota,
                fingerprint,
            } => {
                if let Some(quota) = quota {
                    self.take_quota(quota);
                }
                if self.seen.insert(*fingerprint) {
                    if let Some(tokens) = tokens {
                        self.take_usage(
                            PendingUsage {
                                tokens: *tokens,
                                model: self.model.clone(),
                                cwd: self.cwd.clone(),
                                at: *at,
                            },
                            accumulator,
                            cutoff,
                        );
                    }
                }
            }
        }
    }

    fn update_context(&mut self, cwd: &Option<String>, model: &Option<String>) {
        if cwd.is_some() {
            self.cwd.clone_from(cwd);
        }
        if model.is_some() {
            self.model.clone_from(model);
        }
    }

    /// 累计快照做差。窗口过滤只挡住"是否计入"，差值基线仍需逐条推进，
    /// 否则窗口内第一条会把窗口前的历史全算进来。
    fn take_usage(
        &mut self,
        next: PendingUsage,
        accumulator: &mut UsageAccumulator,
        cutoff: Option<i64>,
    ) {
        if let Some(pending) = self
            .pending
            .as_mut()
            .filter(|pending| pending.coalesces(&next))
        {
            if pending.tokens != next.tokens {
                *pending = next;
            }
            return;
        }
        self.flush(accumulator, cutoff);
        self.pending = Some(next);
    }

    pub(super) fn flush(&mut self, accumulator: &mut UsageAccumulator, cutoff: Option<i64>) {
        let Some(item) = self.pending.take() else {
            return;
        };
        let delta = match incremental_usage(&mut self.previous, item.tokens) {
            Ok(delta) => delta,
            Err(note) => {
                if matches_project(item.cwd.as_deref(), self.project_root) {
                    accumulator.fail_analytics(note, item.at);
                }
                return;
            }
        };

        if let (Some(cutoff), Some(at)) = (cutoff, item.at) {
            if at < cutoff {
                return;
            }
        }
        if !matches_project(item.cwd.as_deref(), self.project_root) {
            return;
        }
        let Some(model) = item.model.as_deref() else {
            return;
        };
        accumulator.record(AgentKind::Codex, model, delta, item.at, item.cwd.as_deref());
    }

    fn take_quota(&mut self, snapshot: &QuotaSnapshot) {
        if self
            .quota
            .as_ref()
            .is_none_or(|current| snapshot.observed_at >= current.observed_at)
        {
            self.quota = Some(snapshot.clone());
        }
    }
}

/// Codex 的 `input_tokens` **含**缓存读，必须剥离后才能和 Claude 对比。
#[cfg(test)]
fn read_cumulative(usage: &Value) -> TokenTotals {
    normalize(read_raw_cumulative(usage))
}

fn read_raw_cumulative(usage: &Value) -> TokenTotals {
    let input = number(usage, "input_tokens");
    let cached = number(usage, "cached_input_tokens");
    TokenTotals {
        input,
        cached_input: cached,
        cache_write: number(usage, "cache_write_input_tokens"),
        // reasoning_output_tokens 是 output 的子集，单独加会重复计。
        output: number(usage, "output_tokens"),
    }
}

fn normalize(tokens: TokenTotals) -> TokenTotals {
    TokenTotals {
        input: tokens.input.saturating_sub(tokens.cached_input),
        ..tokens
    }
}

fn incremental_usage(
    previous: &mut TokenTotals,
    current: TokenTotals,
) -> Result<TokenTotals, &'static str> {
    let cache_only_reset = current.input >= previous.input
        && current.output >= previous.output
        && (current.cached_input < previous.cached_input
            || current.cache_write < previous.cache_write);
    let delta = diff(*previous, current);
    *previous = current;
    if cache_only_reset || delta.cached_input > delta.input {
        return Err("Codex 日志包含缓存回溯修正，无法可靠地按日期和模型分配费用");
    }
    Ok(normalize(delta))
}

fn fingerprint(record: &Value) -> u64 {
    let mut hasher = DefaultHasher::new();
    record.to_string().hash(&mut hasher);
    hasher.finish()
}

/// 相邻累计值之差。任一字段下降说明会话被重置，此时整条当增量，
/// 用 saturating_sub 保证不出现回绕的巨值。
fn diff(previous: TokenTotals, current: TokenTotals) -> TokenTotals {
    let reset = current.input < previous.input
        || current.cached_input < previous.cached_input
        || current.cache_write < previous.cache_write
        || current.output < previous.output;
    if reset {
        return current;
    }
    TokenTotals {
        input: current.input - previous.input,
        cached_input: current.cached_input - previous.cached_input,
        cache_write: current.cache_write - previous.cache_write,
        output: current.output - previous.output,
    }
}

fn read_window(value: &Value) -> Option<QuotaWindow> {
    let used_percent = value["used_percent"].as_f64()?;
    Some(QuotaWindow {
        used_percent,
        window_minutes: value["window_minutes"].as_u64(),
        resets_at: value["resets_at"].as_i64(),
    })
}

fn number(value: &Value, key: &str) -> u64 {
    value[key].as_u64().unwrap_or(0)
}

#[cfg(test)]
#[path = "analytics/codex_tests.rs"]
mod analytics_tests;

#[cfg(test)]
#[path = "codex_unit_tests.rs"]
mod tests;
