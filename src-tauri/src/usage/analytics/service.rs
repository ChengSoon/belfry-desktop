use super::aggregate::AnalyticsAccumulator;
use super::contracts::AnalyticsReport;
use super::range::UsagePeriod;
use crate::agent::AgentKind;
use crate::usage::aggregate::UsageAccumulator;
use crate::usage::contracts::{AgentQuota, UsageQuery};
use crate::usage::timestamp::now_epoch_seconds;
use crate::usage::{claude, codex};

pub fn collect(query: &UsageQuery) -> Result<AnalyticsReport, String> {
    let generated_at = now_epoch_seconds();
    let period = UsagePeriod::new(query, generated_at)?;
    let project_root = query
        .project_root
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());
    let mut accumulator = UsageAccumulator::with_analytics(AnalyticsAccumulator::new(period));
    // 不提前用日期过滤；累计差值的基线、无日期记录和账号额度都需要完整日志。
    let claude_tally = claude::scan(&mut accumulator, None, project_root);
    let codex_scan = codex::scan(&mut accumulator, None, project_root);
    let buckets = accumulator.finish_analytics()?;
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
    Ok(AnalyticsReport {
        rows: buckets.rows,
        undated_records: buckets.undated_records,
        quotas,
        scanned_files: claude_tally.scanned + codex_scan.tally.scanned,
        skipped_files: claude_tally.skipped + codex_scan.tally.skipped,
        window_days: query.window_days.filter(|days| *days > 0),
        project_root: project_root.map(ToOwned::to_owned),
        start_at: period.start,
        end_at: period.end,
        generated_at,
    })
}
