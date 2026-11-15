use super::fixture::*;
use crate::{
    a2a::{platform, requests::Owner},
    collab::task::TaskState,
    plugins::A2aTestHost,
};
use serde_json::{Value, json};
use std::{sync::Arc, thread, time::Duration};
use tauri::async_runtime::block_on;

fn mcp(client: &reqwest::Client, session: &Value, id: u32, method: &str, params: Value) -> Value {
    block_on(async {
        let response = client
            .post(session["url"].as_str().unwrap())
            .bearer_auth(session["token"].as_str().unwrap())
            .header("Content-Type", "application/json")
            .body(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string())
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let value: Value = serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
        assert!(value.get("error").is_none(), "MCP request failed: {value}");
        value["result"].clone()
    })
}
fn tool(client: &reqwest::Client, session: &Value, id: u32, name: &str, args: Value) -> Value {
    mcp(
        client,
        session,
        id,
        "tools/call",
        json!({"name":name,"arguments":args}),
    )
}
fn data(client: &reqwest::Client, session: &Value, id: u32, name: &str, args: Value) -> Value {
    let result = tool(client, session, id, name, args);
    assert_ne!(result["isError"], true, "{result}");
    result["structuredContent"].clone()
}
fn host(rig: Arc<Rig>) -> A2aTestHost {
    let base = rig.root.join("embedded-node");
    A2aTestHost::launch(
        &base,
        Arc::new(move |request| {
            // Only the post-authentication PTY snapshot is synthetic. The embedded
            // MCP transport, typed host route, HTTP client and Gateway are production.
            let result = (|| {
                let owner = [&rig.a, &rig.b]
                    .into_iter()
                    .find(|owner| {
                        request["context"]["sessionId"] == owner.ticket
                            && request["context"]["workspace"] == owner.root
                    })
                    .ok_or_else(|| {
                        crate::a2a::errors::error(
                            "A2A_AGENT_SESSION_INVALID",
                            "Synthetic post-authentication owner mismatch",
                        )
                    })?;
                rig.service.current(owner)?;
                let api = request["api"].as_str().unwrap();
                let value = if api.starts_with("a2a.local") {
                    super::super::tools::dispatch(
                        &rig.service,
                        &rig.runtime,
                        &rig.connections(owner),
                        owner,
                        &request["args"][0],
                        api,
                    )?
                } else {
                    platform::dispatch_source(
                        &rig.runtime,
                        &rig.connections(owner),
                        &Owner::agent(owner.root.clone(), owner.ticket.clone()),
                        &request,
                        api,
                    )?
                };
                rig.service.current(owner)?;
                Ok(value)
            })();
            Ok(platform::envelope(result))
        }),
    )
}
fn session(
    host: &A2aTestHost,
    rig: &Rig,
    owner: &crate::plugins::agent_connection::AuthorizedAgent,
) -> Value {
    let session=host.call("session.open",json!({"workspace":owner.root,"sessionId":owner.ticket,"agentKind":owner.agent.id(),
        "agentSession":{"agent":owner.agent.id(),"id":format!("synthetic-native-{}",owner.tab_id)}}));
    mcp(
        &rig.client,
        &session,
        1,
        "initialize",
        json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"synthetic-agent","version":"1"}}),
    );
    session
}

