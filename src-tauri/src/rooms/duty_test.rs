use std::{fs, path::PathBuf, sync::Arc};

use belfry_protocol::{Command, ResponseData, RoomTaskOp};

use super::{
    directory::MemberDirectory,
    model::*,
    ops,
    store::{RoomStore, deliveries},
};
use crate::collab::{
    RoomDirectory, SessionRegistry,
    task::{DeliveryPhase, TaskBoard, injection_text},
};

const DATA: &str = "维护数据格式、序列化协议与迁移";
const UI: &str = "审阅交互布局、键盘操作与视觉呈现";

#[path = "duty_live_test.rs"]
mod live;

struct Fixture {
    root: PathBuf,
    store: Arc<RoomStore>,
    registry: Arc<SessionRegistry>,
    board: Arc<TaskBoard>,
    room: String,
    lead: Member,
    data: Member,
    ui: Member,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-duty-{}", new_id()));
        fs::create_dir_all(&root).unwrap();
        let store = Arc::new(RoomStore::load(Some(root.join("rooms"))));
        let room = store
            .create(
                "Isolated duty routing",
                root.to_str().unwrap(),
                "完善配置保存和设置页",
            )
            .unwrap();
        store
            .mutate(&room.id, |room| {
                ops::add_member(
                    room,
                    "lead-tab",
                    "codex",
                    "协调员",
                    "拆解任务、集成与验收",
                    false,
                    1,
                )?;
                ops::add_member(room, "data-tab", "codex", "寻溪", DATA, false, 2)?;
                ops::add_member(room, "ui-tab", "codex", "织羽", UI, false, 3)?;
                Ok(())
            })
            .unwrap();
        let state = store.get(&room.id).unwrap();
        let registry = Arc::new(SessionRegistry::default());
        let fixture = Self {
            root: root.clone(),
            store,
            registry,
            board: Arc::new(TaskBoard::load(Some(root.join("bus")))),
            room: room.id,
            lead: state.member_by_tab("lead-tab").unwrap().clone(),
            data: state.member_by_tab("data-tab").unwrap().clone(),
            ui: state.member_by_tab("ui-tab").unwrap().clone(),
        };
        fixture.activity("talking", "idle");
        fixture.drain("initial");
        fixture
    }

    fn activity(&self, data: &str, ui: &str) {
        self.registry.replace([("lead-tab", "idle"), ("data-tab", data), ("ui-tab", ui)].into_iter().map(|(tab, activity)| {
            serde_json::from_value(serde_json::json!({ "tabId": tab, "name": tab, "title": tab, "agent": "codex",
                "activity": activity, "canReceive": true, "projectRoot": self.root })).unwrap()
        }).collect());
    }

    fn directory(&self) -> MemberDirectory {
        MemberDirectory {
            store: self.store.clone(),
            registry: self.registry.clone(),
        }
    }
    fn state(&self) -> Room {
        self.store.get(&self.room).unwrap()
    }
    fn task(&self, tab: &str, op: RoomTaskOp) -> ResponseData {
        let (answer, posts) = self
            .directory()
            .handle(tab, &Command::RoomTask { room: None, op })
            .unwrap();
        self.store
            .enqueue_posts(&self.board, &self.registry, &posts)
            .unwrap();
        answer
    }
    fn drain(&self, label: &str) -> Vec<serde_json::Value> {
        self.store.pump_outbox(&self.board, &self.registry).unwrap();
        let tasks = self.board.snapshot();
        let output = tasks.iter().map(|task| serde_json::json!({ "to":task.to, "messages":task.chat.as_ref().unwrap().message_ids,
            "injection": injection_text(task, "Isolated duty routing") })).collect::<Vec<_>>();
        record(label, &output);
        for task in tasks {
            assert!(self.board.claim_delivery(&task.id, "duty-attempt").unwrap());
            assert!(
                self.board
                    .delivery_update(&task.id, "duty-attempt", 1, DeliveryPhase::Queued, None)
                    .unwrap()
            );
            assert!(
                self.board
                    .delivery_update(&task.id, "duty-attempt", 2, DeliveryPhase::Submitting, None)
                    .unwrap()
            );
            assert!(
                self.board
                    .delivery_update(&task.id, "duty-attempt", 3, DeliveryPhase::Submitted, None)
                    .unwrap()
            );
        }
        self.store.reconcile(&self.board).unwrap();
        output
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn record<T: serde::Serialize + ?Sized>(name: &str, value: &T) {
    if let Some(root) = std::env::var_os("BELFRY_DUTY_ARTIFACTS") {
        let root = PathBuf::from(root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join(format!("{name}-{}.json", new_id())),
            serde_json::to_vec_pretty(value).unwrap(),
        )
        .unwrap();
    }
}
fn lead_text(records: &[serde_json::Value]) -> String {
    records
        .iter()
        .filter(|entry| entry["to"] == "lead-tab")
        .filter_map(|entry| entry["injection"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}
fn assert_context(text: &str, data_duty: &str) {
    assert!(
        text.contains(data_duty) && text.contains(UI),
        "all current duties must reach the coordinator: {text}"
    );
    assert!(
        text.contains("先按任务目标匹配职责") && text.contains("用户明确指定"),
        "routing rules must precede availability: {text}"
    );
    assert!(
        !text.contains("还有要做的就拆成任务派给他们"),
        "idle workers must not be the automatic destination: {text}"
    );
}

fn exercise_notice(trigger: &str) {
    let f = Fixture::new();
    f.store
        .mutate(&f.room, |room| {
            ops::say(
                room,
                &Actor::User,
                &[],
                "修正配置序列化，同时保留设置页",
                None,
                false,
                100,
            )
        })
        .unwrap();
    f.drain("user-chat");
    match trigger {
        "task-done" => {
            f.task(
                "lead-tab",
                RoomTaskOp::Add {
                    title: "界面评审".into(),
                    outcome: None,
                    assignee: Some("织羽".into()),
                    after: vec![],
                },
            );
            f.drain("task-created");
            f.task(
                "ui-tab",
                RoomTaskOp::Done {
                    task: "T1".into(),
                    result: Some("评审完成，数据序列化问题仍需处理".into()),
                },
            );
        }
        "idle" => {
            f.store
                .nudge_idle(&|tab| tab != "data-tab", ops::IDLE_NUDGE_MS + 101)
                .unwrap();
        }
        _ => {
            let (_, posts) = f
                .directory()
                .handle(
                    "ui-tab",
                    &Command::RoomSay {
                        room: None,
                        text: "界面检查结束，数据序列化问题仍需处理".into(),
                        reply_to: None,
                        to: vec![],
                        ask: false,
                    },
                )
                .unwrap();
            f.store
                .enqueue_posts(&f.board, &f.registry, &posts)
                .unwrap();
        }
    }
    let text = lead_text(&f.drain(trigger));
    assert_context(&text, DATA);
    assert!(
        text.contains(&f.data.id) && text.contains(&f.ui.id),
        "same Agent type must not collapse member identity: {text}"
    );
}

#[test]
fn regression_duty_task_done_injection() {
    exercise_notice("task-done");
}
#[test]
fn regression_duty_idle_injection() {
    exercise_notice("idle");
}
#[test]
fn regression_duty_member_chat_injection() {
    exercise_notice("member-chat");
}

#[test]
fn regression_duty_edits_notify_both_members_and_survive_restart_without_reassignment() {
    let f = Fixture::new();
    f.task(
        "lead-tab",
        RoomTaskOp::Add {
            title: "用户指定的研究任务".into(),
            outcome: None,
            assignee: Some("寻溪".into()),
            after: vec![],
        },
    );
    f.drain("before-duty-edit");
    let next = "负责存储恢复、数据约束与兼容性验证";
    f.store
        .mutate(&f.room, |room| {
            ops::update_member(room, &f.data.id, None, Some(next), None, 500)
        })
        .unwrap();
    let restored = RoomStore::load(Some(f.root.join("rooms")))
        .get(&f.room)
        .unwrap();
    assert_eq!(restored.active_member(&f.data.id).unwrap().duty, next);
    assert_eq!(
        restored.tasks[0].assignee.as_deref(),
        Some(f.data.id.as_str()),
        "updating duty must not silently reassign existing work"
    );
    let posts = f.drain("duty-edit");
    assert!(
        posts
            .iter()
            .any(|post| post["to"] == "data-tab"
                && post["injection"].as_str().unwrap().contains(next)),
        "the affected member must learn its new duty"
    );
    assert_context(&lead_text(&posts), next);
}

#[test]
fn regression_duty_snapshot_is_refreshed_before_acceptance_and_claimed_text_is_immutable() {
    let f = Fixture::new();
    let (posted, old) = f
        .store
        .mutate(&f.room, |room| {
            ops::say(room, &Actor::User, &[], "保存格式任务", None, false, 500)
        })
        .unwrap();
    let stale = deliveries(&old, &[posted]);
    let next = "现在负责存储协议的向后兼容";
    f.store
        .mutate(&f.room, |room| {
            ops::update_member(room, &f.data.id, None, Some(next), None, 501)
        })
        .unwrap();
    f.store
        .enqueue_posts(&f.board, &f.registry, &stale)
        .unwrap();
    let accepted = f.board.snapshot();
    assert_eq!(accepted.len(), 1);
    record("accepted-current-context", &accepted);
    assert_context(&accepted[0].instruction, next);
    assert!(
        !accepted[0].instruction.contains(DATA),
        "stale snapshots must not be accepted as current"
    );
    assert!(
        accepted[0].instruction.contains("talking"),
        "delivery should use current registry availability"
    );
    assert!(f.board.claim_delivery(&accepted[0].id, "held").unwrap());
    f.store
        .mutate(&f.room, |room| {
            ops::update_member(room, &f.data.id, None, Some("又一次职责更新"), None, 502)
        })
        .unwrap();
    f.store
        .enqueue_posts(&f.board, &f.registry, &stale)
        .unwrap();
    assert_eq!(
        f.board.get(&accepted[0].id).unwrap().instruction,
        accepted[0].instruction
    );
}

#[test]
fn membership_and_resume_deliver_current_context_without_replaying_paused_messages() {
    let f = Fixture::new();
    f.store
        .mutate(&f.room, |room| ops::set_paused(room, true, 500))
        .unwrap();
    f.store
        .mutate(&f.room, |room| {
            ops::add_member(
                room,
                "new-tab",
                "codex",
                "听岚",
                "测量网络拥塞和延时",
                false,
                501,
            )?;
            ops::update_member(
                room,
                &f.data.id,
                None,
                Some("恢复后负责数据回填"),
                None,
                502,
            )?;
            ops::say(
                room,
                &Actor::User,
                &[],
                "暂停期间的旧请求",
                None,
                false,
                503,
            )?;
            Ok(())
        })
        .unwrap();
    assert!(f.drain("paused").is_empty());
    f.store
        .mutate(&f.room, |room| ops::set_paused(room, false, 504))
        .unwrap();
    let resumed = f.drain("resumed-current-context");
    assert_eq!(resumed.len(), 1);
    let text = lead_text(&resumed);
    assert_context(&text, "恢复后负责数据回填");
    assert!(text.contains("听岚") && text.contains("测量网络拥塞和延时"));
    assert!(!text.contains("暂停期间的旧请求"));
    f.store
        .mutate(&f.room, |room| {
            ops::add_member(room, "extra-tab", "codex", "朔风", "维护包签名", false, 505)
        })
        .unwrap();
    assert!(lead_text(&f.drain("new-member-notice")).contains("维护包签名"));
}

#[test]
fn english_context_keeps_custom_duties_and_peer_status_keeps_the_legacy_shape() {
    belfry_i18n::with_locale(belfry_i18n::Locale::En, || {
        let f = Fixture::new();
        let (lead, _) = f
            .directory()
            .handle("lead-tab", &Command::RoomStatus { room: None })
            .unwrap();
        let value = serde_json::to_value(lead).unwrap();
        let text = value["status"]["coordination"].as_str().unwrap();
        assert!(
            text.contains("Assignment rules: match the task objective to responsibilities first")
                && text.contains("Honor an owner explicitly named by the user")
        );
        assert!(text.contains(DATA) && text.contains(UI) && text.contains(&f.data.id));
        record("english-status", &value);
        let (peer, _) = f
            .directory()
            .handle("data-tab", &Command::RoomStatus { room: None })
            .unwrap();
        let peer = serde_json::to_value(peer).unwrap();
        assert!(peer["status"].get("coordination").is_none());
        assert_eq!(peer["status"]["members"][1]["duty"], DATA);
    });
}

#[test]
fn regression_duty_context_survives_session_rebind_and_roster_changes() {
    let f = Fixture::new();
    f.store
        .mutate(&f.room, |room| {
            ops::update_member(room, &f.lead.id, None, None, Some("rebound-lead"), 500)?;
            ops::update_member(room, &f.data.id, Some("新寻溪"), None, None, 501)?;
            Ok(())
        })
        .unwrap();
    // Rebind the runtime registry too; the original lead tab must not receive it.
    f.registry.replace([("rebound-lead", "idle"), ("data-tab", "talking"), ("ui-tab", "idle")].into_iter().map(|(tab, activity)| serde_json::from_value(serde_json::json!({
        "tabId":tab,"name":tab,"title":tab,"agent":"codex","activity":activity,"canReceive":true,"projectRoot":f.root
    })).unwrap()).collect());
    let posts = f.drain("rebound-roster");
    assert!(!posts.iter().any(|post| post["to"] == "lead-tab"));
    let text = posts
        .iter()
        .filter(|post| post["to"] == "rebound-lead")
        .map(|post| post["injection"].as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    assert_context(&text, DATA);
    assert!(text.contains("新寻溪") && text.contains(&f.data.id));
    f.store
        .mutate(&f.room, |room| ops::remove_member(room, &f.ui.id, 600))
        .unwrap();
    let departure = f.drain("departure-no-task");
    assert!(
        departure.iter().any(|post| post["to"] == "rebound-lead"),
        "a departed idle member must also be reported"
    );
}

#[test]
fn regression_task_destinations_accept_exact_identity_and_never_fall_back_from_a_departed_id() {
    let f = Fixture::new();
    f.task(
        "lead-tab",
        RoomTaskOp::Add {
            title: "跨职责但用户明确指定".into(),
            outcome: None,
            assignee: Some(f.ui.id.clone()),
            after: vec![],
        },
    );
    assert_eq!(
        f.state().tasks[0].assignee.as_deref(),
        Some(f.ui.id.as_str())
    );
    f.task(
        "lead-tab",
        RoomTaskOp::Assign {
            task: "T1".into(),
            assignee: f.data.id.clone(),
        },
    );
    assert_eq!(
        f.state().tasks[0].assignee.as_deref(),
        Some(f.data.id.as_str())
    );
    f.store
        .mutate(&f.room, |room| {
            assert!(
                ops::add_member(
                    room,
                    "duplicate",
                    "codex",
                    "寻溪",
                    "another duty",
                    false,
                    501
                )
                .is_err()
            );
            ops::remove_member(room, &f.data.id, 502)?;
            ops::add_member(
                room,
                "replacement-tab",
                "codex",
                "寻溪",
                "不同的新成员职责",
                false,
                503,
            )?;
            Ok(())
        })
        .unwrap();
    let state = f.state();
    let replacement = state.member_by_title("寻溪").unwrap();
    assert_ne!(replacement.id, f.data.id);
    let error = f.directory().handle(
        "lead-tab",
        &Command::RoomTask {
            room: None,
            op: RoomTaskOp::Assign {
                task: "T1".into(),
                assignee: f.data.id.clone(),
            },
        },
    );
    assert!(error.is_err());
    assert!(f.state().tasks[0].assignee.is_none());
    f.task(
        "lead-tab",
        RoomTaskOp::Assign {
            task: "T1".into(),
            assignee: "@寻溪".into(),
        },
    );
    assert_eq!(
        f.state().tasks[0].assignee.as_deref(),
        Some(replacement.id.as_str())
    );
    record("identity-routing-final", &f.state());
}

#[test]
fn ui_task_requests_keep_the_selected_identity_and_reject_departed_or_unknown_ids() {
    #[derive(serde::Deserialize)]
    struct Request {
        id: String,
        op: RoomTaskOp,
    }
    let f = Fixture::new();
    let submit = |value: serde_json::Value| {
        record("ui-task-request", &value);
        let request: Request = serde_json::from_value(value).unwrap();
        let result = f.store.mutate(&request.id, |room| {
            super::commands::apply_task_op(room, &Actor::User, &request.op, now_millis())
        });
        match &result {
            Ok(((_, posted), room)) => {
                f.store
                    .enqueue_posts(&f.board, &f.registry, &deliveries(room, posted))
                    .unwrap();
                record("ui-task-response", room);
            }
            Err(error) => record("ui-task-error", error),
        }
        result
    };
    f.store
        .mutate(&f.room, |room| {
            ops::update_member(room, &f.data.id, Some("Cedar"), None, None, 500)?;
            ops::add_member(
                room,
                "replacement-tab",
                "codex",
                "寻溪",
                "核对付款记录",
                false,
                501,
            )
        })
        .unwrap();
    f.drain("ui-before-add");
    submit(serde_json::json!({"id":f.room, "op":{"op":"add", "title":"Inspect a sample", "outcome":null, "assignee":f.data.id, "after":[]}})).unwrap();
    assert_eq!(
        f.state().tasks[0].assignee.as_deref(),
        Some(f.data.id.as_str())
    );
    assert_eq!(f.state().tasks[0].created_by, "user");
    assert!(f.drain("ui-created-owner").iter().any(|entry| {
        entry["to"] == "data-tab"
            && entry["injection"]
                .as_str()
                .unwrap()
                .contains("Inspect a sample")
    }));
    submit(serde_json::json!({"id":f.room, "op":{"op":"add", "title":"Assign sample", "outcome":null, "assignee":f.ui.id, "after":[]}})).unwrap();
    submit(
        serde_json::json!({"id":f.room, "op":{"op":"assign", "task":"T2", "assignee":f.data.id}}),
    )
    .unwrap();
    assert_eq!(
        f.state().tasks[1].assignee.as_deref(),
        Some(f.data.id.as_str())
    );
    f.drain("ui-assigned-owner");
    f.store
        .mutate(&f.room, |room| ops::remove_member(room, &f.data.id, 600))
        .unwrap();
    f.drain("ui-selected-member-left");
    let unchanged = serde_json::to_value(f.state()).unwrap();
    for id in [f.data.id.as_str(), "01h000000000000000000000000"] {
        for op in [
            serde_json::json!({"op":"add", "title":"Must not be created", "outcome":null, "assignee":id, "after":[]}),
            serde_json::json!({"op":"assign", "task":"T2", "assignee":id}),
        ] {
            assert!(submit(serde_json::json!({"id":f.room,"op":op})).is_err());
            assert_eq!(serde_json::to_value(f.state()).unwrap(), unchanged);
            assert!(f.board.snapshot().is_empty());
        }
    }
    let persisted = RoomStore::load(Some(f.root.join("rooms")))
        .get(&f.room)
        .unwrap();
    assert_eq!(serde_json::to_value(&persisted).unwrap(), unchanged);
    record("ui-rejected-requests-persisted", &persisted);
}

#[test]
fn regression_room_status_uses_the_same_rules_and_current_load_dependency_and_activity() {
    let f = Fixture::new();
    f.task(
        "lead-tab",
        RoomTaskOp::Add {
            title: "存储准备".into(),
            outcome: None,
            assignee: Some("寻溪".into()),
            after: vec![],
        },
    );
    f.task(
        "lead-tab",
        RoomTaskOp::Add {
            title: "存储迁移".into(),
            outcome: None,
            assignee: Some("寻溪".into()),
            after: vec!["T1".into()],
        },
    );
    let (before, _) = f
        .directory()
        .handle("lead-tab", &Command::RoomStatus { room: None })
        .unwrap();
    let before = serde_json::to_value(before).unwrap();
    record("status-before-activity", &before);
    let context = before["status"]["coordination"]
        .as_str()
        .expect("status must carry the shared scheduling context");
    assert_context(context, DATA);
    assert!(
        context.contains(&f.data.id)
            && context.contains("T1")
            && context.contains("T2")
            && context.contains("talking")
    );
    f.activity("idle", "talking");
    let (after, _) = f
        .directory()
        .handle("lead-tab", &Command::RoomStatus { room: None })
        .unwrap();
    let after = serde_json::to_value(after).unwrap();
    record("status-after-activity", &after);
    assert_ne!(
        before["status"]["coordination"],
        after["status"]["coordination"]
    );
    assert_eq!(
        f.state().tasks[0].assignee.as_deref(),
        Some(f.data.id.as_str()),
        "busy/idle changes must not reroute work"
    );
}
