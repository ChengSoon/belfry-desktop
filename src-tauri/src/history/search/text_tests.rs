use serde_json::json;

use super::text::record_text;
use crate::agent::AgentKind;

#[test]
fn codex_searches_assistant_body_beyond_the_title() {
    let record = json!({"type":"response_item", "payload":{
        "type":"message", "role":"assistant",
        "content":[{"type":"output_text", "text":"已修改 src/接口.rs 中的校验"}]
    }});
    assert_eq!(
        vec!["已修改 src/接口.rs 中的校验"],
        record_text(AgentKind::Codex, &record)
    );
}

#[test]
fn codex_reads_event_messages_and_tool_arguments() {
    let message = json!({"type":"event_msg", "payload":{
        "type":"user_message", "message":"搜索 C:\\项目\\入口.ts"
    }});
    assert_eq!(
        vec!["搜索 C:\\项目\\入口.ts"],
        record_text(AgentKind::Codex, &message)
    );
    let tool = json!({"type":"response_item", "payload":{
        "type":"function_call", "name":"exec_command",
        "arguments":"{\"cmd\":\"cargo test 历史\"}"
    }});
    assert!(record_text(AgentKind::Codex, &tool)
        .iter()
        .any(|text| text == "cargo test 历史"));
}

#[test]
fn claude_searches_string_content_as_well_as_text_blocks() {
    let plain = json!({"type":"user", "message":{"role":"user", "content":"请修复搜索"}});
    assert_eq!(vec!["请修复搜索"], record_text(AgentKind::Claude, &plain));
    let rich = json!({"type":"assistant", "message":{"role":"assistant", "content":[
        {"type":"text", "text":"运行 npm test"},
        {"type":"tool_use", "name":"Bash", "input":{"command":"npm test"}}
    ]}});
    let texts = record_text(AgentKind::Claude, &rich);
    assert!(texts.iter().any(|text| text == "运行 npm test"));
    assert!(texts.iter().any(|text| text == "npm test"));
}

#[test]
fn image_payloads_are_not_indexed_but_adjacent_text_is() {
    let record = json!({"type":"user", "message":{"content":[
        {"type":"image", "source":{"type":"base64", "data":"secret-image-data"}},
        {"type":"text", "text":"图片旁的有效文字"},
        {"type":"tool_result", "content":[{"type":"text", "text":"测试通过"}]}
    ]}});
    assert_eq!(
        vec!["图片旁的有效文字", "测试通过"],
        record_text(AgentKind::Claude, &record)
    );
}

#[test]
fn system_metadata_does_not_become_conversation_text() {
    let record = json!({"type":"session_meta", "payload":{"developer_instructions":"内部指令"}});
    assert!(record_text(AgentKind::Codex, &record).is_empty());
}