#[test]
fn local_a2a_two_embedded_mcp_sessions_use_real_http_and_bound_reports() {
    let rig = Arc::new(Rig::new());
    let host = host(rig.clone());
    host.call("hello", json!({}));
    let sender = session(&host, &rig, &rig.a);
    let recipient = session(&host, &rig, &rig.b);
    for session in [&sender, &recipient] {
        let tools = mcp(&rig.client, session, 2, "tools/list", json!({}));
        for name in [
            "A2ALocalAgents",
            "A2ALocalTasks",
            "A2ALocalTask",
            "A2AReportTask",
            "A2AInbox",
            "A2ARooms",
            "A2ARoomContext",
            "A2ARoomBrief",
            "A2ARoomSay",
            "A2ARoomTask",
        ] {
            assert!(
                tools["tools"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|tool| tool["name"] == name),
                "missing {name}"
            );
        }
    }
    let agents = data(&rig.client, &sender, 3, "A2ALocalAgents", json!({}));
    assert_eq!(agents["agents"].as_array().unwrap().len(), 1);
    let connection = agents["agents"][0]["id"].clone();
    assert!(connection.as_str().unwrap().starts_with("local:"));
    assert!(!agents.to_string().contains(&rig.a.ticket));
    assert!(agents["agents"][0].get("rootPath").is_none());
    let card = data(
        &rig.client,
        &sender,
        4,
        "A2AAgentCard",
        json!({"connectionId":connection}),
    );
    assert_eq!(card["selectedInterface"]["protocolVersion"], "1.0");
    let sent = data(
        &rig.client,
        &sender,
        5,
        "A2ASendMessage",
        json!({"connectionId":connection,"text":"embedded MCP to native Gateway work"}),
    );
    assert_eq!(sent["task"]["status"]["state"], "TASK_STATE_SUBMITTED");
    let (offer, batch) = rig.prepare(&rig.b);
    let begin = rig.begin(offer, &batch);
    rig.finish(&begin);
    let tasks = data(&rig.client, &recipient, 3, "A2ALocalTasks", json!({}));
    let task = &tasks["tasks"][0];
    assert_eq!(task["task"]["id"], sent["task"]["id"]);
    assert_eq!(task["instruction"], "embedded MCP to native Gateway work");
    let forbidden = tool(
        &rig.client,
        &sender,
        6,
        "A2AReportTask",
        json!({"reportHandle":task["reportHandle"],"generation":task["generation"],"state":"completed","text":"sender cannot complete recipient work"}),
    );
    assert_eq!(forbidden["isError"], true);
    data(
        &rig.client,
        &recipient,
        4,
        "A2AReportTask",
        json!({"reportHandle":task["reportHandle"],"generation":task["generation"],"state":"inputRequired","text":"Please confirm output encoding"}),
    );
    let input = data(
        &rig.client,
        &sender,
        7,
        "A2AGetTask",
        json!({"taskHandle":sent["taskHandle"]}),
    );
    assert_eq!(
        input["task"]["status"]["state"],
        "TASK_STATE_INPUT_REQUIRED"
    );
    assert_eq!(input["terminal"], false);
    let inbox = data(&rig.client, &sender, 8, "A2AInbox", json!({}));
    assert!(
        inbox["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|message| message["text"] == "Please confirm output encoding")
    );
    let answer = data(
        &rig.client,
        &sender,
        9,
        "A2ASendMessage",
        json!({"connectionId":connection,"taskHandle":sent["taskHandle"],"text":"Use UTF-8"}),
    );
    assert_eq!(answer["task"]["id"], sent["task"]["id"]);
    let full = data(
        &rig.client,
        &recipient,
        5,
        "A2ALocalTask",
        json!({"reportHandle":task["reportHandle"]}),
    );
    assert!(
        full["task"]["history"]
            .as_array()
            .unwrap()
            .iter()
            .any(|message| message["parts"][0]["text"] == "Use UTF-8")
    );
    data(
        &rig.client,
        &recipient,
        6,
        "A2AReportTask",
        json!({"reportHandle":task["reportHandle"],"generation":task["generation"],"state":"completed","text":"actual synthetic recipient work done","artifacts":[{"name":"result.txt","text":"UTF-8 result"}]}),
    );
    let done = data(
        &rig.client,
        &sender,
        10,
        "A2AGetTask",
        json!({"taskHandle":sent["taskHandle"],"historyLength":1}),
    );
    assert_eq!(done["terminal"], true);
    assert_eq!(
        done["task"]["artifacts"][0]["parts"][0]["text"],
        "UTF-8 result"
    );
    assert_eq!(
        rig.service
            .board
            .snapshot()
            .iter()
            .find(|entry| entry.chat.is_none())
            .unwrap()
            .state,
        TaskState::Done
    );
    let queued = data(
        &rig.client,
        &sender,
        11,
        "A2ASendMessage",
        json!({"connectionId":connection,"text":"cancel only this queued work"}),
    );
    let canceled = data(
        &rig.client,
        &sender,
        12,
        "A2ACancelTask",
        json!({"taskHandle":queued["taskHandle"]}),
    );
    assert_eq!(canceled["task"]["status"]["state"], "TASK_STATE_CANCELED");
    let room = rig.room("Embedded room");
    let context = data(
        &rig.client,
        &sender,
        13,
        "A2ARoomContext",
        json!({"room":room}),
    );
    assert_eq!(context["roomId"], room);
    data(
        &rig.client,
        &sender,
        14,
        "A2ARoomBrief",
        json!({"room":room,"focus":"embedded HTTP room acceptance"}),
    );
    assert_eq!(
        rig.service.rooms.get(&room).unwrap().brief.current_focus,
        "embedded HTTP room acceptance"
    );
    let assigned = data(
        &rig.client,
        &sender,
        15,
        "A2ARoomTask",
        json!({"room":room,"op":{"op":"add","title":"embedded room task","outcome":"complete through recipient tool","assignee":"worker"}}),
    );
    assert!(assigned["agentReply"]["taskHandle"].is_string());
    let tasks = data(
        &rig.client,
        &recipient,
        7,
        "A2ALocalTasks",
        json!({"room":room}),
    );
    let room_task = &tasks["tasks"][0];
    assert_eq!(room_task["taskRef"], assigned["taskRef"]);
    data(
        &rig.client,
        &recipient,
        8,
        "A2AReportTask",
        json!({"reportHandle":room_task["reportHandle"],"generation":room_task["generation"],"state":"completed","text":"room result via embedded Node"}),
    );
    let completed = data(
        &rig.client,
        &sender,
        16,
        "A2AGetTask",
        json!({"taskHandle":assigned["agentReply"]["taskHandle"]}),
    );
    assert_eq!(completed["task"]["status"]["state"], "TASK_STATE_COMPLETED");
    assert_eq!(
        rig.service.rooms.get(&room).unwrap().tasks[0]
            .result
            .as_deref(),
        Some("room result via embedded Node")
    );
}

#[test]
fn local_a2a_first_tools_list_recovers_after_actual_binding_becomes_ready() {
    let rig = Arc::new(Rig::new());
    rig.access.0.lock().unwrap().clear();
    let host = host(rig.clone());
    host.call("hello", json!({}));
    let sender = session(&host, &rig, &rig.a);
    let (client, pending_session) = (rig.client.clone(), sender.clone());
    let pending = thread::spawn(move || mcp(&client, &pending_session, 2, "tools/list", json!({})));
    thread::sleep(Duration::from_millis(120));
    assert!(
        rig.service.state.lock().unwrap().agents.is_empty(),
        "an unbound PTY cannot be advertised"
    );
    *rig.access.0.lock().unwrap() = vec![rig.a.clone(), rig.b.clone()];
    let listed = pending.join().unwrap();
    assert!(
        listed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "A2AReportTask")
    );
    assert!(
        rig.service
            .state
            .lock()
            .unwrap()
            .agents
            .contains_key(&rig.a.ticket)
    );
    rig.access.0.lock().unwrap().clear();
    rig.service.revoke(&rig.a.ticket);
    let fallback = mcp(&rig.client, &sender, 3, "tools/list", json!({}));
    assert!(
        fallback["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "PluginTools")
    );
    assert!(
        !fallback["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "A2AReportTask")
    );
    *rig.access.0.lock().unwrap() = vec![rig.a.clone(), rig.b.clone()];
    let rediscovered = mcp(&rig.client, &sender, 4, "tools/list", json!({}));
    assert!(
        rediscovered["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "A2AReportTask")
    );
}
