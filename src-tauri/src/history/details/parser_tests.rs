use super::{parser::parse, patch, text::MAX_ENTRY_BYTES};
use crate::agent::{AgentKind, AgentSessionRef};
use serde_json::json;

fn session(agent: AgentKind) -> AgentSessionRef {
    AgentSessionRef {
        agent,
        id: "native".into(),
    }
}

#[test]
fn reads_codex_message_text_without_image_payloads() {
    let value = json!({"type":"response_item","timestamp":"2026-09-11T12:00:00Z","payload":{
        "type":"message","role":"user","content":[{"type":"input_text","text":"查看 src/页面.tsx"},
        {"type":"input_image","image_url":"data:image/png;base64,DO_NOT_RENDER"}]}});
    let entry = parse(&session(AgentKind::Codex), &value, "0:1").unwrap();
    assert_eq!("查看 src/页面.tsx", entry.text);
    assert_eq!(1, entry.omitted_blocks);
    assert!(entry.timestamp.is_some());
}

#[test]
fn claude_edits_keep_each_replacement_and_link_the_tool_call() {
    let value = json!({"type":"assistant","uuid":"message-one","sessionId":"native","message":{"content":[
        {"type":"text","text":"分两步修改"},{"type":"tool_use","id":"tool-one","name":"MultiEdit","input":{
        "file_path":"/work/中文 项目/页面.tsx","edits":[{"old_string":"旧内容","new_string":"中间内容"},
        {"old_string":"中间内容","new_string":"新内容"}]}}]}});
    let entry = parse(&session(AgentKind::Claude), &value, "0:1").unwrap();
    assert_eq!(1, entry.tools.len());
    assert_eq!("tool-one", entry.tools[0].id);
    assert_eq!(2, entry.tools[0].changes.len());
    assert_eq!(
        Some("旧内容"),
        entry.tools[0].changes[0].old_text.as_deref()
    );
    assert_eq!(
        Some("新内容"),
        entry.tools[0].changes[1].new_text.as_deref()
    );
}

#[test]
fn ignores_foreign_and_subagent_claude_records() {
    let reference = session(AgentKind::Claude);
    for extra in [json!({"sessionId":"another"}), json!({"isSidechain":true})] {
        let mut value = json!({"type":"user","message":{"content":"不属于当前会话"}});
        value
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert!(parse(&reference, &value, "0:1").is_none());
    }
}

#[test]
fn codex_patch_calls_preserve_multiple_files_and_rename_paths() {
    let patch_text = "*** Begin Patch\n*** Update File: 中文 路径/旧名.ts\n*** Move to: 中文 路径/新名.ts\n@@\n-旧\n+新\n*** Add File: 新文件.ts\n+export {};\n*** Delete File: 删除.ts\n*** End Patch";
    let value = json!({"type":"response_item","payload":{"type":"custom_tool_call","call_id":"patch-one",
        "name":"apply_patch","input":patch_text}});
    let entry = parse(&session(AgentKind::Codex), &value, "0:2").unwrap();
    let changes = &entry.tools[0].changes;
    assert_eq!(3, changes.len());
    assert_eq!("中文 路径/新名.ts", changes[0].path);
    assert_eq!(
        Some("中文 路径/旧名.ts"),
        changes[0].original_path.as_deref()
    );
    assert_eq!("add", changes[1].kind);
    assert_eq!("delete", changes[2].kind);
    assert!(changes[2].old_text.is_none());
}

#[test]
fn write_logs_never_invent_the_previous_file_or_claim_a_new_file() {
    let value = json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"write", "name":"Write",
        "input":{"file_path":"/tmp/existing.txt","content":"替换后的内容"}}]}});
    let entry = parse(&session(AgentKind::Claude), &value, "0:1").unwrap();
    let change = &entry.tools[0].changes[0];
    assert_eq!("write", change.kind);
    assert!(change.old_text.is_none());
    assert!(change.note.contains("原内容未记录"));
}

#[test]
fn tool_results_keep_explicit_failure_and_unknown_status_separate() {
    let claude = json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"edit", "is_error":true,"content":"找不到替换片段"}]}});
    let failed = parse(&session(AgentKind::Claude), &claude, "0:2").unwrap();
    assert_eq!(Some(false), failed.tools[0].success);
    assert_eq!("tool", failed.role);
    let codex = json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"edit","output":"result text"}});
    let unknown = parse(&session(AgentKind::Codex), &codex, "0:2").unwrap();
    assert_eq!(None, unknown.tools[0].success);
    assert_eq!("edit", unknown.tools[0].id);
}

#[test]
fn missing_edit_content_remains_unavailable_and_plain_shell_text_is_not_a_patch() {
    let value = json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"edit","name":"Edit","input":{"file_path":"a.ts"}}]}});
    let entry = parse(&session(AgentKind::Claude), &value, "0:1").unwrap();
    assert!(entry.tools[0].changes[0].old_text.is_none());
    assert!(entry.tools[0].changes[0].note.contains("不足"));
    assert!(patch::changes("echo '*** Update File: a.ts'").is_empty());
}

#[test]
fn bounds_long_unicode_messages_without_breaking_utf8() {
    let value = json!({"type":"user","message":{"content":"中文".repeat(MAX_ENTRY_BYTES)}});
    let entry = parse(&session(AgentKind::Claude), &value, "0:1").unwrap();
    assert!(entry.truncated);
    assert!(entry.text.len() <= MAX_ENTRY_BYTES);
    assert!(
        value["message"]["content"]
            .as_str()
            .unwrap()
            .starts_with(&entry.text)
    );
}
