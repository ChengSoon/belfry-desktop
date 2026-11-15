use super::fixture::*;
use crate::{
    a2a::{
        connections::ConnectionSource,
        local::{LinkPreviews, ReadyMarks, Service},
        requests::CancelSignal,
    },
    agent::AgentKind,
    collab::task::TaskState,
    plugins::agent_connection::AuthorizedAgent,
    rooms::{model::Actor as RoomActor, ops},
};
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use std::{
    sync::{Arc, mpsc},
    thread,
    time::{Duration, Instant},
};
use tauri::async_runtime::block_on;

#[test]
fn local_a2a_http_reads_fragmented_headers_on_an_inherited_nonblocking_socket() {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    let rig = Rig::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let (accepted, _) = listener.accept().unwrap();
    // BSD/macOS accept inherits this flag from the nonblocking listener.
    // Force it explicitly so this regression exercises the same path on Linux and Windows.
    accepted.set_nonblocking(true).unwrap();
    client.write_all(b"GET /he").unwrap();
    let service = rig.service.clone();
    let handler = thread::spawn(move || super::super::http::handle(accepted, &service));
    thread::sleep(Duration::from_millis(30));
    let host = rig.service.origin.strip_prefix("http://").unwrap();
    let _ = client.write_all(format!("alth HTTP/1.1\r\nHost: {host}\r\n\r\n").as_bytes());
    let mut response = Vec::new();
    let read_result = client.read_to_end(&mut response);
    handler.join().unwrap();
    assert!(
        response.starts_with(b"HTTP/1.1 200 OK\r\n"),
        "fragmented request was rejected: status={:?}, read={:?}",
        String::from_utf8_lossy(
            response
                .split(|byte| *byte == b'\r')
                .next()
                .unwrap_or_default()
        ),
        read_result.as_ref().err().map(|error| error.kind())
    );
    assert!(
        response
            .windows(b"\"protocolVersion\":\"1.0\"".len())
            .any(|part| part == b"\"protocolVersion\":\"1.0\"")
    );
}

#[test]
fn local_a2a_real_client_card_native_delivery_and_explicit_result() {
    let rig = Rig::new();
    rig.ready_pair();
    let connection = rig.connection(&rig.a, &rig.b);
    let card = rig
        .api(
            &rig.a,
            "a2a.agentCard",
            json!({"connectionId":connection,"requestId":op()}),
        )
        .unwrap();
    assert_eq!(card["selectedInterface"]["protocolVersion"], "1.0");
    assert_eq!(card["selectedInterface"]["protocolBinding"], "JSONRPC");
    assert_eq!(card["card"]["capabilities"]["streaming"], false);
    let resolved = rig
        .connections(&rig.a)
        .resolve(&rig.project, &connection)
        .unwrap();
    assert!(
        !card
            .to_string()
            .contains(resolved.secret.as_ref().unwrap().as_str())
    );
    assert!(!card.to_string().contains(&rig.a.ticket));
    let sent = rig
        .send(
            &rig.a,
            &rig.b,
            "complete instruction and native delivery marker",
        )
        .unwrap();
    assert_eq!(sent["task"]["status"]["state"], "TASK_STATE_SUBMITTED");
    let task = rig.assigned(&rig.b);
    assert_eq!(task["task"]["id"], sent["task"]["id"]);
    assert_eq!(
        task["instruction"],
        "complete instruction and native delivery marker"
    );
    let (offer, batch) = rig.prepare(&rig.b);
    assert!(batch.payload.contains("A2AReportTask"));
    assert!(batch.payload.contains("generation"));
    assert!(!batch.payload.contains("belfry done"));
    assert!(!batch.payload.contains("belfry room"));
    let begin = rig.begin(offer, &batch);
    let (receipt, bytes) = rig.finish(&begin);
    assert_eq!(receipt.phase, "submitted");
    assert_eq!(
        bytes,
        format!("\x1b[200~{}\x1b[201~\r", begin.batch.payload).into_bytes()
    );
    let business_id = task["taskRef"]["id"].as_str().unwrap();
    assert_eq!(
        rig.service
            .board
            .snapshot()
            .iter()
            .find(|entry| entry.id == business_id)
            .unwrap()
            .state,
        TaskState::Dispatched
    );
    // Native submission and subsequent idle are still unresolved until the
    // authenticated Recipient's report settles the same durable task.
    rig.service
        .registry
        .replace([&rig.a, &rig.b, &rig.c].into_iter().map(session).collect());
    let pending = rig
        .api(
            &rig.a,
            "a2a.getTask",
            json!({"taskHandle":sent["taskHandle"],"requestId":op(),"historyLength":0}),
        )
        .unwrap();
    assert_eq!(pending["terminal"], false);
    assert!(pending["task"].get("history").is_none());
    rig.report(
        &rig.b,
        &task,
        "working",
        "started after reading full context",
    )
    .unwrap();
    let report = json!({"reportHandle":task["reportHandle"],"generation":task["generation"],"state":"completed",
        "text":"actual synthetic work completed","artifacts":[{"name":"result.txt","text":"verified result artifact"}],"operationId":op()});
    let completed = rig
        .local(&rig.b, "a2a.localReport", report.clone())
        .unwrap();
    let repeated = rig
        .local(&rig.b, "a2a.localReport", report.clone())
        .unwrap();
    assert_eq!(completed, repeated);
    let mut conflict = report;
    conflict["text"] = json!("changed content");
    assert_eq!(
        code(&rig.local(&rig.b, "a2a.localReport", conflict).unwrap_err()),
        "A2A_LOCAL_OPERATION_CONFLICT"
    );
    let result = rig
        .api(
            &rig.a,
            "a2a.getTask",
            json!({"taskHandle":sent["taskHandle"],"requestId":op(),"historyLength":1}),
        )
        .unwrap();
    assert_eq!(result["terminal"], true);
    assert_eq!(result["task"]["status"]["state"], "TASK_STATE_COMPLETED");
    assert_eq!(result["task"]["history"].as_array().unwrap().len(), 1);
    assert_eq!(
        result["task"]["artifacts"][0]["parts"][0]["text"],
        "verified result artifact"
    );
    let board = rig.service.board.snapshot();
    let entry = board.iter().find(|entry| entry.id == business_id).unwrap();
    assert_eq!(entry.state, TaskState::Done);
    assert!(
        entry
            .result
            .as_ref()
            .unwrap()
            .contains("verified result artifact")
    );
    let snapshot = rig.service.snapshot(&rig.project).unwrap();
    assert_eq!(snapshot["tasks"][0]["state"], "TASK_STATE_COMPLETED");
    assert!(snapshot["tasks"][0].get("reportHandle").is_none());
    assert!(!snapshot.to_string().contains(&rig.b.ticket));
}

