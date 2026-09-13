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
#[path = "codex_pending.rs"]
mod pending;
use pending::PendingUsage;

/// 单个会话文件的扫描状态。
struct FileScan<'a> {
    project_root: Option<&'a str>,
    model: Option<String>,
    cwd: Option<String>,
    previous: TokenTotals,
    quota: Option<QuotaSnapshot>,
    seen: HashSet<u64>,
    pending: Option<PendingUsage>,
}

impl<'a> FileScan<'a> {
    fn new(project_root: Option<&'a str>) -> Self {
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
        let payload = &record["payload"];
        let at = record["timestamp"].as_str().and_then(parse_rfc3339);

        match record["type"].as_str() {
            Some("session_meta") => {
                self.take_cwd(payload);
            }
            Some("turn_context") => {
                self.take_cwd(payload);
                if let Some(model) = payload["model"].as_str().filter(|v| !v.is_empty()) {
                    self.model = Some(model.to_string());
                }
            }
            _ if payload["type"].as_str() == Some("token_count") => {
                self.take_quota(payload, at);
                if self.seen.insert(fingerprint(&record)) {
                    self.take_usage(payload, accumulator, cutoff, at);
                }
            }
            _ => {}
        }
    }

    fn take_cwd(&mut self, payload: &Value) {
        if let Some(cwd) = payload["cwd"].as_str().filter(|v| !v.is_empty()) {
            self.cwd = Some(cwd.to_string());
        }
    }

