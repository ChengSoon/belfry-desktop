use super::{
    cache::FileRequest,
    contracts::ScanDiagnostics,
    reader::{ParsedLog, ReadContext, ReadError, ReadTarget},
    replay::Replay,
    stamp::{Guards, Stamp},
};
use crate::agent::AgentKind;
use std::fs::File;

/// 索引和流式回退共用同一文件句柄、EOF 与边界，回退不会混入稍后的追加。
pub(super) struct Snapshot {
    pub file: File,
    pub stamp: Stamp,
    pub guards: Guards,
}

impl Snapshot {
    pub fn capture(
        source: (File, Stamp),
        metrics: &mut ScanDiagnostics,
    ) -> Result<Self, ReadError> {
        let (mut file, stamp) = source;
        let guards = Guards::read(&mut file, stamp.len, metrics)?;
        Ok(Self {
            file,
            stamp,
            guards,
        })
    }

    pub fn validate(
        &mut self,
        request: FileRequest<'_>,
        metrics: &mut ScanDiagnostics,
    ) -> Result<(), ReadError> {
        (request.check)().map_err(ReadError::Stopped)?;
        let current = Stamp::read(&self.file)?;
        if !current.preserves_snapshot(&self.stamp)
            || (current != self.stamp && !self.guards.matches(&mut self.file, metrics)?)
            || !Stamp::open(request.path)?.1.preserves_snapshot(&self.stamp)
        {
            return Err(ReadError::Io);
        }
        Ok(())
    }

    pub fn replay(
        mut self,
        request: FileRequest<'_>,
        replay: &mut Replay<'_>,
        metrics: &mut ScanDiagnostics,
    ) -> Result<u64, String> {
        let result = self.stream(request, replay, metrics);
        // 流式记录已进入查询状态，失败必须放弃整次查询，不能跳过后返回半个文件。
        result.map_err(|error| match error {
            ReadError::Stopped(error) => error,
            _ => "用量日志在流式扫描期间发生变化或读取失败，请重试".into(),
        })
    }

    fn stream(
        &mut self,
        request: FileRequest<'_>,
        replay: &mut Replay<'_>,
        metrics: &mut ScanDiagnostics,
    ) -> Result<u64, ReadError> {
        let session = self.session(request, metrics)?;
        let identity = Replay::identity(request.path, session.as_deref());
        let mut consume = |record: &_| replay.record(&identity, record);
        let mut log = ParsedLog::default();
        log.read(
            &mut self.file,
            self.stamp.len,
            &mut ReadContext {
                agent: request.agent,
                check: request.check,
                metrics,
                target: ReadTarget::Stream(&mut consume),
            },
        )?;
        self.validate(request, metrics)?;
        replay.end_file(&identity).map_err(ReadError::Stopped)?;
        Ok(log.skipped_lines())
    }

    fn session(
        &mut self,
        request: FileRequest<'_>,
        metrics: &mut ScanDiagnostics,
    ) -> Result<Option<String>, ReadError> {
        if request.agent != AgentKind::Codex {
            return Ok(None);
        }
        // 先确定前八行的原生身份，连 meta 之前的事件也归到正确的 resume 会话。
        let mut header = ParsedLog::default();
        header.read(
            &mut self.file,
            self.stamp.len,
            &mut ReadContext {
                agent: request.agent,
                check: request.check,
                metrics,
                target: ReadTarget::Session,
            },
        )?;
        Ok(header.session_id().map(ToOwned::to_owned))
    }
}
