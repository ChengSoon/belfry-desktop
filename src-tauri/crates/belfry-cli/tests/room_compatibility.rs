use belfry_protocol::{ENV_ENDPOINT, ENV_TAB_ID, ENV_TOKEN};
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    process::{Command, Output, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

// 旧后台会把新增字段丢掉，转发出的 peers 回执仍是这份旧格式。
const LEGACY_PEERS: &str = r#"{"status":"ok","data":{"kind":"peers","peers":[]}}"#;
const CURRENT_PEERS: &str =
    r#"{"status":"ok","data":{"kind":"peers","peers":[],"capabilities":["rooms_v1"]}}"#;
const OLD_APP: &str = r#"{"status":"error","message":"没有这条任务"}"#;

fn compat_reply(response: &str) -> String {
    serde_json::json!({
        "status": "ok",
        "data": {
            "kind": "taskState", "task": "belfry:rooms:v1", "state": "belfry:rooms:v1",
            "settled": true, "result": response,
        },
    })
    .to_string()
}

fn compat_command(request: &Value) -> Value {
    assert_eq!(request["command"]["kind"], "taskState");
    let payload = request["command"]["task"]
        .as_str()
        .unwrap()
        .strip_prefix("belfry:rooms:v1:")
        .unwrap();
    serde_json::from_str(payload).unwrap()
}

/// 用真 CLI 连接本测试的 loopback 服务；记录实际发出的命令，不能只检查错误文案。
fn run(args: &[&str], replies: &[&str]) -> (Output, Vec<Value>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let finished = Arc::new(AtomicBool::new(false));
    let stop = finished.clone();
    let replies: Vec<String> = replies.iter().map(|reply| reply.to_string()).collect();
    let server = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut requests = Vec::new();
        while !stop.load(Ordering::Acquire) && Instant::now() < deadline {
            let (mut stream, _) = match listener.accept() {
                Ok(connection) => connection,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                }
                Err(error) => panic!("{error}"),
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut line = String::new();
            BufReader::new(&stream).read_line(&mut line).unwrap();
            requests.push(serde_json::from_str(&line).unwrap());
            let reply = replies
                .get(requests.len() - 1)
                .map(String::as_str)
                .unwrap_or(r#"{"status":"error","message":"unexpected extra request"}"#);
            writeln!(stream, "{reply}").unwrap();
        }
        requests
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_belfry"))
        .args(args)
        .env("BELFRY_LANG", "zh-CN")
        .env(ENV_ENDPOINT, format!("tcp:{address}"))
        .env(ENV_TAB_ID, "compatibility-test-tab")
        .env(ENV_TOKEN, "compatibility-test-token")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while child.try_wait().unwrap().is_none() {
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            finished.store(true, Ordering::Release);
            let _ = server.join();
            panic!("CLI exceeded the compatibility check deadline");
        }
        thread::sleep(Duration::from_millis(5));
    }
    let output = child.wait_with_output().unwrap();
    finished.store(true, Ordering::Release);
    (output, server.join().unwrap())
}

fn kinds(requests: &[Value]) -> Vec<&str> {
    requests
        .iter()
        .map(|request| request["command"]["kind"].as_str().unwrap())
        .collect()
}

#[test]
fn old_apps_are_detected_before_any_room_operation_is_sent() {
    for args in [
        vec!["rooms"],
        vec!["room", "status"],
        vec!["room", "log"],
        vec!["room", "say", "进展"],
        vec!["room", "task", "add", "修复登录"],
        vec!["room", "brief", "--focus", "联调"],
    ] {
        let (output, requests) = run(&args, &[LEGACY_PEERS, OLD_APP]);
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(!output.status.success(), "{args:?}: {output:?}");
        assert!(error.contains("协作房间协议不兼容"), "{error}");
        assert!(error.contains("本次房间操作未发送"), "{error}");
        assert!(error.contains("没有这条任务"), "{error}");
        assert!(error.contains("终端后台无需重启"), "{error}");
        assert_eq!(kinds(&requests), ["peers", "taskState"], "{args:?}");
        assert_eq!(
            compat_command(&requests[1]),
            serde_json::json!({"kind": "peers"})
        );
    }
}

#[test]
fn unrelated_capabilities_do_not_authorize_room_commands() {
    let (output, requests) = run(
        &["room", "task", "done", "T1", "已完成"],
        &[
            r#"{"status":"ok","data":{"kind":"peers","peers":[],"capabilities":["something_else"]}}"#,
            &compat_reply(LEGACY_PEERS),
        ],
    );
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("本次房间操作未发送"));
    assert_eq!(kinds(&requests), ["peers", "taskState"]);
    assert_eq!(compat_command(&requests[1])["kind"], "peers");
}

