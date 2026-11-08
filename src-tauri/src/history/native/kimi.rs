use super::{Check, Source, message, metadata, storage, text_content, timestamp};
use crate::{agent::AgentKind, terminal::AppError};
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path};

pub(super) fn list(
    data: &Path,
    id: Option<&str>,
    check: Check<'_>,
) -> Result<Vec<Source>, AppError> {
    let root = data.join("sessions");
    let mut result = Vec::new();
    for workspace in storage::children(&root, check)? {
        for directory in storage::children(&workspace, check)? {
            if id.is_some_and(|id| directory.file_name().and_then(|s| s.to_str()) != Some(id)) {
                continue;
            }
            let state = [
                directory.join("state.json"),
                directory.join("session-meta/state.json"),
            ]
            .into_iter()
            .find(|p| p.is_file());
            let Some(state) = state else {
                continue;
            };
            let state = storage::confined(&root, &state)?;
            let value = storage::json(&state)?;
            let Some(session_id) = value["id"]
                .as_str()
                .or_else(|| directory.file_name().and_then(|s| s.to_str()))
            else {
                continue;
            };
            if directory.file_name().and_then(|s| s.to_str()) != Some(session_id)
                || value["custom"]["child_session_kind"] == "child"
            {
                continue;
            }
            if id.is_some_and(|id| id != session_id) {
                continue;
            }
            let wire = directory.join("agents/main/wire.jsonl");
            if !wire.is_file() {
                continue;
            }
            let wire = storage::confined(&root, &wire)?;
            let cwd = value["cwd"]
                .as_str()
                .or_else(|| value["workDir"].as_str())
                .or_else(|| value["custom"]["cwd"].as_str())
                .map(str::to_owned);
            let mut title = value["title"].as_str().unwrap_or_default().to_string();
            if title.is_empty() {
                crate::history::scan::read_lines_until(&wire, 100, |line| {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        if v["type"] == "context.append_message" && is_user(&v["message"]) {
                            title = content_text(&v["message"]["content"]);
                        }
                    }
                    !title.is_empty()
                });
            }
            let meta = metadata(
                AgentKind::Kimi,
                session_id.into(),
                title,
                cwd,
                timestamp(&value["createdAt"]),
                timestamp(&value["updatedAt"])
                    .unwrap_or_else(|| crate::history::scan::modified_epoch(&wire)),
            )?;
            result.push(Source {
                meta,
                files: vec![state, wire],
                extra: Value::Null,
            });
            if result.len() > 20_000 {
                return Err(AppError::io("Kimi 会话数超过扫描上限"));
            }
        }
    }
    Ok(result)
}

fn is_user(message: &Value) -> bool {
    if message["role"] != "user" {
        return false;
    }
    let origin = &message["origin"];
    match origin["kind"].as_str().or_else(|| origin.as_str()) {
        Some("injection" | "system_trigger" | "retry" | "compaction_summary" | "hook_result") => {
            false
        }
        Some("skill_activation" | "plugin_command") => origin["trigger"] == "user-slash",
        _ => true,
    }
}

fn content_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.into();
    }
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["type"] == "text")
        .filter_map(|p| p["text"].as_str())
        .collect::<Vec<_>>()
        .join("")
}

