use super::{Check, Source, message, metadata, storage, text_content, timestamp};
use crate::{agent::AgentKind, terminal::AppError};
use rusqlite::{Connection, OpenFlags, params};
use serde_json::{Value, json};
use std::{fs, path::Path, time::Duration};

fn request(content: &str) -> &str {
    content
        .split_once("<USER_REQUEST>")
        .and_then(|(_, s)| s.split_once("</USER_REQUEST>"))
        .map(|(s, _)| s.trim())
        .unwrap_or(content)
}

pub(super) fn list(
    data: &Path,
    id: Option<&str>,
    check: Check<'_>,
) -> Result<Vec<Source>, AppError> {
    let path = data.join("conversation_summaries.db");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let db = storage::sqlite(&path)?;
    let mut statement = db.prepare("SELECT conversation_id,title,preview,workspace_uris,CAST(strftime('%s',last_modified_time) AS INTEGER),not_fully_idle FROM conversation_summaries WHERE (?1 IS NULL OR conversation_id=?1) AND (parent_conversation_id IS NULL OR parent_conversation_id='') LIMIT 20001").map_err(storage::error)?;
    let mut rows = statement.query(params![id]).map_err(storage::error)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(storage::error)? {
        check()?;
        let id: String = row.get(0).map_err(storage::error)?;
        crate::history::scan::validate_session_id(&id)?;
        let file = data
            .join("brain")
            .join(&id)
            .join(".system_generated/logs/transcript.jsonl");
        if !file.is_file() {
            continue;
        }
        let file = storage::confined(data, &file)?;
        let mut title: String = row
            .get::<_, Option<String>>(1)
            .map_err(storage::error)?
            .filter(|s| !s.is_empty())
            .or(row.get(2).map_err(storage::error)?)
            .unwrap_or_default();
        let workspaces: Value = row
            .get::<_, Option<String>>(3)
            .map_err(storage::error)?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null);
        let cwd = workspaces
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .find_map(|s| {
                reqwest::Url::parse(s)
                    .ok()
                    .and_then(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
            });
        let mut started = None;
        crate::history::scan::read_lines_until(&file, 64, |line| {
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                started = started.or_else(|| timestamp(&v["created_at"]));
                if title.is_empty() && v["type"] == "USER_INPUT" {
                    title = request(v["content"].as_str().unwrap_or_default()).into();
                }
            }
            started.is_some() && !title.is_empty()
        });
        let meta = metadata(
            AgentKind::Antigravity,
            id,
            title,
            cwd,
            started,
            row.get::<_, Option<i64>>(4)
                .map_err(storage::error)?
                .unwrap_or_else(|| crate::history::scan::modified_epoch(&file)),
        )?;
        out.push(Source {meta, files:vec![file,path.clone(),data.join("conversation_summaries.db-wal")], extra:json!({"busy":row.get::<_,Option<bool>>(5).map_err(storage::error)?.unwrap_or(false)})});
        if out.len() > 20_000 {
            return Err(AppError::io("Antigravity 会话数超过扫描上限"));
        }
    }
    Ok(out)
}

