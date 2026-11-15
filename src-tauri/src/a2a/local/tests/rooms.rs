use super::fixture::*;
use crate::rooms::{model::TaskStatus, ops};
use serde_json::{Value, json};

fn assigned(
    rig: &Rig,
    owner: &crate::plugins::agent_connection::AuthorizedAgent,
    id: &Value,
) -> Value {
    rig.local(owner, "a2a.localTasks", json!({})).unwrap()["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|task| task["taskRef"]["id"] == *id)
        .unwrap()
        .clone()
}

#[test]
fn local_a2a_room_assignment_to_a_non_adapter_member_creates_the_task() {
    let rig = Rig::new();
    rig.ready_pair();
    let room = rig.room("Human room");
    rig.service
        .rooms
        .mutate(&room, |room| {
            ops::add_member(room, "human-tab", "claude", "human", "review", false, 0).map(|_| ())
        })
        .unwrap();
    let added = rig
        .local(
            &rig.a,
            "a2a.localRoomTask",
            json!({"room":room,"op":{"op":"add","title":"human review","assignee":"human"},"requestId":op()}),
        )
        .unwrap();
    assert!(
        added.get("agentReply").is_none(),
        "a member without a verified A2A adapter must not be sent a protocol task"
    );
    let current = rig.service.rooms.get(&room).unwrap();
    let task = current
        .tasks
        .iter()
        .find(|task| task.title == "human review")
        .unwrap();
    let human = current
        .members
        .iter()
        .find(|member| member.title == "human")
        .unwrap();
    assert_eq!(task.assignee.as_deref(), Some(human.id.as_str()));
    assert_eq!(added["taskRef"]["id"], task.id);
}

#[test]
fn local_a2a_member_to_member_shared_room_falls_back_to_a_direct_task() {
    let rig = Rig::new();
    rig.ready_pair();
    rig.ready(&rig.c);
    let room = rig.room("Peer room");
    rig.service
        .rooms
        .mutate(&room, |room| {
            ops::add_member(
                room,
                &rig.c.tab_id,
                rig.c.agent.id(),
                "other",
                "peer work",
                false,
                0,
            )
            .map(|_| ())
        })
        .unwrap();
    assert!(rig.service.rooms.get(&room).unwrap().tasks.is_empty());

    // A worker cannot assign another worker in the room. The shared room must
    // not make a plain peer-to-peer A2A send fail; it stays a direct task.
    let sent = rig.send(&rig.b, &rig.c, "peer collaboration").unwrap();
    assert_eq!(sent["kind"], "task");
    assert_eq!(
        sent["task"]["metadata"]["belfry"]["taskRef"]["kind"],
        "direct_task"
    );
    assert!(
        rig.service.rooms.get(&room).unwrap().tasks.is_empty(),
        "the fallback must not create a room task"
    );
    let reference = sent["task"]["metadata"]["belfry"]["taskRef"]["id"].clone();
    let task = assigned(&rig, &rig.c, &reference);
    assert_eq!(task["taskRef"]["kind"], "direct_task");
    assert!(
        task["task"].get("history").is_none(),
        "list responses omit history to stay within the bridge budget"
    );
    let full = rig
        .local(
            &rig.c,
            "a2a.localTask",
            json!({"reportHandle": task["reportHandle"]}),
        )
        .unwrap();
    assert!(full["task"].get("history").is_some());
    rig.report(&rig.c, &task, "completed", "peer work done")
        .unwrap();
    let id = reference.as_str().unwrap();
    let done = rig
        .service
        .board
        .snapshot()
        .into_iter()
        .find(|task| task.id == id)
        .unwrap();
    assert_eq!(done.state, crate::collab::task::TaskState::Done);
}

#[test]
fn local_a2a_room_assignment_uses_http_and_the_authoritative_dependency_rules() {
    let rig = Rig::new();
    rig.ready_pair();
    rig.ready(&rig.c);
    let room = rig.room("Protocol room");
    rig.service
        .rooms
        .mutate(&room, |room| {
            ops::add_member(
                room,
                &rig.c.tab_id,
                rig.c.agent.id(),
                "other",
                "dependent work",
                false,
                0,
            )
            .map(|_| ())
        })
        .unwrap();
    let first=rig.local(&rig.a,"a2a.localRoomTask",json!({"room":room,"op":{"op":"add","title":"first task","outcome":"complete first","assignee":"worker"},"requestId":op()})).unwrap();
    assert!(first["agentReply"]["taskHandle"].is_string());
    assert_eq!(first["taskRef"]["kind"], "room_task");
    assert_eq!(first["taskRef"]["generation"], 1);
    let second=rig.local(&rig.a,"a2a.localRoomTask",json!({"room":room,"op":{"op":"add","title":"dependent task","assignee":"other","after":[first["task"]["id"]]},"requestId":op()})).unwrap();
    let first_task = assigned(&rig, &rig.b, &first["task"]["id"]);
    let dependent = assigned(&rig, &rig.c, &second["task"]["id"]);
    assert!(
        rig.report(
            &rig.c,
            &dependent,
            "working",
            "cannot start before dependency"
        )
        .is_err()
    );
    assert!(
        rig.report(
            &rig.c,
            &dependent,
            "completed",
            "cannot finish before dependency"
        )
        .is_err()
    );
    assert_eq!(
        rig.service.rooms.get(&room).unwrap().tasks[1].status,
        TaskStatus::Planned
    );
    rig.report(&rig.b, &first_task, "working", "first is running")
        .unwrap();
    rig.report(&rig.b, &first_task, "completed", "first result")
        .unwrap();
    let current = rig.service.rooms.get(&room).unwrap();
    assert_eq!(current.tasks[0].status, TaskStatus::Done);
    assert!(
        current
            .all_messages()
            .any(|message| message.text.contains("A2AReportTask")
                && message.text.contains("dependent task"))
    );
    rig.report(&rig.c, &dependent, "working", "dependency is now complete")
        .unwrap();
    rig.report(&rig.c, &dependent, "completed", "dependent result")
        .unwrap();
    let result = rig
        .api(
            &rig.a,
            "a2a.getTask",
            json!({"taskHandle":second["agentReply"]["taskHandle"],"requestId":op()}),
        )
        .unwrap();
    assert_eq!(result["task"]["status"]["state"], "TASK_STATE_COMPLETED");
    assert!(
        rig.service
            .board
            .snapshot()
            .iter()
            .all(|task| task.chat.is_some()),
        "room assignments do not create a direct work authority"
    );
    let context = rig
        .local(&rig.b, "a2a.localRoom", json!({"room":room}))
        .unwrap();
    assert_eq!(context["tasks"][0]["generation"], 1);
    let inbox = rig
        .local(&rig.b, "a2a.localInbox", json!({"room":room}))
        .unwrap();
    assert!(
        inbox["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|message| message["taskRef"]["id"] == first["task"]["id"])
    );
    let view = rig
        .service
        .inbox
        .sessions(&rig.project, Some(&room))
        .unwrap()
        .sessions
        .into_iter()
        .find(|session| session.tab_id == rig.b.tab_id)
        .unwrap();
    let messages = rig
        .service
        .inbox
        .messages(&view.session_key, Some(&room), None, Some(50), None)
        .unwrap();
    assert!(messages.messages.iter().any(|message| {
        message
            .task_ref
            .as_ref()
            .is_some_and(|reference| reference.id == first["task"]["id"].as_str().unwrap())
    }));
}

#[test]
fn local_a2a_preserves_room_roles_self_work_and_unassigned_claims() {
    let rig = Rig::new();
    rig.ready_pair();
    rig.ready(&rig.c);
    let room = rig.room("Role scope");
    assert!(
        rig.local(
            &rig.c,
            "a2a.localRoomTask",
            json!({"room":room,"op":{"op":"add","title":"outsider"},"requestId":op()})
        )
        .is_err()
    );
    rig.service
        .rooms
        .mutate(&room, |room| {
            ops::add_member(
                room,
                &rig.c.tab_id,
                rig.c.agent.id(),
                "other",
                "other work",
                false,
                0,
            )
            .map(|_| ())
        })
        .unwrap();
    let rejected=rig.local(&rig.b,"a2a.localRoomTask",json!({"room":room,"op":{"op":"add","title":"forbidden peer work","assignee":"other"},"requestId":op()}));
    assert!(rejected.is_err());
    assert!(rig.service.rooms.get(&room).unwrap().tasks.is_empty());
    // The existing rule permits member-to-coordinator work and self work.
    let upward=rig.local(&rig.b,"a2a.localRoomTask",json!({"room":room,"op":{"op":"add","title":"coordinate a decision","assignee":"lead"},"requestId":op()})).unwrap();
    assert!(upward.get("agentReply").is_some());
    let self_request = json!({"room":room,"op":{"op":"add","title":"own member work","assignee":"worker"},"requestId":op()});
    let own = rig
        .local(&rig.b, "a2a.localRoomTask", self_request.clone())
        .unwrap();
    assert!(own.get("agentReply").is_none());
    assert_eq!(
        rig.local(&rig.b, "a2a.localRoomTask", self_request)
            .unwrap(),
        own
    );
    let own_task = assigned(&rig, &rig.b, &own["task"]["id"]);
    rig.report(
        &rig.b,
        &own_task,
        "inputRequired",
        "Coordinator, confirm my own task scope",
    )
    .unwrap();
    let inbox = rig
        .local(&rig.a, "a2a.localInbox", json!({"room":room}))
        .unwrap();
    assert!(
        inbox["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|message| message["text"] == "Coordinator, confirm my own task scope")
    );
    let lead=rig.local(&rig.a,"a2a.localRoomTask",json!({"room":room,"op":{"op":"add","title":"own coordinator work","assignee":"lead"},"requestId":op()})).unwrap();
    assert!(lead.get("agentReply").is_none());
    let lead_task = assigned(&rig, &rig.a, &lead["task"]["id"]);
    rig.report(
        &rig.a,
        &lead_task,
        "completed",
        "coordinator completed actual own work",
    )
    .unwrap();
    let plan = rig
        .local(
            &rig.a,
            "a2a.localRoomTask",
            json!({"room":room,"op":{"op":"add","title":"unassigned plan"},"requestId":op()}),
        )
        .unwrap();
    assert!(plan["task"]["assignee"].is_null());
    assert!(plan.get("agentReply").is_none());
    let claim=rig.local(&rig.b,"a2a.localRoomTask",json!({"room":room,"op":{"op":"assign","task":plan["task"]["id"],"assignee":"worker"},"expectedGeneration":plan["task"]["generation"],"requestId":op()})).unwrap();
    assert!(
        claim["task"]["generation"].as_u64().unwrap()
            > plan["task"]["generation"].as_u64().unwrap()
    );
    let claimed = assigned(&rig, &rig.b, &plan["task"]["id"]);
    rig.report(&rig.b, &claimed, "completed", "claimed work completed")
        .unwrap();
    assert!(rig.local(&rig.b,"a2a.localRoomTask",json!({"room":room,"op":{"op":"reopen","task":lead["task"]["id"]},"expectedGeneration":lead["task"]["generation"],"requestId":op()})).is_err());
}

#[test]
fn local_a2a_failed_room_work_stays_unfinished_and_old_generations_cannot_report() {
    let rig = Rig::new();
    rig.ready_pair();
    let room = rig.room("Failure lifecycle");
    let sent = rig
        .send(&rig.a, &rig.b, "Work requiring an explicit result")
        .unwrap();
    let task = rig.assigned(&rig.b);
    let canceled = rig.rpc(
        &rig.a,
        &rig.b,
        "CancelTask",
        json!({"id":sent["task"]["id"]}),
    );
    assert_eq!(canceled["error"]["code"], -32002);
    rig.report(&rig.b, &task, "working", "started room work")
        .unwrap();
    rig.report(&rig.b, &task, "failed", "required resource unavailable")
        .unwrap();
    let current = rig.service.rooms.get(&room).unwrap();
    assert_eq!(current.tasks[0].status, TaskStatus::Active);
    assert!(current.tasks[0].result.is_none());
    assert!(
        current.tasks[0]
            .notes
            .contains("required resource unavailable")
    );
    assert!(
        current
            .all_messages()
            .any(|message| message.text.contains("failed")
                && message.text.contains("required resource unavailable"))
    );
    let failure = rig
        .api(
            &rig.a,
            "a2a.getTask",
            json!({"taskHandle":sent["taskHandle"],"requestId":op()}),
        )
        .unwrap();
    assert_eq!(failure["task"]["status"]["state"], "TASK_STATE_FAILED");
    let reopened=rig.local(&rig.a,"a2a.localRoomTask",json!({"room":room,"op":{"op":"reopen","task":task["taskRef"]["id"]},"expectedGeneration":task["generation"],"requestId":op()})).unwrap();
    assert!(
        reopened["task"]["generation"].as_u64().unwrap() > task["generation"].as_u64().unwrap()
    );
    assert_eq!(
        code(
            &rig.report(&rig.b, &task, "completed", "old generation must fail")
                .unwrap_err()
        ),
        "A2A_LOCAL_TASK_CHANGED"
    );
    let updated = assigned(&rig, &rig.b, &task["taskRef"]["id"]);
    assert_ne!(updated["reportHandle"], task["reportHandle"]);
    rig.report(&rig.b, &updated, "completed", "new generation completed")
        .unwrap();
    assert_eq!(
        rig.service.rooms.get(&room).unwrap().tasks[0].status,
        TaskStatus::Done
    );
    assert!(rig.local(&rig.a,"a2a.localRoomTask",json!({"room":room,"op":{"op":"archive","task":task["taskRef"]["id"]},"expectedGeneration":task["generation"],"requestId":op()})).is_err());
}

#[test]
fn local_a2a_brief_is_coordinator_scoped_idempotent_and_has_combined_text_limits() {
    let rig = Rig::new();
    rig.ready_pair();
    let room = rig.room("Brief updates");
    let input = json!({"room":room,"focus":"clear acceptance criteria","constraints":["use a temporary fixture"],"operationId":op()});
    assert!(
        rig.local(&rig.b, "a2a.localRoomBrief", input.clone())
            .is_err()
    );
    let first = rig
        .local(&rig.a, "a2a.localRoomBrief", input.clone())
        .unwrap();
    let count = rig.service.rooms.get(&room).unwrap().all_messages().count();
    assert_eq!(
        rig.local(&rig.a, "a2a.localRoomBrief", input.clone())
            .unwrap(),
        first
    );
    assert_eq!(
        rig.service.rooms.get(&room).unwrap().all_messages().count(),
        count
    );
    let mut conflict = input;
    conflict["focus"] = json!("different value");
    assert_eq!(
        code(
            &rig.local(&rig.a, "a2a.localRoomBrief", conflict)
                .unwrap_err()
        ),
        "A2A_LOCAL_OPERATION_CONFLICT"
    );
    let before = rig.service.rooms.get(&room).unwrap().brief.objective;
    rig.local(
        &rig.a,
        "a2a.localRoomBrief",
        json!({"room":room,"focus":"","constraints":[],"operationId":op()}),
    )
    .unwrap();
    let current = rig.service.rooms.get(&room).unwrap();
    assert_eq!(current.brief.objective, before);
    assert!(current.brief.current_focus.is_empty() && current.brief.constraints.is_empty());
    assert!(rig.local(&rig.a,"a2a.localRoomBrief",json!({"room":room,"objective":"a".repeat(40000),"focus":"b".repeat(40000),"operationId":op()})).is_err());
    assert!(
        rig.local(
            &rig.a,
            "a2a.localRoomBrief",
            json!({"room":room,"constraints":vec!["x";65],"operationId":op()})
        )
        .is_err()
    );
}

#[test]
fn local_a2a_ambiguous_rooms_require_explicit_context_and_long_sends_have_valid_titles() {
    let rig = Rig::new();
    rig.ready_pair();
    let one = rig.room("First common room");
    let text = "long room instruction ".repeat(10);
    rig.send(&rig.a, &rig.b, &text).unwrap();
    assert_eq!(
        rig.service.rooms.get(&one).unwrap().tasks[0]
            .title
            .chars()
            .count(),
        ops::MAX_TASK_TITLE_CHARS
    );
    let two = rig.room("Second common room");
    let before = rig.service.rooms.get(&one).unwrap().tasks.len();
    assert!(
        rig.send(&rig.a, &rig.b, "choose a room explicitly")
            .is_err()
    );
    assert_eq!(rig.service.rooms.get(&one).unwrap().tasks.len(), before);
    assert!(rig.service.rooms.get(&two).unwrap().tasks.is_empty());
    let selected=rig.local(&rig.a,"a2a.localRoomTask",json!({"room":two,"op":{"op":"add","title":"explicit room work","assignee":"worker"},"requestId":op()})).unwrap();
    assert_eq!(selected["taskRef"]["roomId"], two);
}

#[test]
fn local_a2a_preview_isolates_deleted_rooms_and_preserves_full_results() {
    let rig = Rig::new();
    rig.ready_pair();
    rig.ready(&rig.c);
    let room = rig.room("Deleted history");
    rig.send(&rig.a, &rig.b, "historical room assignment")
        .unwrap();
    rig.send(&rig.a, &rig.c, "unrelated direct task").unwrap();
    let task = rig.assigned(&rig.c);
    rig.local(&rig.c,"a2a.localReport",json!({"reportHandle":task["reportHandle"],"generation":task["generation"],"state":"completed",
        "text":"结".repeat(5000),"artifacts":[{"name":"full.txt","text":"a".repeat(1000)}],"operationId":op()})).unwrap();
    rig.service.rooms.delete(&room).unwrap();
    let snapshot = rig.service.snapshot(&rig.project).unwrap();
    let tasks = snapshot["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["taskRef"], task["taskRef"]);
    assert_eq!(tasks[0]["text"].as_str().unwrap().chars().count(), 4096);
    assert_eq!(tasks[0]["textTruncated"], true);
    assert_eq!(
        tasks[0]["artifacts"][0]["text"].as_str().unwrap().len(),
        512
    );
    assert_eq!(tasks[0]["artifacts"][0]["truncated"], true);
    let full = rig
        .local(
            &rig.c,
            "a2a.localTask",
            json!({"reportHandle":task["reportHandle"]}),
        )
        .unwrap();
    assert!(
        full["task"]["status"]["message"]["parts"][0]["text"]
            .as_str()
            .unwrap()
            .ends_with(&"结".repeat(5000))
    );
    assert_eq!(
        full["task"]["artifacts"][0]["parts"][0]["text"]
            .as_str()
            .unwrap()
            .len(),
        1000
    );
    assert_eq!(
        rig.service.snapshot("/a-different-project").unwrap()["tasks"],
        json!([])
    );
}
