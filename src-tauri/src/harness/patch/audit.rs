use super::{ApplyRequest, AuditSink, PatchAudit, PatchPreview, PatchResult, ProposeRequest};

pub(super) fn proposed(
    sink: &AuditSink,
    request: &ProposeRequest,
    result: &PatchResult<PatchPreview>,
    duration: u64,
) {
    if let Ok(value) = result {
        sink(event(
            request,
            "patch.proposed",
            Some(value.preview_id.clone()),
            duration,
            format!("{} lines, {} bytes", value.new_lines, value.final_bytes),
            None,
        ));
    }
    let (phase, preview, code) = match result {
        Ok(value) => ("approval.required", Some(value.preview_id.clone()), None),
        Err(error) => ("tool.failed", None, Some(error.code)),
    };
    sink(event(
        request,
        phase,
        preview,
        duration,
        "patch proposal processed".into(),
        code,
    ));
}

pub(super) fn apply_started(sink: &AuditSink, request: &ApplyRequest) {
    sink(PatchAudit {
        phase: "tool.started",
        session_id: request.session_id.clone(),
        request_id: request.request_id.clone(),
        tool_id: request.tool_id.clone(),
        preview_id: Some(request.preview_id.clone()),
        duration_ms: 0,
        summary: "patch apply started".into(),
        error_code: None,
    });
}

pub(super) fn applied(
    sink: &AuditSink,
    request: &ApplyRequest,
    result: &PatchResult<()>,
    duration: u64,
) {
    let (phase, code) = match result {
        Ok(()) => ("tool.completed", None),
        Err(error) => ("tool.failed", Some(error.code)),
    };
    sink(PatchAudit {
        phase,
        session_id: request.session_id.clone(),
        request_id: request.request_id.clone(),
        tool_id: request.tool_id.clone(),
        preview_id: Some(request.preview_id.clone()),
        duration_ms: duration,
        summary: "patch apply processed".into(),
        error_code: code,
    });
}

fn event(
    request: &ProposeRequest,
    phase: &'static str,
    preview_id: Option<String>,
    duration_ms: u64,
    summary: String,
    error_code: Option<&'static str>,
) -> PatchAudit {
    PatchAudit {
        phase,
        session_id: request.session_id.clone(),
        request_id: request.request_id.clone(),
        tool_id: request.tool_id.clone(),
        preview_id,
        duration_ms,
        summary,
        error_code,
    }
}