pub(super) fn read(source: &Source, check: Check<'_>) -> Result<Vec<Value>, AppError> {
    let mut records = Vec::new();
    let mut calls = std::collections::VecDeque::new();
    storage::lines(&source.files[0], check, |line, v| {
        let kind = v["type"].as_str().unwrap_or_default();
        let text = v["content"].as_str().unwrap_or_default();
        let index = v["step_index"].as_u64().unwrap_or(line as u64);
        let id = format!("{}:step:{index}", source.meta.id);
        if kind == "USER_INPUT" && v["source"] == "USER_EXPLICIT" {
            records.push(message(
                source,
                "user",
                &id,
                &v["created_at"],
                None,
                text_content(request(text)),
                None,
            ));
        } else if kind == "PLANNER_RESPONSE" {
            let u = v.get("input_tokens").map(|_|json!({"input_tokens":v["input_tokens"],
                "output_tokens":v["output_tokens"].as_u64().map(|o|o.saturating_add(v["thinking_tokens"].as_u64().unwrap_or(0))),
                "cache_read_input_tokens":v["cache_read_tokens"],"cache_creation_input_tokens":v["cache_write_tokens"]}));
            let model = v["model"].as_str().or_else(|| v["model_name"].as_str());
            let mut content = Vec::new();
            if !text.is_empty() {
                content.push(json!({"type":"text","text":text}));
            }
            for (offset, call) in v["tool_calls"].as_array().into_iter().flatten().enumerate() {
                let Some(name) = call["name"].as_str() else {
                    continue;
                };
                let call_id = format!("{id}:call:{offset}");
                // Native AGY transcript arguments encode each value as JSON text.
                let input: serde_json::Map<String, Value> = call["args"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            v.as_str()
                                .and_then(|s| serde_json::from_str(s).ok())
                                .unwrap_or_else(|| v.clone()),
                        )
                    })
                    .collect();
                content.push(json!({"type":"tool_use","id":call_id,"name":name,"input":input}));
                calls.push_back(call_id);
            }
            let mut record = message(
                source,
                "assistant",
                &id,
                &v["created_at"],
                Some(model.unwrap_or("unknown")),
                json!(content),
                u,
            );
            if model.is_none() {
                record["belfryNote"] =
                    json!("Antigravity 原生转录未记录模型名称或缓存写入量；未知字段保持为空");
            }
            records.push(record);
        } else if kind == "ERROR_MESSAGE" {
            records.push(message(
                source,
                "assistant",
                &id,
                &v["created_at"],
                None,
                text_content(text),
                None,
            ));
        } else if !matches!(kind, "" | "SYSTEM_MESSAGE" | "USER_INPUT" | "CHECKPOINT") {
            // Antigravity exports tool steps as typed transcript entries. Preserve
            // their native name/text; do not invent file diffs absent from the log.
            let name = v["tool_name"].as_str().unwrap_or(kind);
            let input = v
                .get("tool_input")
                .cloned()
                .unwrap_or_else(|| json!({"transcript":text}));
            let call_id = if let Some(call) = calls.pop_front() {
                call
            } else {
                records.push(message(
                    source,
                    "assistant",
                    &id,
                    &v["created_at"],
                    None,
                    json!([{"type":"tool_use","id":id,"name":name,"input":input}]),
                    None,
                ));
                id.clone()
            };
            if matches!(v["status"].as_str(), Some("DONE" | "ERROR" | "INVALID")) {
                records.push(message(source,"user",&format!("{id}:result"),&v["created_at"],None,json!([{"type":"tool_result","tool_use_id":call_id,"is_error":v["status"] != "DONE","content":text}]),None));
            }
        }
        Ok(())
    })?;
    Ok(records)
}

pub(super) fn delete(data: &Path, source: &Source) -> Result<(), AppError> {
    let path = storage::confined(data, &data.join("conversation_summaries.db"))?;
    let mut db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(storage::error)?;
    db.busy_timeout(Duration::from_secs(2))
        .map_err(storage::error)?;
    let tx = db.transaction().map_err(storage::error)?;
    let mut statement=tx.prepare("WITH RECURSIVE family(id) AS (SELECT conversation_id FROM conversation_summaries WHERE conversation_id=?1 UNION SELECT c.conversation_id FROM conversation_summaries c JOIN family f ON c.parent_conversation_id=f.id) SELECT conversation_id,not_fully_idle FROM conversation_summaries WHERE conversation_id IN family").map_err(storage::error)?;
    let ids = statement
        .query_map([&source.meta.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<bool>>(1)?.unwrap_or(false),
            ))
        })
        .map_err(storage::error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage::error)?;
    drop(statement);
    if ids.iter().any(|(_, busy)| *busy) {
        return Err(AppError::invalid_argument(
            "请先停止 Antigravity 会话，再删除历史",
        ));
    }
    let has_fts = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='conversations_fts')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(storage::error)?;
    let mut paths = Vec::new();
    for (id, _) in ids {
        crate::history::scan::validate_session_id(&id)?;
        for file in [
            data.join("brain").join(&id),
            data.join("conversations").join(format!("{id}.db")),
            data.join("conversations").join(format!("{id}.db-wal")),
            data.join("conversations").join(format!("{id}.db-shm")),
        ] {
            if file.exists() {
                paths.push(storage::confined(data, &file)?);
            }
        }
        if has_fts {
            tx.execute(
                "DELETE FROM conversations_fts WHERE conversation_id=?1",
                [&id],
            )
            .map_err(storage::error)?;
        }
        tx.execute(
            "DELETE FROM conversation_summaries WHERE conversation_id=?1",
            [&id],
        )
        .map_err(storage::error)?;
    }
    tx.commit().map_err(storage::error)?;
    for path in paths {
        if path.is_dir() {
            fs::remove_dir_all(path).map_err(storage::error)?;
        } else {
            fs::remove_file(path).map_err(storage::error)?;
        }
    }
    Ok(())
}