#[test]
fn old_relays_can_create_a_room_task_without_losing_fields_or_creating_it_twice() {
    let (output, requests) = run(
        &[
            "room",
            "task",
            "add",
            "协议连通性验证",
            "--to",
            "后端",
            "--outcome",
            "验证回执",
            "--after",
            "T1",
        ],
        &[
            LEGACY_PEERS,
            &compat_reply(CURRENT_PEERS),
            &compat_reply(
                r#"{"status":"ok","data":{"kind":"roomTaskChanged","room":"联调","task":{"id":"T2","title":"协议连通性验证","status":"待开工","assignee":"后端","outcome":"验证回执","waitingFor":["T1"],"notes":"","result":null},"note":"已通知后端"}}"#,
            ),
        ],
    );
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(
        text.contains("T2") && text.contains("协议连通性验证"),
        "{text}"
    );
    assert!(!text.contains("belfry:rooms:v1"), "{text}");
    assert_eq!(kinds(&requests), ["peers", "taskState", "taskState"]);
    assert_eq!(compat_command(&requests[1])["kind"], "peers");
    assert_eq!(
        compat_command(&requests[2]),
        serde_json::json!({
            "kind": "roomTask", "room": null,
            "op": {"op": "add", "title": "协议连通性验证", "assignee": "后端", "outcome": "验证回执", "after": ["T1"]},
        })
    );
    for request in requests {
        assert_eq!(request["tabId"], "compatibility-test-tab");
        assert_eq!(request["token"], "compatibility-test-token");
    }
}

#[test]
fn old_relays_preserve_reply_targets_recipients_and_ask_receipts() {
    let (output, requests) = run(
        &[
            "room",
            "say",
            "--reply",
            "11223344",
            "--ask",
            "--to",
            "后端",
            "已修复\n请复核",
        ],
        &[
            LEGACY_PEERS,
            &compat_reply(CURRENT_PEERS),
            &compat_reply(
                r#"{"status":"ok","data":{"kind":"roomSaid","room":"联调","message":"a1b2c3d4","recipients":["后端"],"skipped":[],"ask":true}}"#,
            ),
        ],
    );
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.contains("a1b2c3d4") && text.contains("后端"), "{text}");
    assert_eq!(kinds(&requests), ["peers", "taskState", "taskState"]);
    let command = compat_command(&requests[2]);
    assert_eq!(command["kind"], "roomSay");
    assert_eq!(command["text"], "已修复\n请复核");
    assert_eq!(command["replyTo"], "11223344");
    assert_eq!(command["to"], serde_json::json!(["后端"]));
    assert_eq!(command["ask"], true);
}

#[test]
fn an_invalid_compatibility_probe_never_sends_a_room_write() {
    let ordinary_task = serde_json::json!({
        "status": "ok", "data": {
            "kind": "taskState", "task": "some-task", "state": "done", "settled": true,
            "result": CURRENT_PEERS,
        },
    })
    .to_string();
    for probe in [compat_reply("not json"), ordinary_task] {
        let (output, requests) = run(&["room", "say", "进展"], &[LEGACY_PEERS, &probe]);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("本次房间操作未发送"));
        assert_eq!(kinds(&requests), ["peers", "taskState"]);
        assert_eq!(compat_command(&requests[1])["kind"], "peers");
    }
}

#[test]
fn a_damaged_compatibility_receipt_never_retries_a_room_write() {
    let (output, requests) = run(
        &["room", "say", "完成"],
        &[
            LEGACY_PEERS,
            &compat_reply(CURRENT_PEERS),
            &compat_reply(
                r#"{"status":"ok","data":{"kind":"roomSaid","room":"联调","recipients":[],"skipped":[],"ask":false}}"#,
            ),
        ],
    );
    assert!(!output.status.success());
    let error = String::from_utf8_lossy(&output.stderr);
    assert!(
        error.contains("回应看不懂") && error.contains("不要自动重复创建任务"),
        "{error}"
    );
    assert!(!error.contains("本次房间操作未发送"), "{error}");
    assert_eq!(kinds(&requests), ["peers", "taskState", "taskState"]);
    assert_eq!(compat_command(&requests[2])["kind"], "roomSay");
}

#[test]
fn room_errors_are_preserved_through_the_compatibility_channel() {
    let (output, requests) = run(
        &["room", "task", "start", "T1"],
        &[
            LEGACY_PEERS,
            &compat_reply(CURRENT_PEERS),
            &compat_reply(r#"{"status":"error","message":"房间里没有这个成员"}"#),
        ],
    );
    assert!(!output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stderr).trim(),
        "房间里没有这个成员"
    );
    assert_eq!(kinds(&requests), ["peers", "taskState", "taskState"]);
}

#[test]
fn compatible_relays_send_the_message_once_and_return_its_receipt() {
    let (output, requests) = run(
        &["room", "say", "--ask", "--to", "后端", "接口完成了吗"],
        &[
            CURRENT_PEERS,
            r#"{"status":"ok","data":{"kind":"roomSaid","room":"联调","message":"a1b2c3d4","recipients":["后端"],"skipped":[],"ask":true}}"#,
        ],
    );
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(text.contains("a1b2c3d4") && text.contains("后端"), "{text}");
    assert_eq!(kinds(&requests), ["peers", "roomSay"]);
    assert_eq!(requests[1]["command"]["text"], "接口完成了吗");
    assert_eq!(requests[1]["command"]["to"], serde_json::json!(["后端"]));
    assert_eq!(requests[1]["command"]["ask"], true);
    for request in &requests {
        assert_eq!(request["tabId"], "compatibility-test-tab");
        assert_eq!(request["token"], "compatibility-test-token");
    }
}

