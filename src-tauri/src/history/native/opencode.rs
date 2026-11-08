use super::{Check, Source, message, metadata, storage, text_content};
use crate::{agent::AgentKind, terminal::AppError};
use rusqlite::params;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

pub(super) fn database(data: &Path) -> PathBuf {
    crate::agent::paths::opencode_database(data)
}

pub(super) fn list(
    data: &Path,
    id: Option<&str>,
    check: Check<'_>,
) -> Result<Vec<Source>, AppError> {
    let path = database(data);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let db = storage::sqlite(&path)?;
    let mut statement = db.prepare("SELECT id,title,directory,time_created,time_updated,model,tokens_input,tokens_output,tokens_reasoning,tokens_cache_read,tokens_cache_write FROM session_v2 WHERE (?1 IS NULL OR id=?1) AND (parent_id IS NULL OR parent_id='') ORDER BY time_updated DESC LIMIT 20001").map_err(storage::error)?;
    let mut rows = statement.query(params![id]).map_err(storage::error)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(storage::error)? {
        check()?;
        let meta = metadata(
            AgentKind::Opencode,
            row.get(0).map_err(storage::error)?,
            row.get::<_, Option<String>>(1)
                .map_err(storage::error)?
                .unwrap_or_default(),
            row.get(2).map_err(storage::error)?,
            row.get::<_, Option<i64>>(3)
                .map_err(storage::error)?
                .map(|n| n / 1000),
            row.get::<_, i64>(4).map_err(storage::error)? / 1000,
        )?;
        let number = |index| row.get::<_, u64>(index).map_err(storage::error);
        out.push(Source {meta, files:vec![path.clone(),PathBuf::from(format!("{}-wal",path.display()))],
            extra:json!({"model":row.get::<_,Option<String>>(5).map_err(storage::error)?,"input":number(6)?,"output":number(7)?.saturating_add(number(8)?),"cache":number(9)?,"write":number(10)?})});
        if out.len() > 20_000 {
            return Err(AppError::io(belfry_i18n::text("OpenCode 会话数超过扫描上限")));
        }
    }
    Ok(out)
}

fn usage(tokens: &Value) -> Value {
    json!({"input_tokens":tokens["input"], "output_tokens":tokens["output"].as_u64().zip(tokens["reasoning"].as_u64().or(Some(0))).map(|(o,r)|o.saturating_add(r)),
        "cache_read_input_tokens":tokens["cache"]["read"],"cache_creation_input_tokens":tokens["cache"]["write"]})
}

