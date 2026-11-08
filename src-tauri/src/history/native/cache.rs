use super::{Check, Source, cache_file, normalize, storage};
use crate::{agent::AgentKind, terminal::AppError};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader, Read},
    path::Path,
    time::UNIX_EPOCH,
};

pub(super) fn header(path: &Path) -> Option<Value> {
    let mut line = String::new();
    BufReader::new(fs::File::open(path).ok()?.take(64 * 1024))
        .read_line(&mut line)
        .ok()?;
    serde_json::from_str(&line).ok()
}

fn fingerprint(source: &Source) -> String {
    let mut stamp = json!([source.meta, source.extra]).to_string();
    for path in &source.files {
        stamp.push_str(&path.to_string_lossy());
        if let Ok(meta) = path.metadata() {
            stamp.push_str(&format!(
                ":{}:{:?}",
                meta.len(),
                meta.modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            ));
        }
    }
    storage::hash(stamp.as_bytes())
}

pub(super) fn refresh(
    kind: AgentKind,
    data: &Path,
    root: &Path,
    sources: &[Source],
    id: Option<&str>,
    check: Check<'_>,
) -> Result<(), AppError> {
    fs::create_dir_all(root).map_err(storage::error)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700)).map_err(storage::error)?;
    }
    let mut alive = HashSet::new();
    for source in sources {
        check()?;
        let path = cache_file(root, &source.meta.id);
        alive.insert(path.clone());
        let stamp = fingerprint(source);
        if header(&path).is_some_and(|v| v["belfryFingerprint"] == stamp) {
            continue;
        }
        let records = normalize(kind, data, source, check)?;
        if fingerprint(source) != stamp {
            return Err(AppError::io("原生会话在读取期间发生变化，请刷新后重试"));
        }
        let mut text = json!({"type":"session_meta", "payload":{"id":source.meta.id},
            "belfrySession":source.meta, "belfryFingerprint":stamp})
        .to_string()
            + "\n";
        for record in records {
            check()?;
            text.push_str(&record.to_string());
            text.push('\n');
            if text.len() > 64 * 1024 * 1024 {
                return Err(AppError::io("原生会话内容超过 64 MiB，请在 CLI 中查看"));
            }
        }
        crate::atomic::write_atomic(&path, &text, true)?;
    }
    // Prune only Belfry snapshots after successful native discovery, never native files.
    if id.is_none() {
        for entry in fs::read_dir(root).map_err(storage::error)? {
            check()?;
            let entry = entry.map_err(storage::error)?;
            if entry.file_type().map_err(storage::error)?.is_file()
                && entry.path().extension().is_some_and(|x| x == "jsonl")
                && !alive.contains(&entry.path())
            {
                fs::remove_file(entry.path()).map_err(storage::error)?;
            }
        }
    } else if sources.is_empty() {
        let _ = fs::remove_file(cache_file(root, id.unwrap()));
    }
    Ok(())
}
