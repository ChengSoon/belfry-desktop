//! 编排两侧扫描并组装报告。

use crate::agent::AgentKind;

use super::aggregate::UsageAccumulator;
use super::contracts::{AgentQuota, UsageQuery, UsageReport};
use super::timestamp::now_epoch_seconds;
use super::{claude, codex, roots};

const SECONDS_PER_DAY: i64 = 86_400;

/// 采集用量报告。
///
/// 读不到日志目录不算错误：用户可能只装了一个 Agent，或还没跑过会话，
/// 此时返回空报告让界面显示"暂无数据"，而不是弹错误。
pub fn collect(query: &UsageQuery) -> UsageReport {
    let generated_at = now_epoch_seconds();
    let cutoff = window_cutoff(query.window_days, generated_at);
    let project_root = query
        .project_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut accumulator = UsageAccumulator::default();
    let claude_tally = claude::scan(&mut accumulator, cutoff, project_root);
    let codex_scan = codex::scan(&mut accumulator, cutoff, project_root);

    let quotas = codex_scan
        .quota
        .map(|snapshot| {
            vec![AgentQuota {
                agent: AgentKind::Codex,
                plan_type: snapshot.plan_type,
                primary: snapshot.primary,
                secondary: snapshot.secondary,
                observed_at: snapshot.observed_at,
            }]
        })
        .unwrap_or_default();

    UsageReport {
        models: accumulator.models(),
        totals: accumulator.totals(),
        quotas,
        projects: roots::roll_up(accumulator.projects()),
        scanned_files: claude_tally.scanned + codex_scan.tally.scanned,
        skipped_files: claude_tally.skipped + codex_scan.tally.skipped,
        window_days: query.window_days,
        generated_at,
    }
}

/// 窗口起点。0 天与 None 一样表示不限时间，避免前端传 0 时返回空报告。
fn window_cutoff(window_days: Option<u32>, now: i64) -> Option<i64> {
    window_days
        .filter(|days| *days > 0)
        .map(|days| now - i64::from(days) * SECONDS_PER_DAY)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_cutoff_covers_the_requested_days() {
        let now = 1_786_287_401;
        assert_eq!(window_cutoff(Some(30), now), Some(now - 30 * SECONDS_PER_DAY));
        assert_eq!(window_cutoff(Some(1), now), Some(now - SECONDS_PER_DAY));
    }

    #[test]
    fn zero_or_missing_window_means_all_time() {
        assert_eq!(window_cutoff(None, 100), None);
        assert_eq!(window_cutoff(Some(0), 100), None);
    }

    #[test]
    fn collect_is_infallible_and_self_consistent() {
        // 跑在真实 HOME 上：不同机器数据不同，只断言结构自洽。
        let report = collect(&UsageQuery {
            window_days: Some(30),
            project_root: None,
        });

        let summed: u64 = report.models.iter().map(|m| m.tokens.total()).sum();
        assert_eq!(summed, report.totals.total(), "分项之和必须等于合计");
        assert!(report.generated_at > 0);
        assert_eq!(report.window_days, Some(30));

        // 模型列表按总量降序
        let totals: Vec<u64> = report.models.iter().map(|m| m.tokens.total()).collect();
        let mut sorted = totals.clone();
        sorted.sort_unstable_by(|a, b| b.cmp(a));
        assert_eq!(totals, sorted);

        // 每条都必须有模型名，且不含合成占位
        assert!(report.models.iter().all(|m| !m.model.is_empty()));
        assert!(report.models.iter().all(|m| m.model != "<synthetic>"));
    }

    #[test]
    fn filtering_by_project_never_exceeds_the_global_total() {
        let all = collect(&UsageQuery {
            window_days: None,
            project_root: None,
        });
        let scoped = collect(&UsageQuery {
            window_days: None,
            project_root: Some("/__otty_missing_project__".to_string()),
        });
        // 不存在的项目必然无用量，且全局总量是上界
        assert_eq!(scoped.totals.total(), 0);
        assert!(scoped.totals.total() <= all.totals.total());
    }

    /// 临时交叉校验用：`cargo test dump_real_report -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn dump_real_report() {
        let report = collect(&UsageQuery {
            window_days: None,
            project_root: None,
        });
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
    }

    #[test]
    fn narrowing_the_window_cannot_grow_usage() {
        let wide = collect(&UsageQuery {
            window_days: None,
            project_root: None,
        });
        let narrow = collect(&UsageQuery {
            window_days: Some(1),
            project_root: None,
        });
        assert!(narrow.totals.total() <= wide.totals.total());
    }
}
