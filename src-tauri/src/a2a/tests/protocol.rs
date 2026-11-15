use serde_json::{Value, json};
use tauri::async_runtime::block_on;

use super::super::{
    card as card_validation, client, contracts::ConnectionDraft, requests::Owner, validation,
};
use super::fixture::*;

#[test]
fn a2a_card_skips_invalid_interfaces_instead_of_rejecting_the_whole_card() {
    let server = Server::new(|base, request| {
        if request.method == "GET" {
            let mut value = card(base);
            value["supportedInterfaces"] = json!([
                {"url":"http://example.com/rpc", "protocolBinding":"JSONRPC", "protocolVersion":"1.0"},
                {"url":format!("{base}/rpc"), "protocolBinding":"JSONRPC", "protocolVersion":"1.0", "tenant":"fixture-tenant"}
            ]);
            return Reply::json(value);
        }
        Reply::failure(request, -32601)
    });
    let fixture = Fixture::new();
    let info = fixture.save(&draft(&server.base, "none", None));
    let discovery = block_on(fixture.runtime.agent_card(
        &fixture.store,
        &fixture.owner,
        &info.id,
        &request_id(),
    ))
    .unwrap();
    assert_eq!(discovery.interfaces.len(), 1);
    assert_eq!(
        discovery.selected_interface.unwrap().url,
        format!("{}/rpc", server.base)
    );
    assert!(discovery.issue.is_none());
}

#[test]
fn a2a_skill_only_security_does_not_block_a_public_card() {
    let server = Server::new(|base, request| {
        if request.method == "GET" {
            let mut value = card(base);
            value["securitySchemes"] = json!({
                "oauth": {"oauth2SecurityScheme": {"flows": {}}}
            });
            value["skills"] = json!([{
                "id":"private", "name":"Private", "description":"needs oauth",
                "tags":["private"],
                "securityRequirements":[{"schemes":{"oauth":{"list":[]}}}]
            }]);
            return Reply::json(value);
        }
        Reply::failure(request, -32601)
    });
    let fixture = Fixture::new();
    let info = fixture.save(&draft(&server.base, "none", None));
    let discovery = block_on(fixture.runtime.agent_card(
        &fixture.store,
        &fixture.owner,
        &info.id,
        &request_id(),
    ))
    .unwrap();
    assert!(
        discovery.issue.is_none(),
        "SendMessage has no skill selector, so a skill-only requirement must not block the card"
    );
}

#[test]
fn a2a_interface_tenant_disambiguates_interfaces_with_the_same_url() {
    let server = Server::new(|base, request| {
        if request.method == "GET" {
            let mut value = card(base);
            value["supportedInterfaces"] = json!([
                {"url":format!("{base}/rpc"), "protocolBinding":"JSONRPC", "protocolVersion":"1.0", "tenant":"one"},
                {"url":format!("{base}/rpc"), "protocolBinding":"JSONRPC", "protocolVersion":"1.0", "tenant":"two"}
            ]);
            return Reply::json(value);
        }
        Reply::failure(request, -32601)
    });
    let fixture = Fixture::new();
    let mut config = draft(&server.base, "none", None);
    config.interface_url = Some(format!("{}/rpc", server.base));
    config.interface_tenant = Some("two".into());
    let info = fixture.save(&config);
    let discovery = block_on(fixture.runtime.agent_card(
        &fixture.store,
        &fixture.owner,
        &info.id,
        &request_id(),
    ))
    .unwrap();
    assert_eq!(
        discovery.selected_interface.unwrap().tenant.as_deref(),
        Some("two")
    );

    let mut missing = draft(&server.base, "none", None);
    missing.interface_url = Some(format!("{}/rpc", server.base));
    missing.interface_tenant = Some("missing".into());
    let info = fixture.save(&missing);
    let discovery = block_on(fixture.runtime.agent_card(
        &fixture.store,
        &fixture.owner,
        &info.id,
        &request_id(),
    ))
    .unwrap();
    assert_eq!(discovery.issue.unwrap().code, "A2A_NO_COMPATIBLE_INTERFACE");
}