pub(super) fn read(source: &Source, check: Check<'_>) -> Result<Vec<Value>, AppError> {
    let mut visible = Vec::new();
    let mut spent = Vec::new();
    let mut turns = Vec::new();
    let mut step_messages = HashMap::<String, usize>::new();
    let mut model = String::new();
    let mut branch = String::from("main");
    // Persistent branch heads share earlier records instead of cloning entire
    // transcripts on every undo/fork. Retained memory is linear in the wire size.
    let mut branches: HashMap<String, Option<usize>> = HashMap::new();
    let mut nodes = Vec::<(usize, Value, Option<usize>)>::new();
    let mut active: Option<usize> = None;
    let mut paired_undo = None;
    // Wire v1.5 records an explicit branch edge before its legacy context.undo.
    // Restore the active branch; keep billed usage from all branches exactly once.
    storage::lines(&source.files[1], check, |line, v| {
        if v["type"] == "usage.record" {
            let usage = &v["usage"];
            // Each usage.record is an increment, even if two calls report the
            // same tokens at the same millisecond. step.end is only a summary.
            let id = format!("{}:{line}", source.meta.id);
            spent.push(message(source, "assistant", &format!("usage:{id}"), &v["time"], v["model"].as_str().or(Some("unknown")), json!([]),
                Some(json!({"input_tokens":usage["inputOther"],"output_tokens":usage["output"],
                    "cache_read_input_tokens":usage["inputCacheRead"],"cache_creation_input_tokens":usage["inputCacheCreation"]}))));
        }
        if v["type"] == "agent.switched" {
            branches.insert(branch.clone(), active);
            let base_branch = v["base"]["branch"].as_str().unwrap_or("main");
            let base_line = v["base"]["line"].as_u64().unwrap_or(0) as usize;
            active = branches.get(base_branch).copied().flatten();
            while let Some(index) = active {
                check()?;
                if nodes[index].0 <= base_line {
                    break;
                }
                active = nodes[index].2;
            }
            branch = v["branch"].as_str().unwrap_or("main").into();
            paired_undo = v["legacyUndoLine"].as_u64().map(|v| v as usize);
        } else if paired_undo != Some(line) {
            nodes.push((line, v, active));
            active = Some(nodes.len() - 1);
        }
        Ok(())
    })?;
    let mut selected = Vec::new();
    while let Some(index) = active {
        check()?;
        selected.push(index);
        active = nodes[index].2;
    }
    for index in selected.into_iter().rev() {
        let (line, v, _) = &nodes[index];
        check()?;
        if v["agentId"].as_str().is_some_and(|id| id != "main") {
            continue;
        }
        match v["type"].as_str().unwrap_or_default() {
            "usage.record" => model = v["model"].as_str().unwrap_or("unknown").into(),
            "context.clear" => {
                visible.clear();
                turns.clear();
                step_messages.clear();
            }
            "context.undo" => {
                let count = v["count"].as_u64().unwrap_or(0) as usize;
                if count > 0 && count <= turns.len() {
                    let cut = turns.len() - count;
                    visible.truncate(turns[cut]);
                    turns.truncate(cut);
                    step_messages.clear();
                }
            }
            "context.append_message" if is_user(&v["message"]) => {
                turns.push(visible.len());
                let text = content_text(&v["message"]["content"]);
                let id = v["message"]["id"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("{}:line:{line}", source.meta.id));
                visible.push(message(
                    source,
                    "user",
                    &id,
                    &v["time"],
                    None,
                    text_content(&text),
                    None,
                ));
            }
            "context.append_loop_event" => {
                let e = &v["event"];
                let step = e["stepUuid"].as_str().unwrap_or_default();
                let id = e["uuid"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("{}:{line}", source.meta.id));
                match e["type"].as_str().unwrap_or_default() {
                    "content.part" if e["part"]["type"] == "text" => {
                        let text = e["part"]["text"].as_str().unwrap_or_default();
                        if let Some(index) = step_messages
                            .get(step)
                            .copied()
                            .filter(|_| !step.is_empty())
                        {
                            let previous = visible[index]["message"]["content"][0]["text"]
                                .as_str()
                                .unwrap_or_default();
                            visible[index]["message"]["content"][0]["text"] =
                                json!(format!("{previous}{text}"));
                        } else {
                            step_messages.insert(step.into(), visible.len());
                            visible.push(message(
                                source,
                                "assistant",
                                &id,
                                &v["time"],
                                Some(&model),
                                text_content(text),
                                None,
                            ));
                        }
                    }
                    "tool.call" => {
                        let call = e.get("toolCall").or_else(|| e.get("call")).unwrap_or(e);
                        let name = call["function"]["name"]
                            .as_str()
                            .or_else(|| call["name"].as_str());
                        if let Some(name) = name {
                            let call_id = call["id"]
                                .as_str()
                                .or_else(|| call["toolCallId"].as_str())
                                .unwrap_or(&id);
                            let input = call
                                .get("function")
                                .and_then(|f| f.get("arguments"))
                                .or_else(|| call.get("arguments"))
                                .or_else(|| call.get("args"))
                                .or_else(|| call.get("input"))
                                .cloned()
                                .unwrap_or(Value::Null);
                            let input = input
                                .as_str()
                                .and_then(|s| serde_json::from_str(s).ok())
                                .unwrap_or(input);
                            visible.push(message(
                                source,
                                "assistant",
                                &id,
                                &v["time"],
                                Some(&model),
                                json!([{"type":"tool_use","id":call_id,"name":name,"input":input}]),
                                None,
                            ));
                        }
                    }
                    "tool.result" => {
                        let result = e.get("result").unwrap_or(e);
                        let call_id = e["toolCallId"]
                            .as_str()
                            .or_else(|| result["toolCallId"].as_str())
                            .unwrap_or(&id);
                        let content = result
                            .get("content")
                            .or_else(|| result.get("output"))
                            .cloned()
                            .unwrap_or_else(|| text_content(&result.to_string()));
                        visible.push(message(source,"user",&id,&v["time"],None,json!([{"type":"tool_result","tool_use_id":call_id,"content":content,"is_error":result["isError"] == true}]),None));
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    visible.extend(spent);
    Ok(visible)
}

pub(super) fn delete(data: &Path, source: &Source) -> Result<(), AppError> {
    let state = &source.files[0];
    let dir = state.parent().unwrap();
    let dir = if dir.file_name().is_some_and(|n| n == "session-meta") {
        dir.parent().unwrap()
    } else {
        dir
    };
    let dir = storage::confined(&data.join("sessions"), dir)?;
    if dir.file_name().and_then(|s| s.to_str()) != Some(&source.meta.id) {
        return Err(AppError::invalid_argument("Kimi 会话目录与 ID 不匹配"));
    }
    let _lease = SessionLease::acquire(data, &source.meta.id)?;
    // The native index reconciles this journal against the authoritative session
    // directories. Never rewrite its live query-store database or other sessions.
    let dirty = data.join("sessions/.index-dirty");
    std::fs::create_dir_all(&dirty).map_err(storage::error)?;
    let dirty = storage::confined(data, &dirty)?;
    let index = data.join("session_index.jsonl");
    if index.exists() {
        storage::confined(data, &index)?;
    }
    use std::io::Write;
    let mut index = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(index)
        .map_err(storage::error)?;
    std::fs::remove_dir_all(dir).map_err(storage::error)?;
    std::fs::write(dirty.join(format!("{}.{}", source.meta.id, now())), b"")
        .map_err(storage::error)?;
    writeln!(
        index,
        "{}",
        json!({"sessionId":source.meta.id,"deleted":true})
    )
    .map_err(storage::error)?;
    index.sync_data().map_err(storage::error)
}

struct SessionLease {
    path: std::path::PathBuf,
    token: String,
}
impl SessionLease {
    fn acquire(data: &Path, id: &str) -> Result<Self, AppError> {
        let directory = data.join("locks/sessions");
        std::fs::create_dir_all(&directory).map_err(storage::error)?;
        let directory = storage::confined(data, &directory)?;
        let path = directory.join(format!("{id}.lock"));
        let token = ulid::Ulid::generate().to_string();
        let temp = directory.join(format!(".belfry-{token}.tmp"));
        // Publish fully written lock data atomically, as the native CLI does.
        let body = json!({"version":1,"token":token,"pid":std::process::id(),"hostname":"",
            "startedAt":now(),"clientIdentity":"belfry"})
        .to_string();
        crate::atomic::write_atomic(&temp, &body, true)?;
        let result = std::fs::hard_link(&temp, &path);
        let _ = std::fs::remove_file(temp);
        result.map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists {
            AppError::invalid_argument("Kimi 会话仍有原生锁，请退出该会话后重试；异常退出的会话可先在 Kimi 恢复并正常退出")
        } else { storage::error(e) })?;
        Ok(Self { path, token })
    }
}
impl Drop for SessionLease {
    fn drop(&mut self) {
        if storage::json(&self.path).is_ok_and(|v| v["token"] == self.token) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}