pub(super) fn read(
    _data: &Path,
    source: &Source,
    check: Check<'_>,
) -> Result<Vec<Value>, AppError> {
    let db = storage::sqlite(&source.files[0])?;
    db.execute_batch("BEGIN").map_err(storage::error)?;
    let mut statement = db.prepare("SELECT id,type,time_created,data FROM session_message WHERE session_id=?1 ORDER BY seq LIMIT 200001").map_err(storage::error)?;
    let mut rows = statement.query([&source.meta.id]).map_err(storage::error)?;
    let mut out = Vec::new();
    let mut accounted = [0u64; 4];
    let mut bytes = 0usize;
    let mut count = 0usize;
    while let Some(row) = rows.next().map_err(storage::error)? {
        check()?;
        count += 1;
        if count > storage::MAX_RECORDS {
            return Err(AppError::io(belfry_i18n::text("OpenCode 会话超过读取上限")));
        }
        let id: String = row.get(0).map_err(storage::error)?;
        let role: String = row.get(1).map_err(storage::error)?;
        let at: i64 = row.get(2).map_err(storage::error)?;
        let raw: String = row.get(3).map_err(storage::error)?;
        bytes += raw.len();
        if bytes as u64 > storage::MAX_BYTES || out.len() > storage::MAX_RECORDS {
            return Err(AppError::io(belfry_i18n::text("OpenCode 会话超过读取上限")));
        }
        let v: Value = serde_json::from_str(&raw).map_err(storage::error)?;
        if role == "user" {
            out.push(message(
                source,
                "user",
                &id,
                &json!(at),
                None,
                text_content(v["text"].as_str().unwrap_or_default()),
                None,
            ));
        } else if role == "assistant" || role == "compaction" {
            let mut parts = v["content"].as_array().cloned().unwrap_or_default();
            if parts.is_empty() && role == "assistant" {
                let mut stream = db
                    .prepare("SELECT data FROM session_part WHERE message_id=?1 ORDER BY ordinal")
                    .map_err(storage::error)?;
                for raw in stream
                    .query_map([&id], |row| row.get::<_, String>(0))
                    .map_err(storage::error)?
                {
                    let raw = raw.map_err(storage::error)?;
                    bytes += raw.len();
                    if bytes as u64 > storage::MAX_BYTES {
                        return Err(AppError::io(belfry_i18n::text("OpenCode 会话超过读取上限")));
                    }
                    parts.push(serde_json::from_str(&raw).map_err(storage::error)?);
                }
            }
            let mut content = Vec::new();
            let mut results = Vec::new();
            for part in parts {
                match part["type"].as_str().unwrap_or_default() {
                    "text" => content.push(json!({"type":"text","text":part["text"]})),
                    "reasoning" => content.push(json!({"type":"thinking"})),
                    "tool" => {
                        content.push(json!({"type":"tool_use","id":part["id"],"name":part["name"],"input":part["state"]["input"]}));
                        if matches!(
                            part["state"]["status"].as_str(),
                            Some("completed" | "error")
                        ) {
                            let state = &part["state"];
                            results.push(json!({"type":"tool_result","tool_use_id":part["id"],"is_error":state["status"] == "error",
                                "content":state.get("content").cloned().unwrap_or_else(||text_content(&state["error"].to_string()))}));
                        }
                    }
                    _ => {}
                }
            }
            let u = v.get("tokens").filter(|t| t.is_object()).map(usage);
            if let Some(u) = &u {
                for (i, key) in [
                    "input_tokens",
                    "output_tokens",
                    "cache_read_input_tokens",
                    "cache_creation_input_tokens",
                ]
                .iter()
                .enumerate()
                {
                    accounted[i] = accounted[i].saturating_add(u[*key].as_u64().unwrap_or(0));
                }
            }
            out.push(message(
                source,
                "assistant",
                &id,
                &json!(at),
                Some(v["model"]["id"].as_str().unwrap_or("unknown")),
                json!(content),
                u,
            ));
            if !results.is_empty() {
                out.push(message(
                    source,
                    "user",
                    &format!("{id}:results"),
                    &json!(at),
                    None,
                    json!(results),
                    None,
                ));
            }
        }
    }
    // Session totals also bill title generation and compaction. The native v2
    // projection does not retain their model ID; keep those tokens in an explicit
    // unknown-model bucket instead of dropping them or assigning the current model.
    let remaining: [u64; 4] = std::array::from_fn(|i| {
        source.extra[["input", "output", "cache", "write"][i]]
            .as_u64()
            .unwrap_or(0)
            .saturating_sub(accounted[i])
    });
    if remaining.iter().any(|n| *n > 0) {
        let mut record = message(
            source,
            "assistant",
            &format!("{}:auxiliary", source.meta.id),
            &json!(source.meta.last_active_at),
            Some("unknown"),
            json!([]),
            Some(
                json!({"input_tokens":remaining[0],"output_tokens":remaining[1],"cache_read_input_tokens":remaining[2],"cache_creation_input_tokens":remaining[3]}),
            ),
        );
        record["belfryNote"] =
            json!(belfry_i18n::text("原生总量包含辅助调用；其模型和逐次时间未记录，按会话最后活跃时间归入未知模型"));
        record["belfryAuxiliary"] = json!(true);
        out.push(record);
    }
    Ok(out)
}

pub(super) fn delete(_data: &Path, source: &Source) -> Result<(), AppError> {
    // Let the CLI update projections, event storage, child sessions and attachments.
    let executable = crate::agent::resolve_agent(AgentKind::Opencode)?;
    let mut command = crate::setup::process::command_for(&executable);
    command.args(["session", "delete", "--standalone", source.meta.id.as_str()]);
    command.env("OPENCODE_DB", &source.files[0]);
    if let Some(path) = crate::agent::user_command_path() {
        command.env("PATH", path);
    }
    if let Some(cwd) = &source.meta.cwd {
        if Path::new(cwd).is_dir() {
            command.current_dir(cwd);
        }
    }
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let mut child = command.spawn().map_err(storage::error)?;
    let started = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(storage::error)? {
            return if status.success() {
                Ok(())
            } else {
                Err(AppError::io(
                    belfry_i18n::text("OpenCode 未能删除原生会话，请关闭该会话后重试"),
                ))
            };
        }
        if started.elapsed() > std::time::Duration::from_secs(30) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::io(
                belfry_i18n::text("OpenCode 删除超时，请在 CLI 中确认会话状态后刷新"),
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}