#[test]
fn a2a_explicit_rpc_rejection_is_a_known_send_outcome() {
    let server = Server::standard();
    let fixture = Fixture::new();
    let info = fixture.save(&draft(&server.base, "none", None));
    let failure = block_on(fixture.runtime.send_message(
        &fixture.store,
        &fixture.owner,
        &info.id,
        &request_id(),
        "reject",
        None,
    ))
    .err()
    .unwrap();
    assert_eq!(code(&failure), "A2A_RPC_ERROR");
    let details = failure.details.unwrap();
    assert_eq!(details["rpcCode"], -32602);
    assert_eq!(
        details["outcomeUnknown"], false,
        "a parsed JSON-RPC error is a definite rejection, not an unknown send"
    );
}

#[test]
fn a2a_short_caches_reuse_the_card_and_decrypted_connection() {
    let server = Server::standard();
    let fixture = Fixture::new();
    let info = fixture.save(&draft(&server.base, "bearer", Some("fixture-key")));
    let reads = fixture
        .keys
        .reads
        .load(std::sync::atomic::Ordering::Acquire);
    for _ in 0..2 {
        block_on(fixture.runtime.agent_card(
            &fixture.store,
            &fixture.owner,
            &info.id,
            &request_id(),
        ))
        .unwrap();
    }
    let gets = server
        .requests
        .lock()
        .unwrap()
        .iter()
        .filter(|request| request.method == "GET")
        .count();
    assert_eq!(gets, 1, "the second card read should use the short cache");
    let after = fixture
        .keys
        .reads
        .load(std::sync::atomic::Ordering::Acquire);
    assert_eq!(
        after - reads,
        1,
        "the second connection resolve should reuse the decrypted secret"
    );
}

#[test]
fn a2a_large_task_history_is_bounded_before_the_bridge() {
    let history: Vec<Value> = (0..20)
        .map(|index| {
            json!({
                "messageId": format!("m{index}"),
                "role": "ROLE_AGENT",
                "parts": [{"text": "x".repeat(50_000)}],
            })
        })
        .collect();
    let task = json!({
        "id": "large-task",
        "status": {"state": "TASK_STATE_WORKING"},
        "history": history,
    });
    let bounded = crate::a2a::runtime::bound_task_history(task);
    assert!(serde_json::to_vec(&bounded).unwrap().len() < crate::a2a::runtime::MAX_PUBLIC_TASK);
    assert_eq!(bounded["metadata"]["belfryTruncated"]["history"], true);
    assert!(bounded["history"].as_array().unwrap().len() < 20);
    assert!(bounded["status"].is_object());
}

#[test]
fn a2a_platform_envelope_rejects_oversized_results_instead_of_dropping_them() {
    let oversized = crate::a2a::platform::envelope(Ok(json!({"text":"x".repeat(1024 * 1024)})));
    assert_eq!(oversized["ok"], false);
    assert_eq!(oversized["error"]["code"], "A2A_RESPONSE_LIMIT");
    let small = crate::a2a::platform::envelope(Ok(json!({"ok": true})));
    assert_eq!(small["ok"], true);
}

#[test]
fn a2a_http_fixture_accepts_fragmented_request_headers() {
    use std::{
        io::{Read, Write},
        net::TcpStream,
        thread,
        time::Duration,
    };
    let server = Server::standard();
    let mut client = TcpStream::connect(server.base.strip_prefix("http://").unwrap()).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    client.write_all(b"GET /.well-known/agent").unwrap();
    thread::sleep(Duration::from_millis(30));
    let host = server.base.strip_prefix("http://").unwrap();
    let _ = client.write_all(format!("-card.json HTTP/1.1\r\nHost: {host}\r\n\r\n").as_bytes());
    let mut response = Vec::new();
    let result = client.read_to_end(&mut response);
    assert!(
        response.starts_with(b"HTTP/1.1 200 "),
        "fragmented fixture request failed: bytes={}, read={:?}",
        response.len(),
        result.err().map(|error| error.kind())
    );
}