    /// 累计快照做差。窗口过滤只挡住"是否计入"，差值基线仍需逐条推进，
    /// 否则窗口内第一条会把窗口前的历史全算进来。
    fn take_usage(
        &mut self,
        payload: &Value,
        accumulator: &mut UsageAccumulator,
        cutoff: Option<i64>,
        at: Option<i64>,
    ) {
        let usage = &payload["info"]["total_token_usage"];
        if !usage.is_object() {
            return;
        }
        let next = PendingUsage {
            tokens: read_raw_cumulative(usage),
            model: self.model.clone(),
            cwd: self.cwd.clone(),
            at,
        };
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

    fn flush(&mut self, accumulator: &mut UsageAccumulator, cutoff: Option<i64>) {
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

    fn take_quota(&mut self, payload: &Value, at: Option<i64>) {
        let limits = &payload["rate_limits"];
        if !limits.is_object() {
            return;
        }
        let primary = read_window(&limits["primary"]);
        let secondary = read_window(&limits["secondary"]);
        // 字段常为 null，全空的快照没有展示价值，不覆盖已有的有效快照。
        if primary.is_none() && secondary.is_none() {
            return;
        }
        let snapshot = QuotaSnapshot {
            plan_type: limits["plan_type"].as_str().map(ToOwned::to_owned),
            primary,
            secondary,
            observed_at: at,
        };
        if self
            .quota
            .as_ref()
            .is_none_or(|current| snapshot.observed_at >= current.observed_at)
        {
            self.quota = Some(snapshot);
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
mod tests {
    use super::*;

    fn usage(input: u64, cached: u64, output: u64) -> Value {
        serde_json::json!({
            "input_tokens": input,
            "cached_input_tokens": cached,
            "cache_write_input_tokens": 0,
            "output_tokens": output,
            "reasoning_output_tokens": output / 2,
            "total_tokens": input + output
        })
    }

    #[test]
    fn strips_cached_tokens_out_of_codex_input_to_match_shared_shape() {
        // 真实样本：input 含 cached，total_tokens = input + output
        let tokens = read_cumulative(&usage(117906, 90112, 1000));
        assert_eq!(tokens.input, 27794);
        assert_eq!(tokens.cached_input, 90112);
        assert_eq!(tokens.output, 1000);
        // 归一后总量必须等于日志自报的 total_tokens
        assert_eq!(tokens.total(), 118906);
    }

    #[test]
    fn reasoning_tokens_are_not_double_counted() {
        let tokens = read_cumulative(&usage(100, 0, 40));
        assert_eq!(tokens.output, 40);
        assert_eq!(tokens.total(), 140);
    }

    #[test]
    fn consecutive_snapshots_yield_only_the_increment() {
        let first = read_cumulative(&usage(1000, 400, 100));
        let second = read_cumulative(&usage(2500, 900, 250));
        let delta = diff(first, second);
        // 剥离缓存后 600 → 1600
        assert_eq!(delta.input, 1000);
        assert_eq!(delta.cached_input, 500);
        assert_eq!(delta.output, 150);
        // 增量之和与两次 total_tokens 之差一致
        assert_eq!(delta.total(), second.total() - first.total());
    }

    #[test]
    fn treats_a_dropping_total_as_a_session_reset() {
        let before = read_cumulative(&usage(9000, 5000, 800));
        let after = read_cumulative(&usage(1200, 600, 90));
        // compact 后累计归零重算，整条当增量而不是负数回绕
        assert_eq!(diff(before, after), after);
    }

    #[test]
    fn first_snapshot_counts_in_full() {
        let first = read_cumulative(&usage(500, 100, 50));
        assert_eq!(diff(TokenTotals::default(), first), first);
    }

    #[test]
    fn reads_quota_window_and_tolerates_null_fields() {
        let limits = serde_json::json!({
            "used_percent": 63.0, "window_minutes": 10080, "resets_at": 1786880097
        });
        let window = read_window(&limits).unwrap();
        assert_eq!(window.used_percent, 63.0);
        assert_eq!(window.window_minutes, Some(10080));
        assert_eq!(window.resets_at, Some(1786880097));

        // secondary 实测恒为 null
        assert!(read_window(&Value::Null).is_none());
        // 只有 used_percent 时其余字段可缺
        let partial = read_window(&serde_json::json!({ "used_percent": 5.5 })).unwrap();
        assert_eq!(partial.window_minutes, None);
    }

    #[test]
    fn attributes_increments_to_the_model_active_at_that_time() {
        let mut accumulator = UsageAccumulator::default();
        let mut scan = FileScan::new(None);
        let lines = [
            r#"{"timestamp":"2026-08-09T10:00:00Z","type":"turn_context","payload":{"model":"gpt-5.6-sol","cwd":"/work/belfry"}}"#,
            r#"{"timestamp":"2026-08-09T10:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":0,"output_tokens":100}}}}"#,
            // 中途换模型：后续增量必须记给新模型
            r#"{"timestamp":"2026-08-09T10:02:00Z","type":"turn_context","payload":{"model":"gpt-5.6-mini","cwd":"/work/belfry"}}"#,
            r#"{"timestamp":"2026-08-09T10:03:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1500,"cached_input_tokens":0,"output_tokens":160}}}}"#,
        ];
        for line in lines {
            scan.consume(line, &mut accumulator, None);
        }

        scan.flush(&mut accumulator, None);
        let models = accumulator.models();
        assert_eq!(models.len(), 2);
        let sol = models.iter().find(|m| m.model == "gpt-5.6-sol").unwrap();
        let mini = models.iter().find(|m| m.model == "gpt-5.6-mini").unwrap();
        assert_eq!(sol.tokens.output, 100);
        // 只记增量 60，不是累计 160
        assert_eq!(mini.tokens.output, 60);
        assert_eq!(mini.tokens.input, 500);
    }

    #[test]
    fn skips_usage_recorded_before_any_turn_context() {
        let mut accumulator = UsageAccumulator::default();
        let mut scan = FileScan::new(None);
        scan.consume(
            r#"{"timestamp":"2026-08-09T10:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":5}}}}"#,
            &mut accumulator,
            None,
        );
        scan.flush(&mut accumulator, None);
        assert!(accumulator.models().is_empty());
    }

    #[test]
    fn window_filter_keeps_the_delta_baseline_moving() {
        let mut accumulator = UsageAccumulator::default();
        let mut scan = FileScan::new(None);
        let cutoff = parse_rfc3339("2026-08-09T10:02:00Z");
        let lines = [
            r#"{"timestamp":"2026-08-09T10:00:00Z","type":"turn_context","payload":{"model":"m","cwd":"/work/belfry"}}"#,
            // 窗口外：不计入，但必须推进基线
            r#"{"timestamp":"2026-08-09T10:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":8000,"cached_input_tokens":0,"output_tokens":900}}}}"#,
            r#"{"timestamp":"2026-08-09T10:03:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":8100,"cached_input_tokens":0,"output_tokens":950}}}}"#,
        ];
        for line in lines {
            scan.consume(line, &mut accumulator, cutoff);
        }

        scan.flush(&mut accumulator, cutoff);
        let models = accumulator.models();
        assert_eq!(models.len(), 1);
        // 只算窗口内的 50/100，不把窗口前的 900/8000 带进来
        assert_eq!(models[0].tokens.output, 50);
        assert_eq!(models[0].tokens.input, 100);
    }

    #[test]
    fn project_filter_excludes_sessions_from_other_directories() {
        let mut accumulator = UsageAccumulator::default();
        let mut scan = FileScan::new(Some("/work/other"));
        let lines = [
            r#"{"timestamp":"2026-08-09T10:00:00Z","type":"turn_context","payload":{"model":"m","cwd":"/work/belfry"}}"#,
            r#"{"timestamp":"2026-08-09T10:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":5}}}}"#,
        ];
        for line in lines {
            scan.consume(line, &mut accumulator, None);
        }
        scan.flush(&mut accumulator, None);
        assert!(accumulator.models().is_empty());
    }
}
