use super::{
    cache::{FileCache, FileRequest, ScanFile},
    cancel::Check,
    contracts::{AnalyticsReport, ScanDiagnostics},
    range::UsagePeriod,
    replay::Replay,
    sources::SourceRoots,
};
use crate::{
    agent::AgentKind,
    usage::contracts::{AgentQuota, UsageQuery},
};
use std::path::PathBuf;

#[derive(Clone, Copy)]
pub(super) struct ScanRequest<'a> {
    pub query: &'a UsageQuery,
    pub now: i64,
    pub roots: &'a SourceRoots,
    pub check: Check<'a>,
}

struct ScanPass<'a> {
    replay: Replay<'a>,
    diagnostics: ScanDiagnostics,
    project_root: Option<&'a str>,
    scanned_files: u32,
    skipped_files: u32,
}

pub(super) fn refresh(
    cache: &mut FileCache,
    request: ScanRequest<'_>,
) -> Result<AnalyticsReport, String> {
    (request.check)()?;
    let period = UsagePeriod::new(request.query, request.now)?;
    let project_root = request
        .query
        .project_root
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());
    let files = request.roots.files(request.check)?;
    // 共享已完成记录，新增内容写入临时快照；取消/失败不会留下半份缓存。
    let mut staged = cache.clone();
    staged.retain(&files.iter().map(|(_, path)| path.clone()).collect());
    let mut scan = ScanPass {
        replay: Replay::new(period, project_root),
        project_root,
        diagnostics: ScanDiagnostics::default(),
        scanned_files: 0,
        skipped_files: 0,
    };
    scan.read(&mut staged, &files, request.check)?;
    let report = scan.report(request, period)?;
    (request.check)()?;
    *cache = staged;
    Ok(report)
}

impl ScanPass<'_> {
    fn read(
        &mut self,
        cache: &mut FileCache,
        files: &[(AgentKind, PathBuf)],
        check: Check<'_>,
    ) -> Result<(), String> {
        for (agent, path) in files {
            let request = FileRequest {
                path,
                agent: *agent,
                check,
            };
            let file = cache.read(request, &mut self.diagnostics)?;
            let Some(file) = file else {
                self.skipped_files += 1;
                continue;
            };
            self.diagnostics.skipped_lines += match file {
                ScanFile::Cached(file) => {
                    self.replay.file((path, &file), check)?;
                    file.log.skipped_lines()
                }
                ScanFile::Streaming(snapshot) => {
                    snapshot.replay(request, &mut self.replay, &mut self.diagnostics)?
                }
            };
            self.scanned_files += 1;
        }
        Ok(())
    }

    fn report(
        mut self,
        request: ScanRequest<'_>,
        period: UsagePeriod,
    ) -> Result<AnalyticsReport, String> {
        let quotas = self
            .replay
            .quota
            .take()
            .map(|quota| {
                vec![AgentQuota {
                    agent: AgentKind::Codex,
                    plan_type: quota.plan_type,
                    primary: quota.primary,
                    secondary: quota.secondary,
                    observed_at: quota.observed_at,
                }]
            })
            .unwrap_or_default();
        let buckets = self.replay.finish(request.check)?;
        Ok(AnalyticsReport {
            rows: buckets.rows,
            quotas,
            undated_records: buckets.undated_records,
            scanned_files: self.scanned_files,
            skipped_files: self.skipped_files,
            diagnostics: self.diagnostics,
            window_days: request.query.window_days.filter(|days| *days > 0),
            project_root: self.project_root.map(ToOwned::to_owned),
            start_at: period.start,
            end_at: period.end,
            generated_at: request.now,
        })
    }
}

#[cfg(test)]
pub fn collect(query: &UsageQuery) -> Result<AnalyticsReport, String> {
    super::legacy::collect_at(
        query,
        &SourceRoots::default(),
        crate::usage::timestamp::now_epoch_seconds(),
    )
}