#[test]
fn a2a_http_discovery_send_get_followup_message_and_cancel_use_the_v1_binding() {
    let server = Server::standard();
    let fixture = Fixture::new();
    let info = fixture.save(&draft(&server.base, "none", None));
    let discovery = block_on(fixture.runtime.agent_card(
        &fixture.store,
        &fixture.owner,
        &info.id,
        &request_id(),
    ))
    .unwrap();
    assert!(discovery.issue.is_none());
    assert_eq!(discovery.interfaces.len(), 1);
    assert_eq!(
        discovery.selected_interface.unwrap().tenant.as_deref(),
        Some("fixture-tenant")
    );
    let send = |text: &str, handle: Option<&str>| {
        reply_value(
            block_on(fixture.runtime.send_message(
                &fixture.store,
                &fixture.owner,
                &info.id,
                &request_id(),
                text,
                handle,
            ))
            .unwrap(),
        )
    };
    let reply = send("working", None);
    assert_eq!(reply["kind"], "task");
    assert_eq!(reply["terminal"], false);
    let handle = reply["taskHandle"].as_str().unwrap();
    let done = reply_value(
        block_on(fixture.runtime.task(
            &fixture.store,
            &fixture.owner,
            handle,
            &request_id(),
            false,
            0,
        ))
        .unwrap(),
    );
    assert_eq!(done["taskHandle"], handle);
    assert_eq!(done["terminal"], true);
    assert_eq!(
        done["task"]["artifacts"][0]["parts"][0]["text"],
        "completed result"
    );
    let message = send("instant", None);
    assert_eq!(message["kind"], "message");
    assert!(message.get("taskHandle").is_none());
    assert!(
        message["message"].get("contextId").is_none(),
        "contextId is optional"
    );
    let interrupted = send("input", None);
    assert_eq!(interrupted["terminal"], false);
    let interrupted_handle = interrupted["taskHandle"].as_str().unwrap();
    let resumed = send("follow-up", Some(interrupted_handle));
    assert_eq!(resumed["terminal"], true);
    assert_eq!(
        resumed["task"]["artifacts"][0]["parts"][1]["data"],
        Value::Null
    );
    let canceled_task = send("working", None);
    let canceled = reply_value(
        block_on(fixture.runtime.task(
            &fixture.store,
            &fixture.owner,
            canceled_task["taskHandle"].as_str().unwrap(),
            &request_id(),
            true,
            0,
        ))
        .unwrap(),
    );
    assert_eq!(canceled["task"]["status"]["state"], "TASK_STATE_CANCELED");
    assert_eq!(canceled["terminal"], true);
    let requests = server.requests.lock().unwrap();
    for request in requests.iter() {
        assert_eq!(request.headers.get("a2a-version").unwrap(), "1.0");
        if request.method == "POST" {
            assert_eq!(request.path, "/rpc");
            assert_eq!(
                request.headers.get("content-type").unwrap(),
                "application/json"
            );
            assert_eq!(request.body["params"]["tenant"], "fixture-tenant");
            assert!(request.body["id"].is_string());
            match request.body["method"].as_str().unwrap() {
                "SendMessage" => {
                    assert_eq!(request.body["params"]["message"]["role"], "ROLE_USER");
                    assert!(
                        request.body["params"]["message"]["parts"][0]
                            .get("kind")
                            .is_none()
                    );
                    assert_eq!(
                        request.body["params"]["configuration"]["returnImmediately"],
                        true
                    );
                    assert_eq!(request.body["params"]["configuration"]["historyLength"], 0);
                    if request.body["params"]["message"]["parts"][0]["text"] == "follow-up" {
                        assert_eq!(request.body["params"]["message"]["taskId"], "input-task");
                        assert_eq!(
                            request.body["params"]["message"]["contextId"],
                            "input-context"
                        );
                    }
                }
                "GetTask" => assert_eq!(request.body["params"]["historyLength"], 0),
                "CancelTask" => assert!(request.body["params"].get("historyLength").is_none()),
                other => panic!("unexpected RPC {other}"),
            }
        }
    }
    assert!(
        requests
            .iter()
            .all(|request| !request.path.contains("never-download"))
    );
}

