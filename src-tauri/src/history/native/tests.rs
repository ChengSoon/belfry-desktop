use super::*;
use rusqlite::{Connection, params};
use std::{cell::Cell, fs};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("belfry-native-history-{}", ulid::Ulid::generate()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn write(&self, name: &str, text: &str) -> PathBuf {
        let path = self.0.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, text).unwrap();
        path
    }
    fn kimi(&self, id: &str, records: &[Value]) -> PathBuf {
        self.write(&format!("sessions/work/{id}/state.json"), &json!({"version":2,"id":id,"cwd":"/project","title":"Kimi history","createdAt":1_790_000_000_000i64,"updatedAt":1_790_000_005_000i64}).to_string());
        self.write(
            &format!("sessions/work/{id}/agents/main/wire.jsonl"),
            &records.iter().map(|v| format!("{v}\n")).collect::<String>(),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn user(text: &str) -> Value {
    json!({"type":"context.append_message","time":1_790_000_000_000i64,"message":{"role":"user","content":text}})
}
fn usage() -> Value {
    json!({"type":"usage.record","agentId":"main","time":1_790_000_000_010i64,"model":"model-alias","usageScope":"turn","usage":{"inputOther":10,"output":5,"inputCacheRead":2,"inputCacheCreation":0}})
}
fn text_of(records: &[Value]) -> String {
    records
        .iter()
        .map(|v| v["message"]["content"].to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn kimi_uses_incremental_usage_and_native_tool_arguments_without_counting_step_summaries() {
    let fixture = Fixture::new();
    fixture.kimi("session_target", &[
        user("Use a tool"), usage(), usage(),
        json!({"type":"context.append_loop_event","event":{"type":"tool.call","uuid":"call-event","toolCallId":"call-1","name":"Bash","args":{"command":"pwd"}}}),
        json!({"type":"context.append_loop_event","event":{"type":"tool.result","toolCallId":"call-1","result":{"output":"/project","durationMs":2}}}),
        json!({"type":"context.append_loop_event","event":{"type":"step.end","usage":{"inputOther":20,"output":10}}}),
    ]);
    fixture.kimi("session_other", &[user("Another session")]);
    let found = sources(AgentKind::Kimi, &fixture.0, Some("session_target"), &|| {
        Ok(())
    })
    .unwrap();
    assert_eq!(found.len(), 1);
    let records = normalize(AgentKind::Kimi, &fixture.0, &found[0], &|| Ok(())).unwrap();
    let billed: Vec<_> = records
        .iter()
        .filter(|v| v["message"]["usage"].is_object())
        .collect();
    assert_eq!(billed.len(), 2);
    assert_ne!(billed[0]["message"]["id"], billed[1]["message"]["id"]);
    assert_eq!(
        billed
            .iter()
            .map(|v| v["message"]["usage"]["output_tokens"].as_u64().unwrap())
            .sum::<u64>(),
        10
    );
    assert_eq!(
        records[1]["message"]["content"][0]["input"]["command"],
        "pwd"
    );
    assert_eq!(records[2]["message"]["content"][0]["tool_use_id"], "call-1");
    assert_eq!(records[2]["message"]["content"][0]["content"], "/project");
    assert!(!text_of(&records).contains("Another session"));
    assert_eq!(records[0]["timestamp"], 1_790_000_000i64);
}

#[test]
fn kimi_branch_switch_replaces_visible_history_but_preserves_billed_usage() {
    let fixture = Fixture::new();
    fixture.kimi("session_branch", &[
        user("Keep this"), usage(), user("Discard this"), usage(),
        json!({"type":"agent.switched","branch":"fork-1","base":{"branch":"main","line":2},"legacyUndoLine":6}),
        json!({"type":"context.undo","count":1}), user("Replacement"), usage(),
    ]);
    let found = sources(AgentKind::Kimi, &fixture.0, None, &|| Ok(())).unwrap();
    let records = normalize(AgentKind::Kimi, &fixture.0, &found[0], &|| Ok(())).unwrap();
    let text = text_of(&records);
    assert!(text.contains("Keep this") && text.contains("Replacement"));
    assert!(!text.contains("Discard this"));
    assert_eq!(
        records
            .iter()
            .filter(|v| v["message"]["usage"].is_object())
            .count(),
        3
    );
}

#[test]
fn kimi_delete_honors_native_locks_and_marks_only_the_target_index_entry() {
    let fixture = Fixture::new();
    let path = fixture.kimi("session_locked", &[user("target")]);
    let other = fixture.kimi("session_other", &[user("keep")]);
    let lock = fixture.write(
        "locks/sessions/session_locked.lock",
        "{\"token\":\"native\"}",
    );
    let source = sources(AgentKind::Kimi, &fixture.0, Some("session_locked"), &|| {
        Ok(())
    })
    .unwrap();
    assert!(kimi::delete(&fixture.0, &source[0]).is_err());
    assert!(path.exists() && lock.exists());
    fs::remove_file(&lock).unwrap();
    kimi::delete(&fixture.0, &source[0]).unwrap();
    assert!(!path.exists() && !lock.exists());
    assert!(other.exists());
    let marks = fs::read_dir(fixture.0.join("sessions/.index-dirty"))
        .unwrap()
        .count();
    assert_eq!(marks, 1);
    let index = fs::read_to_string(fixture.0.join("session_index.jsonl")).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(index.trim()).unwrap(),
        json!({"sessionId":"session_locked","deleted":true})
    );
}

#[test]
fn cached_snapshots_refresh_atomically_and_prune_only_after_successful_discovery() {
    let fixture = Fixture::new();
    let path = fixture.kimi("session_live", &[user("Before")]);
    let root = fixture.0.join("cache");
    refresh_in(AgentKind::Kimi, &fixture.0, &root, None, &|| Ok(())).unwrap();
    let cached = cache_file(&root, "session_live");
    assert_eq!(
        read_cached(&cached).unwrap().unwrap().agent,
        AgentKind::Kimi
    );
    let before = fs::read(&cached).unwrap();
    fs::write(&path, format!("{}\n{}\n", user("Before"), user("After"))).unwrap();
    let cancelled = Cell::new(0);
    assert!(
        refresh_in(AgentKind::Kimi, &fixture.0, &root, None, &|| {
            cancelled.set(cancelled.get() + 1);
            Err(AppError::io("cancelled"))
        })
        .is_err()
    );
    assert_eq!(fs::read(&cached).unwrap(), before);
    refresh_in(
        AgentKind::Kimi,
        &fixture.0,
        &root,
        Some("session_live"),
        &|| Ok(()),
    )
    .unwrap();
    assert!(fs::read_to_string(&cached).unwrap().contains("After"));
    fs::remove_dir_all(fixture.0.join("sessions")).unwrap();
    refresh_in(AgentKind::Kimi, &fixture.0, &root, None, &|| Ok(())).unwrap();
    assert!(!cached.exists());
}

fn opencode_db(fixture: &Fixture) -> Connection {
    let db = Connection::open(fixture.0.join("opencode.db")).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL;
        CREATE TABLE session_v2(id TEXT PRIMARY KEY,title TEXT,directory TEXT,time_created INTEGER,time_updated INTEGER,model TEXT,parent_id TEXT,tokens_input INTEGER,tokens_output INTEGER,tokens_reasoning INTEGER,tokens_cache_read INTEGER,tokens_cache_write INTEGER);
        CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,data TEXT);
        CREATE TABLE session_part(message_id TEXT,ordinal INTEGER,data TEXT);
        INSERT INTO session_v2 VALUES ('ses_target','OC history','/project',1790000000000,1790000005000,NULL,NULL,30,15,2,6,0);
        INSERT INTO session_v2 VALUES ('ses_child','Child','/project',1790000000000,1790000005000,NULL,'ses_target',0,0,0,0,0);").unwrap();
    db
}

#[test]
fn opencode_reads_live_wal_streamed_parts_and_accounts_for_auxiliary_usage_once() {
    let fixture = Fixture::new();
    let db = opencode_db(&fixture);
    let assistant = json!({"model":{"id":"native-model"},"content":[],"tokens":{"input":20,"output":10,"reasoning":2,"cache":{"read":4,"write":0}}});
    db.execute(
        "INSERT INTO session_message VALUES ('msg_a','ses_target','assistant',1,1790000001000,?1)",
        [assistant.to_string()],
    )
    .unwrap();
    let tool = json!({"type":"tool","id":"call-oc","name":"read","state":{"status":"completed","input":{"filePath":"/project/a"},"content":[{"type":"text","text":"file body"}]}});
    db.execute(
        "INSERT INTO session_part VALUES ('msg_a',1,?1)",
        [tool.to_string()],
    )
    .unwrap();
    let found = sources(AgentKind::Opencode, &fixture.0, None, &|| Ok(())).unwrap();
    assert_eq!(found.len(), 1);
    let records = normalize(AgentKind::Opencode, &fixture.0, &found[0], &|| Ok(())).unwrap();
    assert_eq!(records[0]["message"]["model"], "native-model");
    assert_eq!(records[0]["message"]["usage"]["output_tokens"], 12);
    assert_eq!(
        records[1]["message"]["content"][0]["tool_use_id"],
        "call-oc"
    );
    assert_eq!(records[2]["message"]["usage"]["input_tokens"], 10);
    assert_eq!(records[2]["message"]["usage"]["output_tokens"], 5);
    assert_eq!(records[2]["belfryAuxiliary"], true);
    assert!(records.iter().all(|v| v["sessionId"] == "ses_target"));
}

fn antigravity_db(fixture: &Fixture) -> Connection {
    let db = Connection::open(fixture.0.join("conversation_summaries.db")).unwrap();
    db.execute_batch("CREATE TABLE conversation_summaries(conversation_id TEXT PRIMARY KEY,title TEXT,preview TEXT,workspace_uris TEXT,last_modified_time TEXT,parent_conversation_id TEXT,not_fully_idle INTEGER);
        CREATE TABLE conversations_fts(conversation_id TEXT);").unwrap();
    for (id, parent, busy) in [
        ("target", None, 0),
        ("child", Some("target"), 0),
        ("unrelated", None, 0),
        ("busy", None, 1),
    ] {
        db.execute("INSERT INTO conversation_summaries VALUES (?1,?1,'preview','[\"file:///project\"]','2026-11-08 10:00:00',?2,?3)", params![id,parent,busy]).unwrap();
        db.execute("INSERT INTO conversations_fts VALUES (?1)", [id])
            .unwrap();
        fixture.write(&format!("conversations/{id}.db"), "fixture");
        fixture.write(&format!("brain/{id}/.system_generated/logs/transcript.jsonl"), &format!("{}\n{}\n",
            json!({"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","created_at":"2026-11-08T10:00:00Z","content":"<USER_REQUEST>\nHello\n</USER_REQUEST>\n<ADDITIONAL_METADATA>secret-internal</ADDITIONAL_METADATA>"}),
            json!({"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","created_at":"2026-11-08T10:00:01Z","input_tokens":10,"cache_read_tokens":2,"output_tokens":5,"content":"Answer"})));
    }
    db
}

#[test]
fn antigravity_preserves_missing_usage_metadata_and_deletes_only_the_selected_family() {
    let fixture = Fixture::new();
    let db = antigravity_db(&fixture);
    let found = sources(AgentKind::Antigravity, &fixture.0, Some("target"), &|| {
        Ok(())
    })
    .unwrap();
    let records = normalize(AgentKind::Antigravity, &fixture.0, &found[0], &|| Ok(())).unwrap();
    assert!(!text_of(&records).contains("secret-internal"));
    assert_eq!(records[1]["message"]["model"], "unknown");
    assert!(records[1]["message"]["usage"]["cache_creation_input_tokens"].is_null());
    let busy = sources(AgentKind::Antigravity, &fixture.0, Some("busy"), &|| Ok(())).unwrap();
    assert!(antigravity::delete(&fixture.0, &busy[0]).is_err());
    antigravity::delete(&fixture.0, &found[0]).unwrap();
    for name in ["target", "child"] {
        assert!(!fixture.0.join("brain").join(name).exists());
    }
    assert!(fixture.0.join("conversations/unrelated.db").exists());
    assert_eq!(
        db.query_row("SELECT count(*) FROM conversation_summaries", [], |r| r
            .get::<_, u64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM conversations_fts", [], |r| r
            .get::<_, u64>(0))
            .unwrap(),
        2
    );
}

#[cfg(unix)]
#[test]
fn native_transcripts_cannot_follow_symlinks_outside_the_data_root() {
    let fixture = Fixture::new();
    let outside = Fixture::new();
    let wire = fixture.kimi("session_link", &[user("safe")]);
    fs::remove_file(&wire).unwrap();
    let secret = outside.write("private.jsonl", &user("unrelated").to_string());
    std::os::unix::fs::symlink(&secret, &wire).unwrap();
    assert!(
        sources(
            AgentKind::Kimi,
            &fixture.0,
            Some("session_link"),
            &|| Ok(())
        )
        .is_err()
    );
    assert!(secret.is_file());
}

#[test]
fn antigravity_links_native_tool_results_to_planner_calls_and_decodes_arguments() {
    let fixture = Fixture::new();
    let _db = antigravity_db(&fixture);
    let native = [
        json!({"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-11-08T10:00:01Z","input_tokens":10,"cache_read_tokens":2,"output_tokens":5,
            "tool_calls":[{"name":"mcp_belfry_smoke_belfry_echo","args":{"text":"\"echo-result\"","count":"2"}},{"name":"read_file","args":{"path":"\"missing.txt\""}}]}),
        json!({"step_index":2,"source":"MODEL","type":"GENERIC","status":"DONE","content":"echo-result"}),
        json!({"step_index":3,"source":"MODEL","type":"READ_FILE","status":"ERROR","content":"missing file"}),
    ];
    fixture.write(
        "brain/target/.system_generated/logs/transcript.jsonl",
        &native.iter().map(|v| format!("{v}\n")).collect::<String>(),
    );
    let found = sources(AgentKind::Antigravity, &fixture.0, Some("target"), &|| {
        Ok(())
    })
    .unwrap();
    let records = normalize(AgentKind::Antigravity, &fixture.0, &found[0], &|| Ok(())).unwrap();
    assert_eq!(records.len(), 3);
    let calls = &records[0]["message"]["content"];
    assert_eq!(calls[0]["name"], "mcp_belfry_smoke_belfry_echo");
    assert_eq!(calls[0]["input"], json!({"text":"echo-result","count":2}));
    for offset in 0..2 {
        let result = &records[offset + 1]["message"]["content"][0];
        assert_eq!(result["tool_use_id"], calls[offset]["id"]);
        assert_eq!(result["is_error"], offset == 1);
    }
}

/// A copied store from the official CLI exercises formats that synthetic fixtures cannot cover.
#[test]
#[ignore = "requires BELFRY_NATIVE_FIXTURE_AGENT and a disposable BELFRY_NATIVE_FIXTURE_ROOT under the OS temp directory"]
fn official_cli_store_snapshot_roundtrip() {
    let root = PathBuf::from(std::env::var_os("BELFRY_NATIVE_FIXTURE_ROOT").expect("fixture root"));
    let root = root.canonicalize().unwrap();
    assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    assert!(
        root.file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("belfry-native-fixture-")
    );
    let agent: AgentKind =
        serde_json::from_value(json!(std::env::var("BELFRY_NATIVE_FIXTURE_AGENT").unwrap()))
            .unwrap();
    assert!(supported(agent));
    let found = sources(agent, &root, None, &|| Ok(())).unwrap();
    assert!(
        found.len() >= 2,
        "provide at least two completed test conversations"
    );
    let cache = root.join("belfry-cache");
    refresh_in(agent, &root, &cache, None, &|| Ok(())).unwrap();
    assert!(found.iter().all(|source| {
        read_cached(&cache_file(&cache, &source.meta.id))
            .unwrap()
            .is_some()
    }));
    let target = found
        .iter()
        .find(|source| {
            let records = normalize(agent, &root, source, &|| Ok(())).unwrap();
            records.iter().any(|v| v["type"] == "user")
                && records.iter().any(|v| v["message"]["usage"].is_object())
        })
        .expect("provide a completed test conversation with usage");
    match agent {
        AgentKind::Antigravity => antigravity::delete(&root, target).unwrap(),
        AgentKind::Opencode => opencode::delete(&root, target).unwrap(),
        AgentKind::Kimi => kimi::delete(&root, target).unwrap(),
        _ => unreachable!(),
    }
    let after = sources(agent, &root, None, &|| Ok(())).unwrap();
    assert_eq!(after.len(), found.len() - 1);
    assert!(after.iter().all(|source| source.meta.id != target.meta.id));
    assert!(
        found
            .iter()
            .filter(|old| old.meta.id != target.meta.id)
            .all(|old| after.iter().any(|current| current.meta.id == old.meta.id))
    );
}
