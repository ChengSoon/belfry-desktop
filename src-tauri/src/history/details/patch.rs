use super::contracts::HistoryChange;

pub(super) fn changes(patch: &str) -> Vec<HistoryChange> {
    if !patch.trim_start().starts_with("*** Begin Patch\n")
        && !patch.trim_start().starts_with("*** Begin Patch\r\n")
    {
        return Vec::new();
    }
    let mut result = Vec::new();
    let mut current: Option<HistoryChange> = None;
    for raw in patch.lines() {
        if let Some(change) = header(raw) {
            if let Some(previous) = current.take() {
                result.push(previous);
            }
            if result.len() > super::text::MAX_CHANGES {
                break;
            }
            current = Some(change);
        } else if raw == "*** End Patch" {
            break;
        } else if let Some(change) = &mut current {
            if let Some(target) = raw.strip_prefix("*** Move to: ") {
                change.original_path = Some(std::mem::replace(&mut change.path, target.into()));
                change.kind = "rename".into();
            }
            if let Some(text) = &mut change.patch {
                text.push_str(raw);
                text.push('\n');
            }
        }
    }
    if let Some(change) = current {
        result.push(change);
    }
    result
}

fn header(line: &str) -> Option<HistoryChange> {
    let (kind, path) = [
        ("modify", "*** Update File: "),
        ("add", "*** Add File: "),
        ("delete", "*** Delete File: "),
    ]
    .into_iter()
    .find_map(|(kind, prefix)| line.strip_prefix(prefix).map(|path| (kind, path)))?;
    if path.is_empty() {
        return None;
    }
    Some(HistoryChange {
        path: path.into(),
        kind: kind.into(),
        patch: Some(format!("{line}\n")),
        note: if kind == "delete" {
            "删除请求；日志没有保留原文件全文"
        } else {
            "日志中的 patch 请求"
        }
        .into(),
        ..Default::default()
    })
}