#[test]
fn a2a_http_static_authentication_is_sent_only_to_its_configured_origin() {
    for (kind, header, secret) in [
        ("bearer", "authorization", "synthetic-bearer"),
        ("apiKey", "x-api-key", "synthetic-api-key"),
    ] {
        let auth_kind = kind.to_owned();
        let server = Server::new(move |base, request| {
            let expected = if auth_kind == "bearer" {
                "Bearer synthetic-bearer"
            } else {
                "synthetic-api-key"
            };
            if request.headers.get(header).map(String::as_str) != Some(expected) {
                return Reply::status(401);
            }
            if request.method == "GET" {
                let mut value = card(base);
                value["securitySchemes"] = if auth_kind == "bearer" {
                    json!({"auth":{"httpAuthSecurityScheme":{"scheme":"bearer"}}})
                } else {
                    json!({"auth":{"apiKeySecurityScheme":{"location":"header", "name":"X-API-Key"}}})
                };
                value["securityRequirements"] = json!([{"schemes":{"auth":{"list":[]}}}]);
                Reply::json(value)
            } else {
                Reply::rpc(
                    request,
                    json!({"task":task("auth-task", "TASK_STATE_WORKING")}),
                )
            }
        });
        let fixture = Fixture::new();
        let info = fixture.save(&draft(&server.base, kind, Some(secret)));
        block_on(fixture.runtime.send_message(
            &fixture.store,
            &fixture.owner,
            &info.id,
            &request_id(),
            "authenticated",
            None,
        ))
        .unwrap();
        assert_eq!(server.requests.lock().unwrap().len(), 2);
        assert!(!serde_json::to_string(&info).unwrap().contains(secret));
    }
    let target = Server::standard();
    let rpc_url = format!("{}/rpc", target.base);
    let target_card = card(&target.base);
    let source = Server::new(move |_, request| {
        assert!(!request.headers.contains_key("authorization"));
        Reply::json(target_card.clone())
    });
    let fixture = Fixture::new();
    let mut config = draft(&source.base, "bearer", Some("synthetic-cross-origin"));
    config.interface_url = Some(rpc_url);
    let info = fixture.save(&config);
    block_on(fixture.runtime.send_message(
        &fixture.store,
        &fixture.owner,
        &info.id,
        &request_id(),
        "working",
        None,
    ))
    .unwrap();
    assert_eq!(source.requests.lock().unwrap().len(), 1);
    let target_requests = target.requests.lock().unwrap();
    assert_eq!(target_requests.len(), 1);
    assert_eq!(
        target_requests[0].headers.get("authorization").unwrap(),
        "Bearer synthetic-cross-origin"
    );
}

