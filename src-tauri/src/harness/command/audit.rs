use super::{AuditSink, CommandAudit, CommandResult, ExecRequest, ExecResult};

pub(super) fn result(sink: &AuditSink, request: &ExecRequest, result: &CommandResult<ExecResult>) {
    match result {
        Ok(value) => {
            output(sink, request, value);
            let (phase, error) = match value.termination_reason.as_str() {
                "cancelled" => ("cancelled", Some("CANCELLED")),
                "timeout" => ("failed", Some("TIMEOUT")),
                _ => ("completed", None),
            };
            emit(
                sink,
                request,
                phase,
                value.duration_ms,
                &value.termination_reason,
                error,
                None,
            );
        }
        Err(error) => emit(
            sink,
            request,
            "failed",
            0,
            error.message,
            None,
            Some(error.code),
        ),
    }
}

fn output(sink: &AuditSink, request: &ExecRequest, value: &ExecResult) {
    for (stream, text) in [("stdout", &value.stdout), ("stderr", &value.stderr)] {
        if !text.is_empty() {
            emit(
                sink,
                request,
                "output",
                value.duration_ms,
                text,
                Some(stream),
                None,
            );
        }
    }
}

pub(super) fn emit(
    sink: &AuditSink,
    request: &ExecRequest,
    phase: &'static str,
    duration_ms: u64,
    summary: &str,
    stream: Option<&'static str>,
    error_code: Option<&'static str>,
) {
    sink(CommandAudit {
        phase,
        session_id: request.session_id.clone(),
        request_id: request.request_id.clone(),
        tool_id: request.tool_id.clone(),
        duration_ms,
        summary: summary.chars().take(4096).collect(),
        stream,
        error_code,
    });
}
