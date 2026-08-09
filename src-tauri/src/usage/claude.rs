//! 扫描 Claude Code 会话日志（`~/.claude/projects/**/*.jsonl`）。
//!
//! 每条 assistant 记录自带 `message.model` 和该次请求的增量 token，直接累加即可。
//! 两个坑：
//! 1. resume / 分支会把同一条消息写进多个文件，必须按 `(message.id, requestId)` 全局去重；
//! 2. 报错占位记录的 model 是 `<synthetic>` 且 token 全 0，不能当成一个真实模型展示。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::agent::AgentKind;

use super::aggregate::UsageAccumulator;
use super::contracts::TokenTotals;
use super::scan::{ScanTally, collect_jsonl_files, for_each_line, home_dir, is_stale};
use super::timestamp::parse_rfc3339;

const SYNTHETIC_MODEL: &str = "<synthetic>";

pub fn sessions_dir() -> Option<PathBuf> {
    home_dir().map(|home| home.join(".claude").join("projects"))
}

/// 累加 Claude 用量。`cutoff` 为窗口起点 epoch 秒，`project_root` 非空时只统计该目录下的会话。
pub fn scan(
    accumulator: &mut UsageAccumulator,
    cutoff: Option<i64>,
    project_root: Option<&str>,
) -> ScanTally {
    let mut tally = ScanTally::default();
    let Some(root) = sessions_dir() else {
        return tally;
    };
    // 去重集跨文件共享，覆盖 resume 把旧消息复制进新文件的情况。
    let mut seen: HashSet<(String, String)> = HashSet::new();
    for path in collect_jsonl_files(&root) {
        if is_stale(&path, cutoff) {
            tally.skipped += 1;
            continue;
        }
        if scan_file(&path, accumulator, cutoff, project_root, &mut seen) {
            tally.scanned += 1;
        } else {
            tally.skipped += 1;
        }
    }
    tally
}

fn scan_file(
    path: &Path,
    accumulator: &mut UsageAccumulator,
    cutoff: Option<i64>,
    project_root: Option<&str>,
    seen: &mut HashSet<(String, String)>,
) -> bool {
    for_each_line(path, &["\"usage\""], |line| {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let message = &record["message"];
        if message["role"].as_str() != Some("assistant") {
            return;
        }
        let usage = &message["usage"];
        if !usage.is_object() {
            return;
        }
        let model = message["model"].as_str().unwrap_or_default();
        if model.is_empty() || model == SYNTHETIC_MODEL {
            return;
        }

        let at = record["timestamp"].as_str().and_then(parse_rfc3339);
        if let (Some(cutoff), Some(at)) = (cutoff, at) {
            if at < cutoff {
                return;
            }
        }

        let cwd = record["cwd"].as_str();
        if !matches_project(cwd, project_root) {
            return;
        }

        // 缺 id 的记录退化成按内容去重不现实，用空串占位；同一 (None, None) 只会计一次，
        // 这类记录实测不存在，宁可少算也不重复算。
        let key = (
            message["id"].as_str().unwrap_or_default().to_string(),
            record["requestId"].as_str().unwrap_or_default().to_string(),
        );
        if !seen.insert(key) {
            return;
        }

        accumulator.record(AgentKind::Claude, model, read_tokens(usage), at, cwd);
    })
}

/// Claude 的 `input_tokens` 不含缓存，四个字段互不重叠，可直接映射到统一口径。
fn read_tokens(usage: &Value) -> TokenTotals {
    TokenTotals {
        input: number(usage, "input_tokens"),
        cached_input: number(usage, "cache_read_input_tokens"),
        cache_write: number(usage, "cache_creation_input_tokens"),
        output: number(usage, "output_tokens"),
    }
}

fn number(value: &Value, key: &str) -> u64 {
    value[key].as_u64().unwrap_or(0)
}

/// 会话 cwd 落在项目根目录之内即算该项目，子目录（如 src-tauri）也要计入。
pub(super) fn matches_project(cwd: Option<&str>, project_root: Option<&str>) -> bool {
    let Some(root) = project_root.map(str::trim).filter(|v| !v.is_empty()) else {
        return true;
    };
    let Some(cwd) = cwd else {
        return false;
    };
    let root = root.trim_end_matches(['/', '\\']);
    if !cwd.starts_with(root) {
        return false;
    }
    // 前缀相等之外，只接受目录边界，避免 /work/otty 命中 /work/otty-backup。
    matches!(
        cwd[root.len()..].chars().next(),
        None | Some('/') | Some('\\')
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_the_four_claude_token_fields_to_shared_shape() {
        let usage = serde_json::json!({
            "input_tokens": 5269,
            "cache_creation_input_tokens": 35472,
            "cache_read_input_tokens": 120,
            "output_tokens": 2307
        });
        let tokens = read_tokens(&usage);
        assert_eq!(tokens.input, 5269);
        assert_eq!(tokens.cache_write, 35472);
        assert_eq!(tokens.cached_input, 120);
        assert_eq!(tokens.output, 2307);
        assert_eq!(tokens.total(), 5269 + 35472 + 120 + 2307);
    }

    #[test]
    fn missing_token_fields_default_to_zero() {
        let tokens = read_tokens(&serde_json::json!({ "output_tokens": 7 }));
        assert_eq!(tokens.output, 7);
        assert_eq!(tokens.input, 0);
        assert!(!tokens.is_empty());
    }

    #[test]
    fn project_filter_accepts_subdirectories_but_not_sibling_prefixes() {
        assert!(matches_project(Some("/work/otty"), Some("/work/otty")));
        assert!(matches_project(Some("/work/otty/src-tauri"), Some("/work/otty")));
        // 尾斜杠不应改变判定
        assert!(matches_project(Some("/work/otty/src"), Some("/work/otty/")));
        assert!(!matches_project(Some("/work/otty-backup"), Some("/work/otty")));
        assert!(!matches_project(Some("/other"), Some("/work/otty")));
    }

    #[test]
    fn empty_or_missing_filter_matches_everything() {
        assert!(matches_project(Some("/anywhere"), None));
        assert!(matches_project(Some("/anywhere"), Some("  ")));
        assert!(matches_project(None, None));
        // 有过滤条件但记录没有 cwd：无法归属，排除
        assert!(!matches_project(None, Some("/work/otty")));
    }
}