#[test]
fn a2a_http_successful_credential_reflections_are_redacted_without_changing_private_routing() {
    const SECRET: &str = "synthetic-reflected-credential";
    let server = Server::new(|base, request| {
        assert_eq!(
            request.headers.get("authorization").map(String::as_str),
            Some("Bearer synthetic-reflected-credential")
        );
        if request.method == "GET" {
            let mut value = card(base);
            value["description"] = json!(format!("description {SECRET}"));
            value["supportedInterfaces"][1]["tenant"] = json!(SECRET);
            value["metadata"] = json!({SECRET: {"nested":[SECRET]}});
            return Reply::json(value);
        }
        assert_eq!(request.body["params"]["tenant"], SECRET);
        if request.body["params"]["message"]["parts"][0]["text"] == "instant" {
            return Reply::rpc(
                request,
                json!({"message":{
                    "messageId":"instant-reflection", "role":"ROLE_AGENT",
                    "parts":[{"text":SECRET}, {"data":{SECRET:SECRET}}]
                }}),
            );
        }
        let remote_id = format!("task-{SECRET}");
        let state = match request.body["method"].as_str().unwrap() {
            "SendMessage" => {
                if let Some(id) = request.body["params"]["message"].get("taskId") {
                    assert_eq!(id, &remote_id);
                    assert_eq!(request.body["params"]["message"]["contextId"], SECRET);
                }
                "TASK_STATE_INPUT_REQUIRED"
            }
            "GetTask" => {
                assert_eq!(request.body["params"]["id"], remote_id);
                "TASK_STATE_INPUT_REQUIRED"
            }
            "CancelTask" => {
                assert_eq!(request.body["params"]["id"], remote_id);
                "TASK_STATE_CANCELED"
            }
            _ => unreachable!(),
        };
        let mut value = task(&remote_id, state);
        value["contextId"] = json!(SECRET);
        value["status"]["message"] =
            json!({"messageId":"status", "role":"ROLE_AGENT", "parts":[{"text":SECRET}]});
        value["artifacts"] = json!([{"artifactId":"reflection", "parts":[{"text":SECRET}, {"data":{SECRET:[SECRET]}}]}]);
        if request.body["method"] == "SendMessage" {
            Reply::rpc(request, json!({"task":value}))
        } else {
            Reply::rpc(request, value)
        }
    });
    let fixture = Fixture::new();
    let config = draft(&server.base, "bearer", Some(SECRET));
    let info = fixture.save(&config);
    let probe = block_on(fixture.runtime.probe(
        &fixture.store,
        &fixture.owner,
        &config,
        &request_id(),
    ))
    .unwrap();
    assert!(!serde_json::to_string(&probe).unwrap().contains(SECRET));
    let discovered = block_on(fixture.runtime.agent_card(
        &fixture.store,
        &fixture.owner,
        &info.id,
        &request_id(),
    ))
    .unwrap();
    assert!(!serde_json::to_string(&discovered).unwrap().contains(SECRET));
    let send = |text, handle| {
        let reply = reply_value(
            block_on(fixture.runtime.send_message(
                &fixture.store,
                &fixture.owner,
                &info.id,
                &request_id(),
                text,
                handle,
            ))
            .unwrap(),
        );
        assert!(!reply.to_string().contains(SECRET));
        reply
    };
    let sent = send("work", None);
    let handle = sent["taskHandle"].as_str().unwrap();
    send("continue", Some(handle));
    send("instant", None);
    for cancel in [false, true] {
        let reply = reply_value(
            block_on(fixture.runtime.task(
                &fixture.store,
                &fixture.owner,
                handle,
                &request_id(),
                cancel,
                0,
            ))
            .unwrap(),
        );
        assert!(!reply.to_string().contains(SECRET));
        assert_eq!(reply["taskHandle"], handle);
    }
}