#[test]
fn a_damaged_receipt_does_not_retry_a_message_that_may_have_been_delivered() {
    let (output, requests) = run(
        &["room", "say", "完成"],
        &[
            CURRENT_PEERS,
            // roomSaid 缺少 message；模拟写入成功后回执损坏的情况。
            r#"{"status":"ok","data":{"kind":"roomSaid","room":"联调","recipients":[],"skipped":[],"ask":false}}"#,
        ],
    );
    assert!(!output.status.success());
    let error = String::from_utf8_lossy(&output.stderr);
    assert!(error.contains("回应看不懂"), "{error}");
    assert!(!error.contains("本次房间操作未发送"), "{error}");
    assert_eq!(kinds(&requests), ["peers", "roomSay"]);
}

#[test]
fn authentication_errors_are_preserved_without_sending_the_room_command() {
    let (output, requests) = run(
        &["room", "task", "add", "任务"],
        &[r#"{"status":"error","message":"身份校验失败"}"#],
    );
    assert!(!output.status.success());
    assert_eq!(
        String::from_utf8_lossy(&output.stderr).trim(),
        "身份校验失败"
    );
    assert_eq!(kinds(&requests), ["peers"]);
}

#[test]
fn basic_collaboration_remains_available_through_an_old_relay() {
    let (output, requests) = run(&["peers"], &[LEGACY_PEERS]);
    assert!(output.status.success(), "{output:?}");
    assert_eq!(kinds(&requests), ["peers"]);

    let (output, requests) = run(
        &["send", "reviewer", "检查变更"],
        &[
            r#"{"status":"ok","data":{"kind":"sent","task":"test-task","to":"reviewer","pendingApproval":false}}"#,
        ],
    );
    assert!(output.status.success(), "{output:?}");
    assert_eq!(kinds(&requests), ["send"]);
}

#[test]
fn wait_cannot_turn_a_reserved_transport_payload_into_a_room_write() {
    let payload = r#"belfry:rooms:v1:{"kind":"roomSay","text":"不可发送"}"#;
    let (output, requests) = run(&["wait", payload, "--timeout", "1"], &[]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("任务编号无效"));
    assert!(requests.is_empty());
}

const INBOX_PEERS: &str = r#"{"status":"ok","data":{"kind":"peers","peers":[],"capabilities":["rooms_v1","collaboration-inbox-v1"]}}"#;
#[test]
fn inbox_metadata_always_uses_opaque_transport_and_is_sent_only_once() {
    let said = r#"{"status":"ok","data":{"kind":"roomSaid","room":"test","message":"one","recipients":["worker"],"skipped":[],"ask":false}}"#;
    let (output, requests) = run(&["room", "say", "answer", "--room", "test", "--topic", "api", "--answer", "q1", "--answer", "q2", "--op", "stable"], &[&compat_reply(INBOX_PEERS), &compat_reply(said)]);
    assert!(output.status.success(), "{output:?}"); assert_eq!(kinds(&requests), ["taskState", "taskState"]);
    let command = compat_command(&requests[1]); assert_eq!(command["inbox"]["answers"], serde_json::json!(["q1", "q2"])); assert_eq!(command["inbox"]["operationId"], "stable");
}
#[test]
fn inbox_capability_is_required_before_sending_new_operations() {
    let (output, requests) = run(&["inbox", "ack", "entry@1", "--state", "processed", "--op", "stable"], &[&compat_reply(CURRENT_PEERS)]);
    assert!(!output.status.success()); assert_eq!(requests.len(), 1); assert_eq!(compat_command(&requests[0])["kind"], "peers");
}
#[test]
fn uncertain_batch_resolution_and_generation_checks_survive_an_old_relay() {
    let response = r#"{"status":"ok","data":{"kind":"collaborationInbox","result":{"ok":true}}}"#;
    let (output, requests) = run(&["inbox", "resolve", "original-batch", "--attempt", "attempt", "--revision", "2", "--sequence", "1", "--decision", "abandon", "--op", "check-1"], &[&compat_reply(INBOX_PEERS), &compat_reply(response)]);
    assert!(output.status.success(), "{output:?}");
    let command = compat_command(&requests[1]); assert_eq!(command["command"]["op"], "resolve"); assert_eq!(command["command"]["request"]["batch"]["expectedRevision"], 2);
    let (output, requests) = run(&["room", "task", "done", "T1", "--generation", "7", "complete"], &[&compat_reply(INBOX_PEERS), &compat_reply(response)]);
    assert!(output.status.success()); assert_eq!(compat_command(&requests[1])["op"]["generation"], 7);
}