#[test]
fn local_a2a_input_request_continues_the_same_authoritative_conversation() {
    let rig = Rig::new();
    rig.ready_pair();
    let sent = rig
        .send(&rig.a, &rig.b, "need additional design choice")
        .unwrap();
    let task = rig.assigned(&rig.b);
    rig.report(
        &rig.b,
        &task,
        "inputRequired",
        "Which output format should be used?",
    )
    .unwrap();
    let waiting = rig
        .api(
            &rig.a,
            "a2a.getTask",
            json!({"taskHandle":sent["taskHandle"],"requestId":op()}),
        )
        .unwrap();
    assert_eq!(waiting["terminal"], false);
    assert_eq!(
        waiting["task"]["status"]["state"],
        "TASK_STATE_INPUT_REQUIRED"
    );
    let inbox = rig.local(&rig.a, "a2a.localInbox", json!({})).unwrap();
    let question = inbox["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["text"] == "Which output format should be used?")
        .unwrap();
    assert_eq!(question["questions"][0]["state"], "open");
    let question_message = question["messageId"].clone();
    let continuation = rig
        .api(
            &rig.a,
            "a2a.sendMessage",
            json!({"connectionId":rig.connection(&rig.a,&rig.b),"requestId":op(),
        "taskHandle":sent["taskHandle"],"text":"Use UTF-8 JSON, including the complete answer"}),
        )
        .unwrap();
    assert_eq!(continuation["task"]["id"], sent["task"]["id"]);
    assert_eq!(
        continuation["task"]["status"]["state"],
        "TASK_STATE_WORKING"
    );
    let messages = rig.local(&rig.b, "a2a.localInbox", json!({})).unwrap();
    assert!(
        messages["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["text"] == "Use UTF-8 JSON, including the complete answer")
    );
    let answered = rig
        .local(
            &rig.a,
            "a2a.localInbox",
            json!({"messageId":question_message}),
        )
        .unwrap();
    assert_eq!(answered["messages"][0]["questions"][0]["state"], "replied");
    assert_eq!(
        rig.service
            .board
            .snapshot()
            .iter()
            .filter(|task| task.chat.is_none())
            .count(),
        1
    );
    assert_eq!(
        rig.service
            .board
            .snapshot()
            .iter()
            .filter(|task| task.chat.is_some())
            .count(),
        2
    );
    let full = rig
        .local(
            &rig.b,
            "a2a.localTask",
            json!({"reportHandle":task["reportHandle"]}),
        )
        .unwrap();
    assert!(
        full["task"]["history"]
            .as_array()
            .unwrap()
            .iter()
            .any(|message| message["parts"][0]["text"]
                == "Use UTF-8 JSON, including the complete answer")
    );
    rig.report(&rig.b, &task, "completed", "UTF-8 JSON result completed")
        .unwrap();
    let result = rig
        .api(
            &rig.a,
            "a2a.getTask",
            json!({"taskHandle":sent["taskHandle"],"requestId":op()}),
        )
        .unwrap();
    assert_eq!(result["terminal"], true);
}

#[test]
fn local_a2a_default_and_false_send_wait_for_report_and_bound_history() {
    for immediate in [None, Some(false)] {
        let rig = Arc::new(Rig::new());
        rig.ready_pair();
        let callback = rig.clone();
        let (send, receive) = mpsc::channel();
        let mut params = json!({"message":message("default waiting HTTP send")});
        if let Some(immediate) = immediate {
            params["configuration"] = json!({"returnImmediately":immediate,"historyLength":0});
        }
        let pending = thread::spawn(move || {
            send.send(callback.rpc(&callback.a, &callback.b, "SendMessage", params))
                .unwrap();
        });
        wait_for(|| !rig.service.board.snapshot().is_empty());
        assert!(
            receive.try_recv().is_err(),
            "An unresolved send cannot return a completed body"
        );
        let task = rig.assigned(&rig.b);
        if immediate.is_none() {
            rig.report(
                &rig.b,
                &task,
                "inputRequired",
                "Provide the requested input",
            )
            .unwrap();
        } else {
            rig.report(
                &rig.b,
                &task,
                "completed",
                "explicitly completed waiting task",
            )
            .unwrap();
        }
        let response = receive.recv_timeout(Duration::from_secs(3)).unwrap();
        pending.join().unwrap();
        let task = &response["result"]["task"];
        assert_eq!(
            task["status"]["state"],
            if immediate.is_none() {
                "TASK_STATE_INPUT_REQUIRED"
            } else {
                "TASK_STATE_COMPLETED"
            }
        );
        if immediate.is_none() {
            assert!(task["history"].as_array().unwrap().len() <= 20);
        } else {
            assert!(task.get("history").is_none());
        }
        let bounded = rig.rpc(
            &rig.a,
            &rig.b,
            "GetTask",
            json!({"id":task["id"],"historyLength":1}),
        );
        assert!(bounded["result"]["history"].as_array().unwrap().len() <= 1);
    }
}

#[test]
fn local_a2a_cancel_withdraws_only_queued_direct_tasks_in_both_delivery_modes() {
    for active in [false, true] {
        let rig = Rig::with_inbox(active);
        rig.ready_pair();
        let sent = rig
            .send(&rig.a, &rig.b, "withdraw this queued task")
            .unwrap();
        let task = rig.assigned(&rig.b);
        let canceled = rig
            .api(
                &rig.a,
                "a2a.cancelTask",
                json!({"taskHandle":sent["taskHandle"],"requestId":op()}),
            )
            .unwrap();
        assert_eq!(canceled["task"]["status"]["state"], "TASK_STATE_CANCELED");
        assert_eq!(rig.service.board.snapshot()[0].state, TaskState::Abandoned);
        assert!(
            rig.report(
                &rig.b,
                &task,
                "completed",
                "cannot resurrect withdrawn work"
            )
            .is_err()
        );
        let repeat = rig.rpc(
            &rig.a,
            &rig.b,
            "CancelTask",
            json!({"id":sent["task"]["id"]}),
        );
        assert_eq!(repeat["result"]["status"]["state"], "TASK_STATE_CANCELED");
        if active {
            let inbox = rig.local(&rig.b, "a2a.localInbox", json!({})).unwrap();
            assert!(
                inbox["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|entry| entry["deliveryPhase"] != "pending")
            );
        }
    }
}

#[test]
fn local_a2a_submission_intent_and_working_tasks_are_not_unsafely_canceled() {
    let rig = Rig::new();
    rig.ready_pair();
    let sent = rig.send(&rig.a, &rig.b, "guarded execution").unwrap();
    let task = rig.assigned(&rig.b);
    let (offer, batch) = rig.prepare(&rig.b);
    let begin = rig.begin(offer, &batch);
    let blocked = rig.rpc(
        &rig.a,
        &rig.b,
        "CancelTask",
        json!({"id":sent["task"]["id"]}),
    );
    assert_eq!(blocked["error"]["code"], -32002);
    assert_ne!(rig.service.board.snapshot()[0].state, TaskState::Abandoned);
    rig.finish(&begin);
    rig.report(&rig.b, &task, "working", "running explicit work")
        .unwrap();
    let blocked = rig.rpc(
        &rig.a,
        &rig.b,
        "CancelTask",
        json!({"id":sent["task"]["id"]}),
    );
    assert_eq!(blocked["error"]["code"], -32002);
    rig.report(&rig.b, &task, "completed", "running work completed")
        .unwrap();
}

#[test]
fn local_a2a_canceling_the_http_wait_keeps_the_business_task_unresolved() {
    let rig = Arc::new(Rig::new());
    rig.ready_pair();
    let resolved = rig
        .connections(&rig.a)
        .resolve(&rig.project, &rig.connection(&rig.a, &rig.b))
        .unwrap();
    let client = rig.client.clone();
    let signal = Arc::new(CancelSignal::default());
    let worker_signal = signal.clone();
    let worker = thread::spawn(move || {
        block_on(worker_signal.run(async{
        let response=client.post(resolved.info.interface_url.unwrap()).bearer_auth(resolved.secret.as_ref().unwrap().as_str())
            .header("Content-Type","application/json").header("A2A-Version","1.0")
            .body(json!({"jsonrpc":"2.0","id":"pending-request","method":"SendMessage","params":{"message":message("request cancellation preserves work")}}).to_string()).send().await.unwrap();
        response.bytes().await
    }))
    });
    wait_for(|| !rig.service.board.snapshot().is_empty());
    let started = Instant::now();
    signal.cancel();
    assert!(worker.join().unwrap().is_err());
    assert!(started.elapsed() < Duration::from_secs(1));
    let task = rig.assigned(&rig.b);
    assert_eq!(rig.service.board.snapshot()[0].state, TaskState::Queued);
    let pending = rig.rpc(&rig.a, &rig.b, "GetTask", json!({"id":task["task"]["id"]}));
    assert_eq!(pending["result"]["status"]["state"], "TASK_STATE_SUBMITTED");
    rig.report(
        &rig.b,
        &task,
        "completed",
        "completion after sender stopped waiting",
    )
    .unwrap();
    let done = rig.rpc(&rig.a, &rig.b, "GetTask", json!({"id":task["task"]["id"]}));
    assert_eq!(done["result"]["status"]["state"], "TASK_STATE_COMPLETED");
}

#[test]
fn local_a2a_rejects_context_side_effects_reused_ids_and_wrong_protocol() {
    let rig = Rig::new();
    rig.ready_pair();
    let mut invalid = message("must not create an orphan task");
    invalid["contextId"] = json!("unknown-context");
    let refused = rig.rpc(
        &rig.a,
        &rig.b,
        "SendMessage",
        json!({"message":invalid,"configuration":{"returnImmediately":true}}),
    );
    assert_eq!(refused["error"]["code"], -32602);
    assert!(rig.service.board.snapshot().is_empty());
    let original = message("one accepted message");
    let params =
        json!({"message":original,"configuration":{"returnImmediately":true,"historyLength":0}});
    let first = rig.rpc(&rig.a, &rig.b, "SendMessage", params.clone());
    let second = rig.rpc(&rig.a, &rig.b, "SendMessage", params.clone());
    assert_eq!(first, second);
    assert_eq!(rig.service.board.snapshot().len(), 1);
    let mut changed = params;
    changed["message"]["parts"][0]["text"] = json!("conflicting content");
    assert_eq!(
        rig.rpc(&rig.a, &rig.b, "SendMessage", changed)["error"]["code"],
        -32602
    );
    assert_eq!(rig.service.board.snapshot().len(), 1);
    let unsupported = rig.rpc(
        &rig.a,
        &rig.b,
        "SendMessage",
        json!({"message":{"messageId":op(),"role":"ROLE_USER","parts":[{"data":{}}]}}),
    );
    assert_eq!(unsupported["error"]["code"], -32005);
    assert_eq!(
        rig.rpc(&rig.a, &rig.b, "SendStreamingMessage", json!({}))["error"]["code"],
        -32004
    );
    assert_eq!(
        rig.rpc(
            &rig.a,
            &rig.b,
            "CreateTaskPushNotificationConfig",
            json!({})
        )["error"]["code"],
        -32003
    );
}

#[test]
fn local_a2a_transient_authorization_failure_does_not_finish_the_business_task() {
    let rig = Rig::new();
    rig.ready_pair();
    let connection = rig.connection(&rig.a, &rig.b);
    let target = connection.strip_prefix("local:").unwrap();
    let sent = rig.send(&rig.a, &rig.b, "transient snapshot").unwrap();
    let link = rig
        .service
        .owned_link(&rig.a, target, sent["task"]["id"].as_str().unwrap())
        .unwrap();
    rig.access.1.store(true, Ordering::Release);
    let value = rig.service.task_value(&link, 0).unwrap();
    assert_ne!(
        value["status"]["state"], "TASK_STATE_FAILED",
        "a snapshot lookup failure is not a terminal protocol result"
    );
    assert!(
        value["status"]["message"]["parts"][0]["text"]
            .as_str()
            .unwrap()
            .contains("could not be verified")
    );
    rig.access.1.store(false, Ordering::Release);
}

#[test]
fn local_a2a_wait_capacity_is_bounded_per_owner() {
    let rig = Rig::new();
    rig.ready_pair();
    let mut guards = vec![];
    for _ in 0..4 {
        guards.push(rig.service.begin_wait(&rig.a).unwrap());
    }
    let error = match rig.service.begin_wait(&rig.a) {
        Ok(_) => panic!("the fifth concurrent wait must be rejected"),
        Err(error) => error,
    };
    assert_eq!(code(&error), "A2A_REQUEST_LIMIT");
    guards.pop();
    assert!(rig.service.begin_wait(&rig.a).is_ok());
}

#[test]
fn local_a2a_discovery_and_reports_bind_registry_project_and_exact_instance() {
    let rig = Rig::new();
    assert!(rig.service.connections(&rig.a).unwrap().is_empty());
    rig.ready(&rig.b);
    assert!(rig.service.connections(&rig.a).unwrap().is_empty());
    rig.ready(&rig.a);
    rig.ready(&rig.c);
    let sent = rig.send(&rig.a, &rig.b, "owned assignment").unwrap();
    let task = rig.assigned(&rig.b);
    assert!(
        rig.report(&rig.a, &task, "completed", "not the recipient")
            .is_err()
    );
    assert!(
        rig.report(&rig.c, &task, "failed", "not the recipient")
            .is_err()
    );
    let mut wrong = json!({"reportHandle":task["reportHandle"],"generation":2,"state":"completed","text":"wrong generation","operationId":op()});
    assert_eq!(
        code(
            &rig.local(&rig.b, "a2a.localReport", wrong.clone())
                .unwrap_err()
        ),
        "A2A_LOCAL_TASK_CHANGED"
    );
    wrong["generation"] = task["generation"].clone();
    wrong["owner"] = json!("forged");
    assert_eq!(
        code(&rig.local(&rig.b, "a2a.localReport", wrong).unwrap_err()),
        "A2A_ARGUMENT_INVALID"
    );
    let info = rig
        .connections(&rig.a)
        .resolve(&rig.project, &rig.connection(&rig.a, &rig.b))
        .unwrap();
    let bearer = info.secret.unwrap();
    let mut registry = rig.service.registry.all();
    registry.retain(|entry| entry.tab_id != rig.b.tab_id);
    rig.service.registry.replace(registry);
    assert!(
        rig.service
            .connections(&rig.a)
            .unwrap()
            .iter()
            .all(|info| info.local.as_ref().unwrap().tab_id != rig.b.tab_id)
    );
    assert!(
        rig.service
            .target(&rig.a, info.info.id.strip_prefix("local:").unwrap())
            .is_err()
    );
    rig.service
        .registry
        .replace([&rig.a, &rig.b, &rig.c].into_iter().map(session).collect());
    rig.access.0.lock().unwrap().retain(|owner| owner != &rig.b);
    rig.service.revoke(&rig.b.ticket);
    let mut replacement = rig.b.clone();
    replacement.ticket = "synthetic-new-ticket-b".into();
    replacement.terminal_id = "synthetic-new-pty-b".into();
    rig.access.0.lock().unwrap().push(replacement.clone());
    rig.ready(&replacement);
    assert!(
        rig.report(&rig.b, &task, "completed", "old instance cannot report")
            .is_err()
    );
    assert!(
        rig.report(
            &replacement,
            &task,
            "completed",
            "new instance cannot use an old handle"
        )
        .is_err()
    );
    let current = rig
        .local(&replacement, "a2a.localTasks", json!({}))
        .unwrap();
    assert_ne!(current["tasks"][0]["reportHandle"], task["reportHandle"]);
    let old = rig
        .service
        .owned_link(
            &rig.a,
            info.info.id.strip_prefix("local:").unwrap(),
            sent["task"]["id"].as_str().unwrap(),
        )
        .unwrap();
    assert_eq!(
        rig.service.task_value(&old, 0).unwrap()["status"]["state"],
        "TASK_STATE_FAILED"
    );
    assert_eq!(rig.service.board.snapshot()[0].state, TaskState::Queued);
    rig.access.0.lock().unwrap().retain(|owner| owner != &rig.a);
    rig.service.revoke(&rig.a.ticket);
    assert!(rig.service.authenticate(&bearer).is_err());
    let mut pi = rig.c.clone();
    pi.agent = AgentKind::Pi;
    rig.access.0.lock().unwrap().push(pi.clone());
    let mut registered = rig.service.registry.all();
    registered.retain(|session| session.tab_id != pi.tab_id);
    registered.push(session(&pi));
    rig.service.registry.replace(registered);
    assert_eq!(
        rig.local(&pi, "a2a.localReady", json!({})).unwrap()["ready"],
        false
    );
}

#[test]
fn local_a2a_http_health_origin_bearer_and_version_checks_are_real() {
    let rig = Rig::new();
    rig.ready_pair();
    let resolved = rig
        .connections(&rig.a)
        .resolve(&rig.project, &rig.connection(&rig.a, &rig.b))
        .unwrap();
    block_on(async {
        let health = rig
            .client
            .get(format!("{}/health", rig.service.origin))
            .send()
            .await
            .unwrap();
        assert_eq!(health.status().as_u16(), 200);
        let body: Value = serde_json::from_slice(&health.bytes().await.unwrap()).unwrap();
        assert_eq!(
            body,
            json!({"ready":true,"protocolVersion":"1.0","protocolBinding":"JSONRPC"})
        );
        let card = &resolved.info.card_url;
        assert_eq!(
            rig.client.get(card).send().await.unwrap().status().as_u16(),
            401
        );
        assert_eq!(
            rig.client
                .get(card)
                .bearer_auth("invalid-token")
                .send()
                .await
                .unwrap()
                .status()
                .as_u16(),
            401
        );
        assert_eq!(
            rig.client
                .get(card)
                .header("Origin", "https://foreign-origin.example")
                .send()
                .await
                .unwrap()
                .status()
                .as_u16(),
            403
        );
        assert_eq!(
            rig.client
                .get(card)
                .header("Host", "foreign-origin.example")
                .send()
                .await
                .unwrap()
                .status()
                .as_u16(),
            403
        );
        assert_eq!(
            rig.client
                .get(card)
                .header(
                    "Authorization",
                    format!("bearer {}", resolved.secret.as_ref().unwrap().as_str())
                )
                .send()
                .await
                .unwrap()
                .status()
                .as_u16(),
            200
        );
        let valid=rig.client.post(resolved.info.interface_url.as_ref().unwrap()).bearer_auth(resolved.secret.as_ref().unwrap().as_str()).header("Content-Type","Application/JSON; charset=utf-8").header("A2A-Version","1.0")
            .body(json!({"jsonrpc":"2.0","id":"case-insensitive-mime","method":"GetTask","params":{"id":"not-found"}}).to_string()).send().await.unwrap();
        assert_eq!(valid.status().as_u16(), 200);
        let body: Value = serde_json::from_slice(&valid.bytes().await.unwrap()).unwrap();
        assert_eq!(body["error"]["code"], -32001);
        let response=rig.client.post(resolved.info.interface_url.as_ref().unwrap()).bearer_auth(resolved.secret.as_ref().unwrap().as_str()).header("Content-Type","application/json")
            .body(json!({"jsonrpc":"2.0","id":"wrong-version","method":"GetTask","params":{"id":"not-found"}}).to_string()).send().await.unwrap();
        let body: Value = serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
        assert_eq!(body["error"]["code"], -32009);
    });
}

#[test]
fn local_a2a_real_http_rejects_cross_project_access_without_business_writes() {
    let rig = Rig::new();
    std::fs::create_dir_all(rig.root.join("other-project")).unwrap();
    let mut other = rig.c.clone();
    other.root = crate::resource::canonicalize(&rig.root.join("other-project"))
        .unwrap()
        .to_str()
        .unwrap()
        .into();
    let mut peer = other.clone();
    peer.tab_id = "d".into();
    peer.ticket = "synthetic-ticket-d".into();
    peer.terminal_id = "synthetic-pty-d".into();
    *rig.access.0.lock().unwrap() = vec![rig.a.clone(), rig.b.clone(), other.clone(), peer.clone()];
    rig.service.registry.replace(
        [&rig.a, &rig.b, &other, &peer]
            .into_iter()
            .map(session)
            .collect(),
    );
    for owner in [&other, &peer] {
        rig.gate.register(
            &owner.terminal_id,
            Some(owner.tab_id.clone()),
            owner.root.clone().into(),
        );
        rig.gate
            .observe_output(&owner.terminal_id, 1, b"\x1b[?2004h");
    }
    for owner in [&rig.a, &rig.b, &other, &peer] {
        rig.ready(owner);
    }
    // Seed direct authorities before these pairs share a room; subsequent
    // ordinary sends between room members correctly use the room task board.
    let first_task = rig.send(&rig.a, &rig.b, "Existing project A task").unwrap();
    let second_task = rig.send(&other, &peer, "Existing project B task").unwrap();
    let mut rooms = Vec::new();
    for (sender, recipient) in [(&rig.a, &rig.b), (&other, &peer)] {
        let room = rig
            .service
            .rooms
            .create(
                &format!("Scope {}", sender.tab_id),
                &sender.root,
                "Isolation fixture",
            )
            .unwrap();
        rig.service
            .rooms
            .mutate(&room.id, |room| {
                ops::add_member(
                    room,
                    &sender.tab_id,
                    sender.agent.id(),
                    "lead",
                    "coordinate",
                    false,
                    0,
                )?;
                ops::add_member(
                    room,
                    &recipient.tab_id,
                    recipient.agent.id(),
                    "worker",
                    "implement",
                    false,
                    0,
                )?;
                ops::task_add(
                    room,
                    &RoomActor::User,
                    "Existing room task",
                    None,
                    Some("worker"),
                    &[],
                    0,
                )?;
                ops::say(
                    room,
                    &RoomActor::User,
                    &["worker".into()],
                    "Existing scoped room message",
                    None,
                    false,
                    0,
                )
                .map(|_| ())
            })
            .unwrap();
        rooms.push(room.id);
    }
    rig.service.inbox.sync().unwrap();
    let first = rig
        .connections(&rig.a)
        .resolve(&rig.a.root, &rig.connection(&rig.a, &rig.b))
        .unwrap();
    let second = rig
        .connections(&other)
        .resolve(&other.root, &rig.connection(&other, &peer))
        .unwrap();
    let business_state = || {
        let inbox = [&rig.a.root, &other.root].into_iter().map(|root| {
            rig.service.inbox.sessions(root, None).unwrap().sessions.into_iter().map(|session| {
                json!({"sessionKey":session.session_key,"messages":rig.service.inbox.messages(&session.session_key,None,None,Some(100),None).unwrap().messages})
            }).collect::<Vec<_>>()
        }).collect::<Vec<_>>();
        json!({"taskBoard":rig.service.board.snapshot(),"rooms":rig.service.rooms.inbox_snapshot().unwrap(),"inbox":inbox,"gatewayTasks":rig.service.state.lock().unwrap().tasks.len()})
    };
    let before = business_state();
    assert_eq!(before["taskBoard"].as_array().unwrap().len(), 2);
    assert!(
        before["rooms"][0]
            .as_array()
            .unwrap()
            .iter()
            .all(|room| !room["deliveryOutbox"].as_array().unwrap().is_empty())
    );
    assert!(before["inbox"].as_array().unwrap().iter().all(|sessions| {
        sessions
            .as_array()
            .unwrap()
            .iter()
            .any(|session| !session["messages"].as_array().unwrap().is_empty())
    }));
    block_on(async {
        // Both credentials first succeed against their own live project Card.
        for connection in [&first, &second] {
            let reply = rig
                .client
                .get(&connection.info.card_url)
                .bearer_auth(connection.secret.as_ref().unwrap().as_str())
                .send()
                .await
                .unwrap();
            assert_eq!(reply.status().as_u16(), 200);
            let card: Value = serde_json::from_slice(&reply.bytes().await.unwrap()).unwrap();
            assert_eq!(card["supportedInterfaces"][0]["protocolVersion"], "1.0");
        }
        for (credential, foreign, task, room) in [
            (&first, &second, &second_task, &rooms[1]),
            (&second, &first, &first_task, &rooms[0]),
        ] {
            // Send directly to the foreign URLs with a valid bearer. These
            // requests bypass ScopedConnections and exercise Gateway routing.
            let bearer = credential.secret.as_ref().unwrap().as_str();
            let card = rig
                .client
                .get(&foreign.info.card_url)
                .bearer_auth(bearer)
                .send()
                .await
                .unwrap();
            assert_eq!(card.status().as_u16(), 404);
            let denied: Value = serde_json::from_slice(&card.bytes().await.unwrap()).unwrap();
            assert!(denied.get("supportedInterfaces").is_none());
            let message = json!({"messageId":op(),"role":"ROLE_USER","parts":[{"text":"Cross project write must be rejected"}]});
            let mut room_message = message.clone();
            room_message["messageId"] = json!(op());
            room_message["metadata"] =
                json!({"belfryRoom":{"room":room,"title":"Rejected cross project assignment"}});
            for (method, params) in [
                (
                    "SendMessage",
                    json!({"message":message,"configuration":{"returnImmediately":true}}),
                ),
                (
                    "SendMessage",
                    json!({"message":room_message,"configuration":{"returnImmediately":true}}),
                ),
                (
                    "GetTask",
                    json!({"id":task["task"]["id"],"historyLength":20}),
                ),
                ("CancelTask", json!({"id":task["task"]["id"]})),
            ] {
                let id = op();
                let reply = rig
                    .client
                    .post(foreign.info.interface_url.as_ref().unwrap())
                    .bearer_auth(bearer)
                    .header("A2A-Version", "1.0")
                    .header("Content-Type", "application/json")
                    .body(
                        json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
                            .to_string(),
                    )
                    .send()
                    .await
                    .unwrap();
                assert_eq!(reply.status().as_u16(), 200, "{method}");
                let denied: Value = serde_json::from_slice(&reply.bytes().await.unwrap()).unwrap();
                assert_eq!(denied["id"], id);
                assert_eq!(denied["error"]["code"], -32001, "{method}: {denied}");
                assert!(denied.get("result").is_none(), "{method}: {denied}");
            }
        }
    });
    assert_eq!(
        business_state(),
        before,
        "Rejected HTTP access must preserve tasks, room outboxes, inbox entries and Gateway links"
    );
}

#[test]
fn local_a2a_cross_project_agents_and_forged_discovery_fields_are_rejected() {
    let rig = Rig::new();
    rig.ready_pair();
    rig.ready(&rig.c);
    let old = rig.connection(&rig.a, &rig.c);
    std::fs::create_dir_all(rig.root.join("other-project")).unwrap();
    let mut other = rig.c.clone();
    other.root = crate::resource::canonicalize(&rig.root.join("other-project"))
        .unwrap()
        .to_str()
        .unwrap()
        .into();
    rig.access
        .0
        .lock()
        .unwrap()
        .retain(|owner| owner.tab_id != other.tab_id);
    rig.access.0.lock().unwrap().push(other.clone());
    let mut registry = rig.service.registry.all();
    registry.retain(|session| session.tab_id != other.tab_id);
    registry.push(session(&other));
    rig.service.registry.replace(registry);
    rig.ready(&other);
    let listed = rig.service.connections(&rig.a).unwrap();
    assert!(
        listed
            .iter()
            .all(|connection| connection.local.as_ref().unwrap().tab_id != other.tab_id)
    );
    assert!(
        rig.api(
            &rig.a,
            "a2a.sendMessage",
            json!({"connectionId":old,"requestId":op(),"text":"must remain isolated"})
        )
        .is_err()
    );
    assert!(
        rig.service
            .target(&rig.a, old.strip_prefix("local:").unwrap())
            .is_err()
    );
    assert!(rig.service.board.snapshot().is_empty());
    assert_eq!(
        rig.local(&other, "a2a.localAgents", json!({})).unwrap()["agents"],
        json!([])
    );
    assert!(
        rig.local(
            &rig.a,
            "a2a.localAgents",
            json!({"workspace":other.root,"sessionId":other.ticket})
        )
        .is_err()
    );
    let draft=serde_json::from_value(json!({"name":"Synthetic external config","cardUrl":"http://127.0.0.1:43210/card","auth":{"kind":"none","credential":{"action":"clear"}}})).unwrap();
    rig.runtime.save(&rig.store, &rig.project, &draft).unwrap();
    let path = rig.root.join("client-store/connections.json");
    let mut metadata: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    metadata["connections"][0]["info"]["local"] =
        json!({"tabId":"forged-tab","agent":"codex","ready":true});
    std::fs::write(&path, metadata.to_string()).unwrap();
    assert!(
        rig.api(&rig.a, "a2a.connections", json!({})).is_err(),
        "persisted external metadata cannot impersonate local readiness"
    );
}

#[test]
fn host_restart_restores_readiness_for_the_same_live_terminal_only() {
    let rig = Rig::new();
    rig.ready_pair();
    let sent = rig
        .send(&rig.a, &rig.b, "survives restart")
        .expect("initial send");
    let task = rig.assigned(&rig.b);
    rig.report(&rig.b, &task, "working", "still working after restart")
        .expect("working report");
    // A new host process loses the in-memory ticket records but reloads the
    // persisted marks; the daemon terminal and its CLI stay alive.
    let restarted = Service::start(
        rig.access.clone(),
        rig.service.registry.clone(),
        rig.service.board.clone(),
        rig.service.rooms.clone(),
        rig.service.inbox.clone(),
        ReadyMarks::load(Some(rig.ready.clone())),
        LinkPreviews::load(Some(rig.links.clone())),
    )
    .unwrap();
    // The protocol link itself is intentionally instance-bound, but the last
    // public preview survives in the app data directory.
    let previews = restarted.snapshot(&rig.project).unwrap();
    let preview = previews["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|preview| {
            preview["taskRef"]["id"] == sent["task"]["metadata"]["belfry"]["taskRef"]["id"]
        })
        .expect("persisted protocol preview after restart");
    assert_eq!(preview["state"], "TASK_STATE_WORKING");
    assert_eq!(preview["text"], "still working after restart");
    assert_eq!(preview["source"], "localA2A");
    let reattached = AuthorizedAgent {
        ticket: "restarted-ticket-a".into(),
        ..rig.a.clone()
    };
    let second = AuthorizedAgent {
        ticket: "restarted-ticket-b".into(),
        ..rig.b.clone()
    };
    *rig.access.0.lock().unwrap() = vec![reattached.clone(), second.clone(), rig.c.clone()];

    // Discovery advertises both reattached instances without another tools/list.
    let agents = restarted.discovery(&rig.project, None).unwrap();
    let tabs: Vec<_> = agents["agents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|connection| connection["local"]["tabId"].as_str().unwrap().to_string())
        .collect();
    assert!(tabs.contains(&rig.a.tab_id));
    assert!(tabs.contains(&rig.b.tab_id));
    assert!(
        !tabs.contains(&rig.c.tab_id),
        "an unready agent must not be advertised"
    );

    // A different PEER can resolve the restored instance and address it.
    let connection = restarted
        .connections(&second)
        .unwrap()
        .into_iter()
        .find(|info| {
            info.local
                .as_ref()
                .is_some_and(|local| local.tab_id == reattached.tab_id)
        })
        .expect("restored instance is visible to peers");
    assert!(connection.local.unwrap().ready);
    assert!(restarted.resolve(&second, &connection.id).is_ok());

    // A replaced process in the same tab never read the directory; its marker
    // must not survive just because the front-end tab did.
    let replaced = AuthorizedAgent {
        ticket: "replaced-ticket-a".into(),
        terminal_id: "replaced-pty-a".into(),
        ..reattached
    };
    *rig.access.0.lock().unwrap() = vec![replaced, second, rig.c.clone()];
    let agents = restarted.discovery(&rig.project, None).unwrap();
    assert!(
        !agents["agents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|connection| {
                connection["local"]["tabId"].as_str() == Some(rig.a.tab_id.as_str())
            }),
        "readiness is tied to the daemon terminal, not the tab"
    );
}