#[test]
fn a2a_card_selection_authentication_and_required_extensions_are_explicit() {
    let fixture = Fixture::new();
    let info = fixture.save(&draft("https://example.invalid", "none", None));
    let resolved = fixture
        .store
        .resolve(&fixture.owner.root, &info.id)
        .unwrap();
    let mut value = card("https://different.invalid");
    let discovery = card_validation::discover(value.clone(), &resolved).unwrap();
    assert!(discovery.selected_interface.is_none());
    assert_eq!(
        discovery.issue.unwrap().code,
        "A2A_INTERFACE_SELECTION_REQUIRED"
    );
    value["supportedInterfaces"][1]["protocolVersion"] = json!("0.3");
    assert_eq!(
        card_validation::discover(value, &resolved)
            .unwrap()
            .issue
            .unwrap()
            .code,
        "A2A_NO_COMPATIBLE_INTERFACE"
    );
    let mut value = card("https://example.invalid");
    value["capabilities"]["extensions"] =
        json!([{"uri":"https://example.invalid/required", "required":true}]);
    assert_eq!(
        card_validation::discover(value, &resolved)
            .unwrap()
            .issue
            .unwrap()
            .code,
        "A2A_REQUIRED_EXTENSION_UNSUPPORTED"
    );
    let mut value = card("https://example.invalid");
    value["securitySchemes"] = json!({"oauth":{"oauth2SecurityScheme":{"flows":{}}}, "bearer":{"httpAuthSecurityScheme":{"scheme":"bearer"}}});
    value["securityRequirements"] = json!([{"schemes":{"oauth":{"list":["read"]}}}]);
    assert_eq!(
        card_validation::discover(value.clone(), &resolved)
            .unwrap()
            .issue
            .unwrap()
            .code,
        "A2A_AUTHENTICATION_UNSUPPORTED"
    );
    value["securityRequirements"] = json!([{"schemes":{"oauth":{"list":[]}}}, {"schemes":{}}]);
    assert!(
        card_validation::discover(value.clone(), &resolved)
            .unwrap()
            .issue
            .is_none()
    );
    value["skills"][0]["securityRequirements"] = json!([{"schemes":{"bearer":{"list":[]}}}]);
    assert!(
        card_validation::discover(value.clone(), &resolved)
            .unwrap()
            .issue
            .is_none(),
        "SendMessage cannot select a skill, so a skill-only requirement is advisory"
    );
    value["securityRequirements"] = json!({"bearer":[]});
    assert_eq!(
        code(&card_validation::discover(value, &resolved).unwrap_err()),
        "A2A_INVALID_CARD"
    );
}

#[test]
fn a2a_terminal_states_and_v1_part_shapes_do_not_invent_completion() {
    for (state, terminal) in [
        ("TASK_STATE_SUBMITTED", false),
        ("TASK_STATE_WORKING", false),
        ("TASK_STATE_INPUT_REQUIRED", false),
        ("TASK_STATE_AUTH_REQUIRED", false),
        ("TASK_STATE_UNSPECIFIED", false),
        ("TASK_STATE_FUTURE", false),
        ("TASK_STATE_COMPLETED", true),
        ("TASK_STATE_FAILED", true),
        ("TASK_STATE_CANCELED", true),
        ("TASK_STATE_REJECTED", true),
    ] {
        let result = client::task_result(task("task", state)).unwrap();
        assert_eq!(result.terminal, terminal);
    }
    let value = json!({"id":"task", "status":{"state":"TASK_STATE_WORKING"}, "artifacts":[{"artifactId":"artifact", "parts":[{"raw":"SGVsbG8=", "mediaType":"text/plain"},{"data":[1,2,3]}]}]});
    assert!(client::task_result(value.clone()).is_ok());
    let mut invalid = value;
    invalid["artifacts"][0]["parts"][0]["text"] = json!("second union variant");
    assert_eq!(
        code(&client::task_result(invalid).err().unwrap()),
        "A2A_INVALID_RESPONSE"
    );
    for invalid in [
        json!({"task":task("task", "TASK_STATE_WORKING"), "message":{}}),
        json!({"task":null}),
        json!({"kind":"task","id":"legacy"}),
    ] {
        assert_eq!(
            code(&client::send_result(invalid).err().unwrap()),
            "A2A_INVALID_RESPONSE"
        );
    }
    assert!(validation::url("http://localhost:8000/card").is_ok());
    for invalid in [
        "http://example.com/card",
        "http://localhost.attacker.invalid/card",
        "https://user:secret@example.invalid/card",
        "https://example.invalid/card#fragment",
    ] {
        assert!(validation::url(invalid).is_err());
    }
}

