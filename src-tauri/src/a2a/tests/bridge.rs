use reqwest::Client;
use serde_json::{Value, json};
use std::{sync::Arc, thread, time::Duration};
use tauri::async_runtime::block_on;

use super::super::{errors::error, platform};
use super::fixture::*;
use crate::plugins::A2aTestHost;

fn mcp(client: &Client, session: &Value, id: u32, method: &str, params: Value) -> Value {
    block_on(async {
        let response = client
            .post(session["url"].as_str().unwrap())
            .header("Content-Type", "application/json")
            .bearer_auth(session["token"].as_str().unwrap())
            .body(json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}).to_string())
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let reply: Value = serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
        assert!(reply.get("error").is_none());
        reply["result"].clone()
    })
}
fn tool(client: &Client, session: &Value, id: u32, name: &str, args: Value) -> Value {
    mcp(
        client,
        session,
        id,
        "tools/call",
        json!({"name":name, "arguments":args}),
    )
}

#[test]
fn a2a_embedded_node_calls_the_real_rust_route_and_http_client() {
    let server = Server::standard();
    let fixture = Arc::new(Fixture::new());
    let info = fixture.save(&draft(&server.base, "none", None));
    let callback_fixture = fixture.clone();
    let host = A2aTestHost::launch(
        &fixture.root.0.join("node-host"),
        Arc::new(move |request| {
            // This fixture supplies the post-authentication boundary, not a fake HTTP
            // client. Live PTY/ticket verification is independently covered in native tests.
            let owner = &callback_fixture.owner;
            let result = if request["context"]["workspace"] != owner.root
                || request["context"]["sessionId"] != owner.ticket.as_deref().unwrap()
            {
                Err(error(
                    "A2A_AGENT_SESSION_INVALID",
                    "Synthetic owner mismatch",
                ))
            } else {
                platform::dispatch_authorized(
                    &callback_fixture.runtime,
                    &callback_fixture.store,
                    owner,
                    &request,
                    request["api"].as_str().unwrap(),
                )
            };
            Ok(platform::envelope(result))
        }),
    );
    host.call("hello", json!({}));
    let session = host.call(
        "session.open",
        json!({"workspace":fixture.owner.root, "sessionId":fixture.owner.ticket,
        "agentKind":"codex", "agentSession":{"agent":"codex", "id":"synthetic-native-history"}}),
    );
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    mcp(
        &client,
        &session,
        1,
        "initialize",
        json!({"protocolVersion":"2025-06-18", "capabilities":{}, "clientInfo":{"name":"synthetic-agent", "version":"1"}}),
    );
    let list = mcp(&client, &session, 2, "tools/list", json!({}));
    for name in [
        "A2AConnections",
        "A2AAgentCard",
        "A2ASendMessage",
        "A2AGetTask",
        "A2ACancelTask",
    ] {
        assert!(
            list["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|tool| tool["name"] == name)
        );
    }
    let connections = tool(&client, &session, 3, "A2AConnections", json!({}));
    assert_eq!(
        connections["structuredContent"]["connections"][0]["id"],
        info.id
    );
    assert!(
        connections["structuredContent"]["connections"][0]
            .get("rootPath")
            .is_none()
    );
    let discovery = tool(
        &client,
        &session,
        4,
        "A2AAgentCard",
        json!({"connectionId":info.id}),
    );
    assert_eq!(
        discovery["structuredContent"]["selectedInterface"]["tenant"],
        "fixture-tenant"
    );
    let sent = tool(
        &client,
        &session,
        5,
        "A2ASendMessage",
        json!({"connectionId":info.id, "text":"working"}),
    );
    let handle = sent["structuredContent"]["taskHandle"].as_str().unwrap();
    assert_eq!(sent["structuredContent"]["terminal"], false);
    let completed = tool(
        &client,
        &session,
        6,
        "A2AGetTask",
        json!({"taskHandle":handle}),
    );
    assert_eq!(completed["structuredContent"]["terminal"], true);
    assert_eq!(
        completed["structuredContent"]["task"]["artifacts"][0]["parts"][0]["text"],
        "completed result"
    );
    let instant = tool(
        &client,
        &session,
        7,
        "A2ASendMessage",
        json!({"connectionId":info.id, "text":"instant"}),
    );
    assert_eq!(instant["structuredContent"]["kind"], "message");
    assert!(instant["structuredContent"].get("taskHandle").is_none());
    let rejected = tool(
        &client,
        &session,
        8,
        "A2AGetTask",
        json!({"taskHandle":handle, "workspace":"/forged"}),
    );
    assert_eq!(rejected["isError"], true);
    let pending = tool(
        &client,
        &session,
        9,
        "A2ASendMessage",
        json!({"connectionId":info.id, "text":"working"}),
    );
    let canceled = tool(
        &client,
        &session,
        10,
        "A2ACancelTask",
        json!({"taskHandle":pending["structuredContent"]["taskHandle"]}),
    );
    assert_eq!(
        canceled["structuredContent"]["task"]["status"]["state"],
        "TASK_STATE_CANCELED"
    );
    // MCP cancellation propagates through Node's generated request ID to Rust.
    let (other_client, other_session, other_id) =
        (client.clone(), session.clone(), info.id.clone());
    let hanging = thread::spawn(move || {
        tool(
            &other_client,
            &other_session,
            11,
            "A2ASendMessage",
            json!({"connectionId":other_id, "text":"slow"}),
        )
    });
    for _ in 0..400 {
        if server
            .requests
            .lock()
            .unwrap()
            .iter()
            .any(|r| r.body["params"]["message"]["parts"][0]["text"] == "slow")
        {
            break;
        }
        thread::sleep(Duration::from_millis(5));
    }
    let status = block_on(async {
        client.post(session["url"].as_str().unwrap()).header("Content-Type", "application/json")
            .bearer_auth(session["token"].as_str().unwrap())
            .body(json!({"jsonrpc":"2.0", "method":"notifications/cancelled", "params":{"requestId":11}}).to_string())
            .send().await.unwrap().status()
    });
    assert_eq!(status.as_u16(), 202);
    let canceled = hanging.join().unwrap();
    assert_eq!(canceled["isError"], true);
    assert_eq!(canceled["structuredContent"]["error"]["code"], "CANCELLED");
    for _ in 0..200 {
        if server
            .disconnects
            .load(std::sync::atomic::Ordering::Acquire)
            > 0
        {
            break;
        }
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(
        server
            .disconnects
            .load(std::sync::atomic::Ordering::Acquire),
        1
    );
}
