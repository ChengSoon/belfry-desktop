use super::{
    aggregate::AnalyticsAccumulator, contracts::AnalyticsReport, range::UsagePeriod,
    sources::SourceRoots,
};
use crate::{
    agent::AgentKind,
    usage::{
        aggregate::UsageAccumulator,
        claude, codex,
        contracts::{AgentQuota, UsageQuery},
    },
};

// 测试参考：沿用原有逐文件扫描和聚合路径，不经过增量缓存。
pub(super) fn collect_at(
    query: &UsageQuery,
    roots: &SourceRoots,
    generated_at: i64,
) -> Result<AnalyticsReport, String> {
    let period = UsagePeriod::new(query, generated_at)?;
    let project_root = query
        .project_root
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());
    let mut accumulator = UsageAccumulator::with_analytics(AnalyticsAccumulator::new(period));
    // 不提前用日期过滤；累计差值的基线、无日期记录和账号额度都需要完整日志。
    let claude_tally = roots
        .claude
        .as_deref()
        .map(|root| claude::scan_fixture(root, &mut accumulator, project_root))
        .unwrap_or_default();
    let codex_scan = roots
        .codex
        .as_deref()
        .map(|root| codex::scan_fixture(root, &mut accumulator, project_root));
    let (scanned, skipped) = codex_scan
        .as_ref()
        .map(|scan| (scan.tally.scanned, scan.tally.skipped))
        .unwrap_or_default();
    let buckets = accumulator.finish_analytics()?;
    let quotas = quotas(codex_scan);
    Ok(AnalyticsReport {
        rows: buckets.rows,
        undated_records: buckets.undated_records,
        quotas,
        scanned_files: claude_tally.scanned + scanned,
        skipped_files: claude_tally.skipped + skipped,
        window_days: query.window_days.filter(|days| *days > 0),
        project_root: project_root.map(ToOwned::to_owned),
        start_at: period.start,
        end_at: period.end,
        generated_at,
        diagnostics: Default::default(),
    })
}

fn quotas(codex_scan: Option<codex::CodexScan>) -> Vec<AgentQuota> {
    codex_scan
        .and_then(|scan| scan.quota)
        .map(|snapshot| {
            vec![AgentQuota {
                agent: AgentKind::Codex,
                plan_type: snapshot.plan_type,
                primary: snapshot.primary,
                secondary: snapshot.secondary,
                observed_at: snapshot.observed_at,
            }]
        })
        .unwrap_or_default()
}