#[test]
fn a2a_rpc_errors_version_ids_response_types_and_size_are_checked_over_http() {
    let fixture = Fixture::new();
    for (case, expected) in [
        ("id", "A2A_INVALID_RESPONSE"),
        ("both", "A2A_INVALID_RESPONSE"),
        ("version", "A2A_VERSION_UNSUPPORTED"),
        ("stream", "A2A_RESPONSE_TYPE_UNSUPPORTED"),
        ("size", "A2A_RESPONSE_LIMIT"),
        ("auth", "A2A_HTTP_AUTHENTICATION_REQUIRED"),
        ("redirect", "A2A_REDIRECT_REJECTED"),
    ] {
        let server = Server::new(move |base, request| {
            if request.method == "GET" {
                return Reply::json(card(base));
            }
            let mut reply = Reply::rpc(request, json!({"task":task("task", "TASK_STATE_WORKING")}));
            match case {
                "id" => {
                    let mut value: Value = serde_json::from_slice(&reply.bytes).unwrap();
                    value["id"] = json!("wrong");
                    reply = Reply::json(value);
                }
                "both" => {
                    let mut value: Value = serde_json::from_slice(&reply.bytes).unwrap();
                    value["error"] = json!({"code":-1,"message":"invalid"});
                    reply = Reply::json(value);
                }
                "version" => reply.headers.push(("A2A-Version".into(), "0.3".into())),
                "stream" => {
                    reply.headers = vec![("Content-Type".into(), "text/event-stream".into())]
                }
                "size" => reply.bytes = vec![b'x'; 2 * 1024 * 1024 + 1],
                "auth" => reply.status = 403,
                "redirect" => {
                    reply.status = 302;
                    reply
                        .headers
                        .push(("Location".into(), format!("{base}/not-followed")));
                }
                _ => unreachable!(),
            }
            reply
        });
        let info = fixture.save(&draft(&server.base, "none", None));
        let failure = block_on(fixture.runtime.send_message(
            &fixture.store,
            &fixture.owner,
            &info.id,
            &request_id(),
            "test",
            None,
        ))
        .err()
        .unwrap();
        assert_eq!(code(&failure), expected, "HTTP fixture case {case}");
        assert_eq!(server.requests.lock().unwrap().len(), 2);
    }
    let server = Server::standard();
    let info = fixture.save(&draft(&server.base, "none", None));
    let task = reply_value(
        block_on(fixture.runtime.send_message(
            &fixture.store,
            &fixture.owner,
            &info.id,
            &request_id(),
            "uncancelable",
            None,
        ))
        .unwrap(),
    );
    let failure = block_on(fixture.runtime.task(
        &fixture.store,
        &fixture.owner,
        task["taskHandle"].as_str().unwrap(),
        &request_id(),
        true,
        0,
    ))
    .err()
    .unwrap();
    assert_eq!(code(&failure), "A2A_TASK_NOT_CANCELABLE");
    assert_eq!(failure.details.unwrap()["rpcCode"], -32002);
    assert!(!failure.message.contains("synthetic-error-body-secret"));
}

#[test]
fn a2a_host_envelope_and_draft_contract_reject_extra_authority_parameters() {
    let mut draft = json!({"name":"agent", "cardUrl":"https://example.invalid/card", "auth":{"kind":"none", "credential":{"action":"clear"}}});
    draft["owner"] = json!("forged");
    assert!(serde_json::from_value::<ConnectionDraft>(draft).is_err());
    let mut failure = super::super::errors::error("A2A_TIMEOUT", "Local timeout");
    failure.details = Some(json!({"outcomeUnknown":true}));
    let envelope = super::super::platform::envelope(Err(failure));
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["error"]["details"]["outcomeUnknown"], true);
    assert_eq!(envelope["error"]["params"], json!({}));
    // Ownership is required even when using the runtime directly.
    let fixture = Fixture::new();
    let failure = block_on(fixture.runtime.agent_card(
        &fixture.store,
        &Owner::ui(fixture.owner.root.clone()),
        "missing",
        &request_id(),
    ))
    .unwrap_err();
    assert_eq!(code(&failure), "A2A_AGENT_SESSION_REQUIRED");
}
