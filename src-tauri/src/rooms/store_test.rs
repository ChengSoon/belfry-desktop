use std::fs;
use std::path::PathBuf;

use super::commands::prepare_dispatches;
use super::store::*;
use crate::collab::{RoomDirectory, SessionRegistry, SessionSnapshot};
use crate::collab::task::{self, TaskBoard, TaskRequest, TaskState, Verdict};

fn temp_path(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("belfry-rooms-{tag}-{}", ulid::Ulid::generate()));
    fs::create_dir_all(&dir).unwrap();
    dir.join("rooms.json")
}

fn cleanup(path: &PathBuf) {
    if let Some(dir) = path.parent() {
        let _ = fs::remove_dir_all(dir);
    }
}

fn session(tab_id: &str, name: &str, can_receive: bool, project_root: &str) -> SessionSnapshot {
    SessionSnapshot {
        tab_id: tab_id.into(),
        name: Some(name.into()),
        title: name.into(),
        agent: "claude".into(),
        activity: "idle".into(),
        can_receive,
        project_root: Some(project_root.into()),
    }
}

/// 一个带一位成员的房间，落在独立临时目录里。
fn seeded(tag: &str) -> (RoomStore, PathBuf, Room) {
    let path = temp_path(tag);
    let store = RoomStore::load(Some(path.clone()));
    let room = store.create("登录体验小组", "/proj/demo").unwrap();
    store
        .add_member(&room.id, "tab-a", "claude", "登录页实现", "实现登录交互")
        .unwrap();
    let room = store.get(&room.id).unwrap();
    (store, path, room)
}

/// 直接往房间里记一条派发（绕过投递编排；编排在 prepare_dispatches 用例里测）。
fn record(store: &RoomStore, room_id: &str, bus_id: &str, member_id: &str) {
    let now = now_millis();
    let task = RoomTask {
        id: new_id(),
        title: "登录失败：内联错误与重试".into(),
        text: "把登录失败的错误提示统一成内联样式，并补上重试按钮".into(),
        member_ids: vec![member_id.to_string()],
        acceptance: Vec::new(),
        created_at: now,
        stage: TaskStage::Dispatching,
        attempt: 1,
        deliveries: vec![Delivery {
            member_id: member_id.to_string(),
            bus_task_id: Some(bus_id.to_string()),
            state: DeliveryState::Queued,
            result: None,
            at: now,
        }],
        verified_at: None,
        verification_note: None,
        rejected_at: None,
        rejection_note: None,
        stopped_at: None,
        artifact: None,
    };
    let message = RoomMessage {
        id: new_id(),
        at: now,
        kind: MessageKind::User,
        author: "user".into(),
        text: "把登录失败的错误提示统一成内联样式，并补上重试按钮".into(),
        member_ids: vec![member_id.to_string()],
        task_id: Some(task.id.clone()),
        delivered_to: Vec::new(),
        reply_to: None,
        reactions: Vec::new(),
        recalled_at: None,
    };
    store.record_dispatch(room_id, task, message).unwrap();
}

fn board_task(bus_id: &str, to: &str) -> task::CollabTask {
    let request = TaskRequest {
        from: "room:test",
        to,
        instruction: "把登录失败的错误提示统一成内联样式",
        parent: None,
    };
    task::build_task(bus_id.to_string(), &request, 0, &Verdict::Allowed)
}

/// 成员互相转手的任务：和房间派发一样在总线上，只是不挂在 RoomTask 下面。
fn handoff_task(bus_id: &str, from: &str, to: &str) -> task::CollabTask {
    let request = TaskRequest {
        from,
        to,
        instruction: "你接着写",
        parent: None,
    };
    task::build_task(bus_id.to_string(), &request, 0, &Verdict::Allowed)
}

#[test]
fn rooms_persist_across_reloads() {
    let path = temp_path("roundtrip");
    {
        let store = RoomStore::load(Some(path.clone()));
        let room = store.create("登录体验小组", "/proj/demo").unwrap();
        store
            .add_member(&room.id, "tab-a", "claude", "登录页实现", "实现登录交互")
            .unwrap();
    }
    let reloaded = RoomStore::load(Some(path.clone()));
    let view = reloaded.list().unwrap();
    assert!(view.load_error.is_none());
    assert_eq!(view.rooms.len(), 1);
    assert_eq!(view.rooms[0].name, "登录体验小组");
    assert_eq!(view.rooms[0].member_count, 1);
    assert_eq!(view.rooms[0].member_tab_ids, vec!["tab-a".to_string()]);
    let room = reloaded.get(&view.rooms[0].id).unwrap();
    assert_eq!(room.members[0].role, "登录页实现");
    assert_eq!(room.members[0].tab_id, "tab-a");
    assert_eq!(room.members[0].duty, "实现登录交互");
    cleanup(&path);
}

#[test]
fn room_list_reports_latest_message_time_for_unread_badges() {
    let (store, path, room) = seeded("summary-unread");
    // 建成员写了一条「加入了房间」的系统注记，一开始就有最新时刻。
    let first = store.list().unwrap().rooms[0]
        .last_message_at
        .expect("加入房间的系统注记应给出最新时刻");
    std::thread::sleep(std::time::Duration::from_millis(5));
    store.member_say("tab-a", None, "冒个泡", None).unwrap();
    let after = store.list().unwrap().rooms[0].last_message_at.unwrap();
    assert!(after > first, "新发言把最新时刻往前推");
    // 清空聊天记录后回到 None：列表未读标记随之失去依据。
    store.clear_messages(&room.id).unwrap();
    assert_eq!(store.list().unwrap().rooms[0].last_message_at, None);
    cleanup(&path);
}

#[test]
fn an_unknown_store_version_stays_readonly_and_keeps_the_file() {
    let path = temp_path("version");
    let original = r#"{ "version": 99, "rooms": [] }"#;
    fs::write(&path, original).unwrap();
    let store = RoomStore::load(Some(path.clone()));
    let view = store.list().unwrap();
    assert!(view.rooms.is_empty());
    assert!(view.load_error.is_some(), "版本不认识要如实报错");
    // 修改类命令被拒，且绝不覆盖现场。
    assert!(store.create("新房间", "/proj/demo").is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    cleanup(&path);
}

#[test]
fn duplicate_role_auto_increments_and_duplicate_tab_is_rejected() {
    let (store, path, room) = seeded("role");
    let room = store
        .add_member(&room.id, "tab-b", "claude", "登录页实现", "")
        .unwrap();
    assert_eq!(room.members.len(), 2);
    assert_eq!(room.members[1].role, "登录页实现 2");
    // 同一条会话不能重复入房。
    assert!(store.add_member(&room.id, "tab-a", "claude", "别的", "").is_err());
    cleanup(&path);
}

#[test]
fn dispatch_prepares_one_bus_task_per_member_with_room_origin() {
    let (store, path, room) = seeded("dispatch");
    let room = store
        .add_member(&room.id, "tab-b", "codex", "代码审查", "审查改动")
        .unwrap();
    let registry = SessionRegistry::default();
    registry.replace(vec![
        session("tab-a", "impl", true, "/proj/demo"),
        session("tab-b", "review", true, "/proj/demo"),
    ]);
    let member_ids: Vec<String> = room.members.iter().map(|m| m.id.clone()).collect();
    let prepared =
        prepare_dispatches(&room, &registry, "一起把过期跳转的提示定下来", &member_ids, 0)
            .unwrap();
    assert_eq!(prepared.len(), 2);
    for (member_id, built) in &prepared {
        assert!(member_ids.contains(member_id));
        assert_eq!(built.state, TaskState::Queued);
        assert_eq!(built.from, format!("room:{}", room.id));
        match &built.origin {
            Some(task::TaskOrigin::Room { name, .. }) => assert_eq!(name, "登录体验小组"),
            None => panic!("房间派发必须带来源标记，面板才能显示房间名"),
        }
    }
    // 同一成员被选两次：直接拒绝，不产生重复投递。
    let duplicated = vec![member_ids[0].clone(), member_ids[0].clone()];
    assert!(prepare_dispatches(&room, &registry, "x", &duplicated, 0).is_err());
    cleanup(&path);
}

#[test]
fn dispatch_rejects_offline_busy_and_cross_project_members() {
    let (_store, path, room) = seeded("reject");
    let member_id = room.members[0].id.clone();
    // 会话不在了。
    assert!(prepare_dispatches(&room, &SessionRegistry::default(), "x", &[member_id.clone()], 0).is_err());
    // 现在收不了指令（正忙或在权限框）。
    let busy = SessionRegistry::default();
    busy.replace(vec![session("tab-a", "impl", false, "/proj/demo")]);
    assert!(prepare_dispatches(&room, &busy, "x", &[member_id.clone()], 0).is_err());
    // 跨项目：房间挂在 /proj/demo，成员会话在别的项目里。
    let cross = SessionRegistry::default();
    cross.replace(vec![session("tab-a", "impl", true, "/elsewhere")]);
    assert!(prepare_dispatches(&room, &cross, "x", &[member_id], 0).is_err());
    cleanup(&path);
}

#[test]
fn reconcile_records_submission_and_verification_closes_the_loop() {
    let (store, path, room) = seeded("reconcile");
    let member_id = room.members[0].id.clone();
    let board = TaskBoard::default();
    board.insert(board_task("bus-1", "tab-a"));
    record(&store, &room.id, "bus-1", &member_id);
    board.mark_dispatched("bus-1");
    board
        .settle("bus-1", "tab-a", TaskState::Done, Some("都过了，3 个 skip".into()))
        .unwrap();

    store.reconcile(&board, 111).unwrap();
    let room = store.get(&room.id).unwrap();
    let task = &room.tasks[0];
    assert_eq!(task.deliveries[0].state, DeliveryState::Done);
    assert_eq!(task.stage, TaskStage::Submitted);
    assert!(
        room.messages.iter().any(|m| m.kind == MessageKind::Member
            && m.author == member_id
            && m.text.contains("都过了")),
        "带结果的交差要按成员口吻落进时间线"
    );
    // 重复对账不重复记账。
    let message_count = room.messages.len();
    store.reconcile(&board, 222).unwrap();
    assert_eq!(store.get(&room.id).unwrap().messages.len(), message_count);

    // 验证独立于提交：显式通过后闭链，记录带备注。
    let task_id = task.id.clone();
    let room = store
        .verify_task(&room.id, &task_id, Some("证据齐全".into()), 333)
        .unwrap();
    let task = &room.tasks[0];
    assert_eq!(task.stage, TaskStage::Verified);
    assert_eq!(task.verification_note.as_deref(), Some("证据齐全"));
    cleanup(&path);
}

#[test]
fn reconcile_marks_restart_losses_unknown_and_retry_opens_a_new_round() {
    let (store, path, room) = seeded("restart");
    let member_id = room.members[0].id.clone();
    // 模拟应用重启：任务表已清空，旧编号查不到。
    let dead_board = TaskBoard::default();
    record(&store, &room.id, "bus-gone", &member_id);
    store.reconcile(&dead_board, 111).unwrap();
    let room = store.get(&room.id).unwrap();
    let task = &room.tasks[0];
    assert_eq!(task.deliveries[0].state, DeliveryState::Unknown);
    assert_eq!(task.stage, TaskStage::Interrupted);
    assert!(room.messages.iter().any(|m| m.text.contains("投递结果未知")));

    let task_id = task.id.clone();
    let room = store
        .retry_task(&room.id, &task_id, None, 222, vec![(member_id.clone(), "bus-new".into())])
        .unwrap();
    let task = &room.tasks[0];
    assert_eq!(task.attempt, 2);
    assert_eq!(task.stage, TaskStage::Dispatching);
    assert_eq!(task.deliveries[0].bus_task_id.as_deref(), Some("bus-new"));
    assert_eq!(task.deliveries[0].state, DeliveryState::Queued);
    cleanup(&path);
}

#[test]
fn stop_settles_the_task_and_blocks_verification() {
    let (store, path, room) = seeded("stop");
    let member_id = room.members[0].id.clone();
    record(&store, &room.id, "bus-stop", &member_id);
    let task_id = store.get(&room.id).unwrap().tasks[0].id.clone();
    let room = store.stop_task(&room.id, &task_id, 111).unwrap();
    assert_eq!(room.tasks[0].stage, TaskStage::Stopped);
    assert_eq!(room.tasks[0].deliveries[0].state, DeliveryState::Abandoned);
    // 停止后不可验证、不可再停。
    assert!(store.verify_task(&room.id, &task_id, None, 222).is_err());
    assert!(store.stop_task(&room.id, &task_id, 333).is_err());
    cleanup(&path);
}

#[test]
fn verify_requires_a_submitted_task() {
    let (store, path, room) = seeded("verify-gate");
    let member_id = room.members[0].id.clone();
    record(&store, &room.id, "bus-v", &member_id);
    let task_id = store.get(&room.id).unwrap().tasks[0].id.clone();
    assert!(
        store.verify_task(&room.id, &task_id, None, 111).is_err(),
        "成员还没交差时不能验证"
    );
    cleanup(&path);
}

#[test]
fn a_failed_delivery_marks_the_task_failed() {
    let (store, path, room) = seeded("failed");
    let member_id = room.members[0].id.clone();
    let board = TaskBoard::default();
    board.insert(board_task("bus-f", "tab-a"));
    record(&store, &room.id, "bus-f", &member_id);
    board
        .settle("bus-f", "tab-a", TaskState::Failed, Some("依赖没装".into()))
        .unwrap();
    store.reconcile(&board, 111).unwrap();
    let room = store.get(&room.id).unwrap();
    assert_eq!(room.tasks[0].stage, TaskStage::Failed);
    assert!(room.messages.iter().any(|m| m.text.contains("说做不了")));
    cleanup(&path);
}

fn follow_up(member_id: &str, bus_id: &str) -> RoomTask {
    let now = now_millis();
    RoomTask {
        id: new_id(),
        title: "（退回）登录失败：内联错误与重试".into(),
        text: "把登录失败的错误提示统一成内联样式，并补上重试按钮\n\n上一轮验证未通过，退回重做。要求：网络超时没覆盖".into(),
        member_ids: vec![member_id.to_string()],
        acceptance: Vec::new(),
        created_at: now,
        stage: TaskStage::Dispatching,
        attempt: 1,
        deliveries: vec![Delivery {
            member_id: member_id.to_string(),
            bus_task_id: Some(bus_id.to_string()),
            state: DeliveryState::Queued,
            result: None,
            at: now,
        }],
        verified_at: None,
        verification_note: None,
        rejected_at: None,
        rejection_note: None,
        stopped_at: None,
        artifact: None,
    }
}

fn follow_message(member_id: &str, task_id: &str, text: &str) -> RoomMessage {
    RoomMessage {
        id: new_id(),
        at: now_millis(),
        kind: MessageKind::User,
        author: "user".into(),
        text: text.to_string(),
        member_ids: vec![member_id.to_string()],
        task_id: Some(task_id.to_string()),
        delivered_to: Vec::new(),
        reply_to: None,
        reactions: Vec::new(),
        recalled_at: None,
    }
}

#[test]
fn reject_requires_a_submitted_task_and_closes_the_loop_with_a_follow_up() {
    let (store, path, room) = seeded("reject-gate");
    let member_id = room.members[0].id.clone();
    record(&store, &room.id, "bus-r", &member_id);
    let task_id = store.get(&room.id).unwrap().tasks[0].id.clone();

    // 成员还没交差：不能退回，也不该留下跟进任务。
    let fu = follow_up(&member_id, "bus-r2");
    let msg = follow_message(&member_id, &fu.id, &fu.text);
    assert!(store.reject_task(&room.id, &task_id, "网络超时没覆盖", 1, fu, msg).is_err());
    assert_eq!(store.get(&room.id).unwrap().tasks.len(), 1);

    // 交差后：退回成功，旧的记已退回，新的开始投递。
    let board = TaskBoard::default();
    board.insert(board_task("bus-r", "tab-a"));
    board.settle("bus-r", "tab-a", TaskState::Done, None).unwrap();
    store.reconcile(&board, 111).unwrap();
    let fu = follow_up(&member_id, "bus-r2");
    let msg = follow_message(&member_id, &fu.id, &fu.text);
    let room = store.reject_task(&room.id, &task_id, "网络超时没覆盖", 222, fu, msg).unwrap();
    assert_eq!(room.tasks.len(), 2);
    let old = &room.tasks[0];
    assert_eq!(old.stage, TaskStage::Rejected);
    assert_eq!(old.rejection_note.as_deref(), Some("网络超时没覆盖"));
    assert!(old.rejected_at.is_some());
    let fresh = &room.tasks[1];
    assert_eq!(fresh.stage, TaskStage::Dispatching);
    assert_eq!(fresh.deliveries[0].state, DeliveryState::Queued);
    assert!(fresh.title.starts_with("（退回）"), "跟进任务标题要能一眼看出是退回的");
    assert!(room.messages.iter().any(|m| m.text.contains("已退回重做")));
    assert_eq!(store.list().unwrap().rooms[0].active_task_count, 1, "退回的旧任务不再算进行中");

    // 同一任务不能退回两次；已退回的任务也不能再验证。
    let fu = follow_up(&member_id, "bus-r3");
    let msg = follow_message(&member_id, &fu.id, &fu.text);
    assert!(store.reject_task(&room.id, &task_id, "再退一次", 333, fu, msg).is_err());
    assert!(store.verify_task(&room.id, &task_id, None, 444).is_err());
    // 空反馈直接拒绝（先过反馈校验，再谈状态）。
    let follow_up_id = store.get(&room.id).unwrap().tasks[1].id.clone();
    let fu = follow_up(&member_id, "bus-r4");
    let msg = follow_message(&member_id, &fu.id, &fu.text);
    assert!(store.reject_task(&room.id, &follow_up_id, "   ", 555, fu, msg).is_err());
    cleanup(&path);
}

#[test]
fn per_member_retry_only_covers_the_chosen_deliveries() {
    let (store, path, room) = seeded("member-retry");
    let room = store
        .add_member(&room.id, "tab-b", "codex", "代码审查", "")
        .unwrap();
    let a = room.members[0].id.clone();
    let b = room.members[1].id.clone();
    let now = now_millis();
    let task = RoomTask {
        id: new_id(),
        title: "双人任务".into(),
        text: "一起核对".into(),
        member_ids: vec![a.clone(), b.clone()],
        acceptance: Vec::new(),
        created_at: now,
        stage: TaskStage::Dispatching,
        attempt: 1,
        deliveries: vec![
            Delivery {
                member_id: a.clone(),
                bus_task_id: Some("bus-a".into()),
                state: DeliveryState::Done,
                result: Some("好了".into()),
                at: now,
            },
            Delivery {
                member_id: b.clone(),
                bus_task_id: Some("bus-b".into()),
                state: DeliveryState::Unknown,
                result: None,
                at: now,
            },
        ],
        verified_at: None,
        verification_note: None,
        rejected_at: None,
        rejection_note: None,
        stopped_at: None,
        artifact: None,
    };
    let message = RoomMessage {
        id: new_id(),
        at: now,
        kind: MessageKind::User,
        author: "user".into(),
        text: "一起核对".into(),
        member_ids: vec![a.clone(), b.clone()],
        task_id: Some(task.id.clone()),
        delivered_to: Vec::new(),
        reply_to: None,
        reactions: Vec::new(),
        recalled_at: None,
    };
    let room = store.record_dispatch(&room.id, task, message).unwrap();
    let task_id = room.tasks[0].id.clone();

    // 只补投 B：A 的结果一个字都不动。
    let room = store
        .retry_task(&room.id, &task_id, Some(vec![b.clone()]), 111, vec![(b.clone(), "bus-b2".into())])
        .unwrap();
    let task = &room.tasks[0];
    assert_eq!(task.attempt, 2);
    assert_eq!(task.deliveries[0].state, DeliveryState::Done, "没被选中的投递不该被重置");
    assert_eq!(task.deliveries[0].result.as_deref(), Some("好了"));
    assert_eq!(task.deliveries[1].state, DeliveryState::Queued);
    assert_eq!(task.deliveries[1].bus_task_id.as_deref(), Some("bus-b2"));
    assert_eq!(task.stage, TaskStage::Running, "一条交差、一条在途");

    // 已交差的那条不能重派；整体重派也不认在途的任务。
    assert!(store
        .retry_task(&room.id, &task_id, Some(vec![a.clone()]), 222, vec![(a.clone(), "bus-a2".into())])
        .is_err());
    assert!(store
        .retry_task(&room.id, &task_id, None, 222, vec![(a.clone(), "x".into()), (b.clone(), "y".into())])
        .is_err());

    // 失败的那条可以补投；交差记录保留。
    let board = TaskBoard::default();
    board.insert(board_task("bus-b2", "tab-b"));
    board.settle("bus-b2", "tab-b", TaskState::Failed, Some("依赖没装".into())).unwrap();
    store.reconcile(&board, 333).unwrap();
    let room = store.get(&room.id).unwrap();
    assert_eq!(room.tasks[0].stage, TaskStage::Failed);
    let room = store
        .retry_task(&room.id, &task_id, Some(vec![b.clone()]), 444, vec![(b.clone(), "bus-b3".into())])
        .unwrap();
    assert_eq!(room.tasks[0].stage, TaskStage::Running);
    assert_eq!(room.tasks[0].attempt, 3);
    assert_eq!(room.tasks[0].deliveries[0].state, DeliveryState::Done);
    cleanup(&path);
}

#[test]
fn pending_reviews_lists_only_submitted_tasks() {
    let (store, path, room) = seeded("pending");
    let member_id = room.members[0].id.clone();
    let board = TaskBoard::default();
    board.insert(board_task("bus-p", "tab-a"));
    record(&store, &room.id, "bus-p", &member_id);
    assert!(store.pending_reviews().unwrap().is_empty(), "投递中还不算待验证");
    board.settle("bus-p", "tab-a", TaskState::Done, None).unwrap();
    store.reconcile(&board, 111).unwrap();
    let pending = store.pending_reviews().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].room_name, "登录体验小组");
    assert!(pending[0].title.contains("登录失败"));
    let task_id = store.get(&room.id).unwrap().tasks[0].id.clone();
    store.verify_task(&room.id, &task_id, None, 222).unwrap();
    assert!(store.pending_reviews().unwrap().is_empty(), "验证后从待验证清单消失");
    cleanup(&path);
}

#[test]
fn stage_labels_match_the_ui_wording() {
    assert_eq!(stage_label(TaskStage::Dispatching), "排队投递中");
    assert_eq!(stage_label(TaskStage::Running), "进行中");
    assert_eq!(stage_label(TaskStage::Submitted), "已提交待验证");
    assert_eq!(stage_label(TaskStage::Interrupted), "结果未知");
    assert_eq!(stage_label(TaskStage::Verified), "验证通过");
    assert_eq!(stage_label(TaskStage::Rejected), "已退回重做");
    assert_eq!(stage_label(TaskStage::Stopped), "已停止");
    assert_eq!(stage_label(TaskStage::Failed), "有人交不了");
}

#[test]
fn room_directory_lists_my_rooms_with_open_tasks() {
    let (store, path, room) = seeded("directory");
    let member_id = room.members[0].id.clone();
    record(&store, &room.id, "bus-dir", &member_id);

    let briefs = store.my_rooms("tab-a");
    assert_eq!(briefs.len(), 1);
    assert_eq!(briefs[0].name, "登录体验小组");
    assert_eq!(briefs[0].my_role, "登录页实现");
    assert_eq!(briefs[0].members, vec!["登录页实现".to_string()]);
    assert_eq!(briefs[0].tasks.len(), 1);
    assert_eq!(briefs[0].tasks[0].stage, "排队投递中");
    assert_eq!(
        briefs[0].tasks[0].receivers,
        vec!["登录页实现".to_string()]
    );

    // 不在这间房里的会话看不到它。
    assert!(store.my_rooms("tab-zzz").is_empty());

    // 结账的活从留意清单消失。
    let task_id = store.get(&room.id).unwrap().tasks[0].id.clone();
    store.stop_task(&room.id, &task_id, 1).unwrap();
    assert!(store.my_rooms("tab-a")[0].tasks.is_empty(), "已停止的任务不再占用留意清单");
    cleanup(&path);
}

#[test]
fn reconcile_captures_artifact_when_a_delivery_lands() {
    let (store, path, room) = seeded("artifact");
    let member_id = room.members[0].id.clone();
    let board = TaskBoard::default();
    board.insert(board_task("bus-a", "tab-a"));
    record(&store, &room.id, "bus-a", &member_id);

    let calls = std::cell::Cell::new(0);
    let capture = |root: &str| {
        calls.set(calls.get() + 1);
        Some(TaskArtifact {
            captured_at: 999,
            truncated: false,
            text: format!("diff for {root}"),
        })
    };

    // 投递还没交差：不该采集。
    store.reconcile_capturing(&board, 100, &capture).unwrap();
    assert_eq!(calls.get(), 0, "没有交差就没有快照");
    assert!(store.get(&room.id).unwrap().tasks[0].artifact.is_none());

    // 交差后的第一次对账采集；快照不比最新交差旧时不再采集。
    board
        .settle("bus-a", "tab-a", TaskState::Done, None)
        .unwrap();
    store.reconcile_capturing(&board, 200, &capture).unwrap();
    assert_eq!(calls.get(), 1);
    let artifact = store
        .get(&room.id)
        .unwrap()
        .tasks[0]
        .artifact
        .clone()
        .unwrap();
    assert_eq!(artifact.text, "diff for /proj/demo");
    store.reconcile_capturing(&board, 300, &capture).unwrap();
    assert_eq!(calls.get(), 1, "重复对账不重复读 git");

    // 采集失败不报错、不写空证据；「空差异」则是合法证据，写入后同样停止重试。
    let room2 = store.create("第二个房间", "/proj/not-a-repo").unwrap();
    store
        .add_member(&room2.id, "tab-b", "claude", "另一人", "")
        .unwrap();
    let member_b = store.get(&room2.id).unwrap().members[0].id.clone();
    board.insert(board_task("bus-b", "tab-b"));
    record(&store, &room2.id, "bus-b", &member_b);
    board
        .settle("bus-b", "tab-b", TaskState::Done, None)
        .unwrap();
    let failing = |_: &str| None;
    store.reconcile_capturing(&board, 400, &failing).unwrap();
    assert!(
        store.get(&room2.id).unwrap().tasks[0].artifact.is_none(),
        "采集失败就该如实没有快照"
    );

    let empty_calls = std::cell::Cell::new(0);
    let empty = |_: &str| {
        empty_calls.set(empty_calls.get() + 1);
        Some(TaskArtifact {
            captured_at: 500,
            truncated: false,
            text: String::new(),
        })
    };
    store.reconcile_capturing(&board, 600, &empty).unwrap();
    store.reconcile_capturing(&board, 700, &empty).unwrap();
    assert_eq!(empty_calls.get(), 1, "空差异也是快照，写完就不再重试");
    assert_eq!(
        store.get(&room2.id).unwrap().tasks[0]
            .artifact
            .as_ref()
            .unwrap()
            .text,
        ""
    );
    cleanup(&path);
}

#[test]
fn extending_the_room_scope_widens_the_dispatch_gate() {
    let (store, path, room) = seeded("scope");
    let room = store
        .add_member(&room.id, "tab-b", "codex", "审查", "")
        .unwrap();
    let member_b = room.members[1].id.clone();

    // 没扩展之前：跨项目派发仍然被拒。
    let cross = SessionRegistry::default();
    cross.replace(vec![session("tab-b", "review", true, "/elsewhere")]);
    assert!(prepare_dispatches(&room, &cross, "x", &[member_b.clone()], 0).is_err());

    // 扩展范围后：该项目里的成员可以接活。
    let room = store.extend_project(&room.id, "/elsewhere").unwrap();
    assert_eq!(room.extra_roots, vec!["/elsewhere".to_string()]);
    assert!(room.messages.iter().any(|m| m.text.contains("接活范围")));
    let prepared = prepare_dispatches(&room, &cross, "x", &[member_b], 0).unwrap();
    assert_eq!(prepared.len(), 1);

    // 重复扩展是空操作，不留第二遍消息；主项目本身也在范围内。
    let room = store.extend_project(&room.id, "/elsewhere").unwrap();
    assert_eq!(room.extra_roots.len(), 1);
    assert_eq!(
        room.messages
            .iter()
            .filter(|m| m.text.contains("接活范围"))
            .count(),
        1
    );
    assert!(room.covers_project("/proj/demo"));
    cleanup(&path);
}

#[test]
fn a_member_can_say_something_and_mentions_are_parsed() {
    let (store, path, room) = seeded("say");
    let room = store
        .add_member(&room.id, "tab-b", "codex", "审查", "")
        .unwrap();
    let room = store
        .add_member(&room.id, "tab-c", "claude", "测试", "")
        .unwrap();
    let review_id = room.members[1].id.clone();
    let said = store
        .member_say("tab-a", None, "@审查 接口文档更新了", None)
        .unwrap();
    assert_eq!(said.room_name, "登录体验小组");
    assert_eq!(said.sender_role, "登录页实现");
    assert!(said.addressed, "@ 点名：请被点的人回话");
    // 点名收窄投递：只发给被点的人（其余成员收不到这条）。
    let tabs: Vec<&str> = said.recipients.iter().map(|t| t.tab_id.as_str()).collect();
    assert_eq!(tabs, vec!["tab-b"], "点名只投给被点的人");
    assert_eq!(said.mentioned, vec![review_id.clone()], "被点的人也就是投递对象");
    let room = store.get(&room.id).unwrap();
    let message = room.messages.last().unwrap();
    assert_eq!(message.kind, MessageKind::Member);
    assert_eq!(message.author, room.members[0].id);
    assert_eq!(message.member_ids, vec![review_id], "时间线标签只标显式点名");

    // 点名后面还跟着字的算词的一部分：@审查员 不点「审查」，按群发处理。
    let boundary = store
        .member_say("tab-a", None, "@审查员 麻烦看下", None)
        .unwrap();
    assert!(!boundary.addressed, "词的一部分不算点名");
    assert_eq!(boundary.recipients.len(), 2, "群发发给其他全体成员");
    assert!(boundary.mentioned.is_empty(), "没有点名就没有收窄，也没有口径分层");
    let room = store.get(&room.id).unwrap();
    assert!(room.messages.last().unwrap().member_ids.is_empty());
    cleanup(&path);
}

#[test]
fn user_mentions_are_parsed_with_the_same_ruler() {
    let (store, path, room) = seeded("user-mention");
    let room = store
        .add_member(&room.id, "tab-b", "codex", "审查", "")
        .unwrap();
    let room = store
        .add_member(&room.id, "tab-c", "claude", "前端 2", "")
        .unwrap();
    let _ = room;
    let room = store.get(&room.id).unwrap();
    // 用户发言里的 @ 与成员发言同一把尺；收窄投递发生在 room_broadcast 层。
    let mentioned = mentions_in(&room, "@审查 看下这个，其他人同步知晓");
    assert_eq!(mentioned.len(), 1);
    assert_eq!(mentioned[0].tab_id, "tab-b");
    // 边界与成员发言同一把尺：@审查员 不算点「审查」。
    assert!(mentions_in(&room, "@审查员 麻烦看下").is_empty());
    // 长角色名优先：「前端 2」不会被「前端」截胡。
    let room2 = store
        .add_member(&room.id, "tab-d", "claude", "前端", "")
        .unwrap();
    let _ = room2;
    let room = store.get(&room.id).unwrap();
    let mentioned = mentions_in(&room, "@前端 2 你来");
    assert_eq!(mentioned.len(), 1);
    assert_eq!(mentioned[0].tab_id, "tab-c");
    cleanup(&path);
}

#[test]
fn chat_targets_narrow_to_mentions_and_exclude_the_sender() {
    let (store, path, room) = seeded("targets");
    let room = store
        .add_member(&room.id, "tab-b", "codex", "审查", "")
        .unwrap();
    let room = store
        .add_member(&room.id, "tab-c", "claude", "测试", "")
        .unwrap();
    let sender = room.members[0].id.clone();
    let review = room.members[1].id.clone();
    // 不点名：发给除发送者外的全体在场成员。
    let all = chat_targets(&room, &[], Some(&sender));
    assert_eq!(all.len(), 2);
    assert!(all.iter().all(|target| target.member_id != sender));
    // 点名：收窄到被点的人。
    let narrowed = chat_targets(&room, &[review.clone()], Some(&sender));
    assert_eq!(narrowed.len(), 1);
    assert_eq!(narrowed[0].member_id, review);
    cleanup(&path);
}

#[test]
fn a_message_without_mentions_reaches_every_other_member() {
    let (store, path, room) = seeded("shout");
    store
        .add_member(&room.id, "tab-b", "codex", "审查", "")
        .unwrap();
    store
        .add_member(&room.id, "tab-c", "pi", "测试", "")
        .unwrap();
    let said = store.member_say("tab-a", None, "大家同步一下进度", None).unwrap();
    assert!(!said.addressed);
    assert_eq!(said.recipients.len(), 2, "群发发给其他所有成员");
    let tabs: Vec<&str> = said.recipients.iter().map(|t| t.tab_id.as_str()).collect();
    assert!(tabs.contains(&"tab-b") && tabs.contains(&"tab-c"));
    // 时间线上不刷一排全体标签：只有显式点名才进 member_ids。
    let room = store.get(&room.id).unwrap();
    assert!(room.messages.last().unwrap().member_ids.is_empty());
    cleanup(&path);
}

#[test]
fn say_rate_limit_stops_runaway_chatter() {
    let (store, path, _room) = seeded("rate");
    for index in 0..12 {
        store
            .member_say("tab-a", None, &format!("第 {index} 条"), None)
            .unwrap();
    }
    let denied = store.member_say("tab-a", None, "再来一条", None);
    assert!(denied.is_err(), "第 13 条应该被限速拦下");
    cleanup(&path);
}

#[test]
fn room_log_reads_back_the_conversation_for_members_only() {
    let (store, path, room) = seeded("log");
    store.send_message(&room.id, "接口改好了吗", None).unwrap();
    store.member_say("tab-a", None, "我在改，稍等", None).unwrap();
    let log = store.member_log("tab-a", Some("登录体验小组"), 10).unwrap();
    // 建房间/加成员会留系统行；断言落点只看最后两句对话本身。
    let tail: Vec<(&str, &str)> = log
        .lines
        .iter()
        .rev()
        .take(2)
        .rev()
        .map(|line| (line.kind.as_str(), line.author.as_str()))
        .collect();
    assert_eq!(tail, vec![("user", "用户"), ("member", "登录页实现")]);
    assert_eq!(log.lines.last().unwrap().text, "我在改，稍等");

    // 不在房间里的人读不到、也说不了。
    assert!(store.member_log("tab-外", None, 10).is_err());
    assert!(store.member_say("tab-外", None, "有人吗", None).is_err());
    cleanup(&path);
}

#[test]
fn a_done_delivery_with_a_result_is_echoed_in_the_members_voice() {
    let (store, path, room) = seeded("echo");
    let member_id = room.members[0].id.clone();
    let board = TaskBoard::default();
    board.insert(board_task("bus-echo", "tab-a"));
    record(&store, &room.id, "bus-echo", &member_id);
    board.mark_dispatched("bus-echo");
    board
        .settle("bus-echo", "tab-a", TaskState::Done, Some("都改好了".into()))
        .unwrap();
    store.reconcile(&board, 100).unwrap();
    let room = store.get(&room.id).unwrap();
    assert!(
        room.messages.iter().any(|m| m.kind == MessageKind::Member
            && m.author == member_id
            && m.text == "都改好了"
            && m.task_id.is_none()),
        "带结果的交差要按成员口吻落进时间线，且不重复挂任务卡"
    );
    assert!(
        !room.messages
            .iter()
            .any(|m| m.kind == MessageKind::System && m.text.contains("交差了")),
        "带结果的交差不再发系统摘要，免得时间线上说两遍"
    );
    // 重复对账不重复回显。
    let count = room.messages.len();
    store.reconcile(&board, 200).unwrap();
    assert_eq!(store.get(&room.id).unwrap().messages.len(), count);
    cleanup(&path);
}

#[test]
fn a_members_handoff_reply_lands_in_the_timeline() {
    let (store, path, room) = seeded("handoff");
    let room = store.add_member(&room.id, "tab-b", "codex", "审查", "").unwrap();
    let to_member_id = room.members[1].id.clone();
    // 房间点名路径：成员消息本身就是痕迹，不再补系统行。
    store
        .record_delegation(Some(&room.id), "tab-a", "tab-b", "bus-hand", "@审查 你接着写", false)
        .unwrap();
    // send 直派路径：时间线上没有别的痕迹，登记时补一条。
    store
        .record_delegation(None, "tab-a", "tab-b", "bus-direct", "顺带补回归", true)
        .unwrap();
    let room = store.get(&room.id).unwrap();
    assert_eq!(room.delegations.len(), 2);
    assert!(
        room.messages.iter().any(|m| m.kind == MessageKind::System
            && m.text.contains("把任务交给了")
            && m.text.contains("审查")),
        "send 转手要在时间线留痕"
    );

    let board = TaskBoard::default();
    board.insert(handoff_task("bus-hand", "tab-a", "tab-b"));
    board.insert(handoff_task("bus-direct", "tab-a", "tab-b"));
    board.mark_dispatched("bus-hand");
    board
        .settle("bus-hand", "tab-b", TaskState::Done, Some("接手写完了".into()))
        .unwrap();

    store.reconcile(&board, 111).unwrap();
    let room = store.get(&room.id).unwrap();
    assert!(
        room.messages.iter().any(|m| m.kind == MessageKind::Member
            && m.author == to_member_id
            && m.text == "接手写完了"
            && m.task_id.is_none()),
        "转手对象的交差要以他的口吻回显，且不挂任务卡"
    );
    assert!(
        room.delegations
            .iter()
            .find(|entry| entry.bus_task_id == "bus-hand")
            .and_then(|entry| entry.echoed_at)
            .is_some(),
        "回显过的转手要记账，避免重复"
    );
    assert!(
        room.delegations
            .iter()
            .find(|entry| entry.bus_task_id == "bus-direct")
            .is_some_and(|entry| entry.echoed_at.is_none()),
        "还没结的转手保持待回显"
    );

    // 不带结果的交差：系统摘要顶上；重复对账不重复记账。
    board.settle("bus-direct", "tab-b", TaskState::Done, None).unwrap();
    store.reconcile(&board, 222).unwrap();
    let room = store.get(&room.id).unwrap();
    assert!(
        room.messages
            .iter()
            .any(|m| m.kind == MessageKind::System && m.text.contains("「审查」交差了")),
        "不带结果的交差留一条系统摘要"
    );
    let count = room.messages.len();
    store.reconcile(&board, 333).unwrap();
    assert_eq!(store.get(&room.id).unwrap().messages.len(), count);
    cleanup(&path);
}

#[test]
fn a_handoff_needs_both_sides_in_the_room_and_reports_lost_records_once() {
    let (store, path, room) = seeded("handoff-lost");
    let room = store.add_member(&room.id, "tab-b", "codex", "审查", "").unwrap();
    // 只有一边在房里：登记不成立，时间线一无所知。
    store
        .record_delegation(None, "tab-a", "tab-外", "bus-out", "x", true)
        .unwrap();
    assert!(store.get(&room.id).unwrap().delegations.is_empty());

    // 登记后任务记录没了（应用重启）：如实报一次「没能送达」，不重复报。
    store
        .record_delegation(None, "tab-a", "tab-b", "bus-lost", "y", false)
        .unwrap();
    let board = TaskBoard::default();
    store.reconcile(&board, 111).unwrap();
    let room = store.get(&room.id).unwrap();
    assert!(
        room.messages
            .iter()
            .any(|m| m.kind == MessageKind::System && m.text.contains("没能送达")),
        "找回执的任务没了要如实标注结果未知"
    );
    let count = room.messages.len();
    store.reconcile(&board, 222).unwrap();
    assert_eq!(store.get(&room.id).unwrap().messages.len(), count);
    cleanup(&path);
}

#[test]
fn clearing_the_chat_keeps_tasks_decisions_and_delegations() {
    let (store, path, room) = seeded("clear-chat");
    let room = store
        .add_member(&room.id, "tab-b", "codex", "审查", "")
        .unwrap();
    let member_id = room.members[0].id.clone();
    let board = TaskBoard::default();
    board.insert(board_task("bus-chat", "tab-a"));
    record(&store, &room.id, "bus-chat", &member_id);
    store.send_message(&room.id, "一句讨论", None).unwrap();
    store
        .record_delegation(None, "tab-a", "tab-b", "bus-hand-2", "接一下", false)
        .unwrap();
    let task_message = store
        .get(&room.id)
        .unwrap()
        .messages
        .iter()
        .find(|m| m.task_id.is_some())
        .expect("派发消息应该在")
        .id
        .clone();
    store.mark_decision(&room.id, &task_message).unwrap();
    assert!(!store.get(&room.id).unwrap().messages.is_empty());

    let cleared = store.clear_messages(&room.id).unwrap();
    assert!(cleared.messages.is_empty(), "聊天记录要清空");
    assert_eq!(cleared.tasks.len(), 1, "任务保留");
    assert_eq!(cleared.decisions.len(), 1, "决定保留");
    assert_eq!(cleared.delegations.len(), 1, "转手登记保留");

    // 落盘：重载后仍是清空状态，重复清空幂等。
    let reloaded = RoomStore::load(Some(path.clone()));
    let room = reloaded.get(&room.id).unwrap();
    assert!(room.messages.is_empty());
    assert_eq!(room.tasks.len(), 1);
    assert!(reloaded.clear_messages(&room.id).unwrap().messages.is_empty());
    cleanup(&path);
}

#[test]
fn a_delivered_chat_message_records_a_receipt_and_leaves_the_board() {
    let (store, path, room) = seeded("chat-receipt");
    let member_id = room.members[0].id.clone();
    let message_id = new_id();
    store
        .record_chat(&room.id, &message_id, "大家同步一下进度", vec![member_id.clone()], None)
        .unwrap();
    let board = TaskBoard::default();
    board.insert(
        task::chat_task(
            "bus-chat".into(),
            &message_id,
            "room:test",
            "tab-a",
            "用户：大家同步一下进度",
            false,
            0,
        )
        .with_origin(task::TaskOrigin::Room {
            id: room.id.clone(),
            name: room.name.clone(),
        }),
    );
    // 还在排队（防抖里）的群聊不记回执。
    store.reconcile(&board, 111).unwrap();
    let message = store
        .get(&room.id)
        .unwrap()
        .messages
        .into_iter()
        .find(|message| message.id == message_id)
        .unwrap();
    assert!(message.delivered_to.is_empty(), "没送出去不记送达");
    assert!(board.get("bus-chat").is_some(), "还没送达不能回收");

    board.mark_dispatched("bus-chat");
    store.reconcile(&board, 222).unwrap();
    let message = store
        .get(&room.id)
        .unwrap()
        .messages
        .into_iter()
        .find(|message| message.id == message_id)
        .unwrap();
    assert_eq!(message.delivered_to, vec![member_id.clone()], "送达要写回消息");
    assert!(board.get("bus-chat").is_none(), "回执记录后任务回收");
    // 重复对账不再变化。
    store.reconcile(&board, 333).unwrap();
    let message = store
        .get(&room.id)
        .unwrap()
        .messages
        .into_iter()
        .find(|message| message.id == message_id)
        .unwrap();
    assert_eq!(message.delivered_to, vec![member_id]);
    cleanup(&path);
}

#[test]
fn a_quote_reply_rides_along_and_must_point_at_a_live_message() {
    let (store, path, room) = seeded("quote");
    let first = store.send_message(&room.id, "先发一条", None).unwrap();
    let first_id = first.messages.last().unwrap().id.clone();
    let room = store
        .record_chat(
            &room.id,
            &new_id(),
            "接着这条说",
            Vec::new(),
            Some(first_id.clone()),
        )
        .unwrap();
    let last = room.messages.last().unwrap();
    assert_eq!(last.reply_to.as_deref(), Some(first_id.as_str()));
    // 引用不存在的消息：直接拒绝，不落一条悬空的引用。
    assert!(
        store
            .record_chat(&room.id, &new_id(), "引用幽灵", Vec::new(), Some("msg-ghost".into()))
            .is_err(),
        "引用必须指向房间里真实存在的消息"
    );
    cleanup(&path);
}

#[test]
fn a_member_can_quote_a_message_by_its_short_id() {
    let (store, path, room) = seeded("member-quote");
    store
        .add_member(&room.id, "tab-b", "codex", "审查", "")
        .unwrap();
    let room = store.send_message(&room.id, "先把接口定下来", None).unwrap();
    let source = room.messages.last().unwrap().clone();
    let short = short_msg_id(&source.id);
    let said = store
        .member_say("tab-a", None, "收到，我按这个改", Some(&short))
        .unwrap();
    assert!(
        said.reply_preview.as_deref().is_some_and(|preview| preview.contains("回复 [")
            && preview.contains("用户")
            && preview.contains("先把接口定下来")),
        "引用摘要要带上短 id 与原话：{:?}",
        said.reply_preview
    );
    let room = store.get(&room.id).unwrap();
    let last = room.messages.last().unwrap();
    assert_eq!(last.reply_to.as_deref(), Some(source.id.as_str()), "落库为完整 id");
    // 幽灵 id：当场拒绝，不落一条悬空引用。
    assert!(store.member_say("tab-a", None, "引用幽灵", Some("zzzzzzzz")).is_err());
    // 也认完整 id。
    let full = store
        .member_say("tab-a", None, "完整 id 也能引用", Some(source.id.as_str()))
        .unwrap();
    assert!(full.reply_preview.is_some());
    // room log 也带引用摘录：成员补课要看得懂在回哪句。
    let log = store.member_log("tab-b", None, 5).unwrap();
    let line = log
        .lines
        .iter()
        .find(|line| line.text.contains("收到，我按这个改"))
        .expect("回复行应在 log 里");
    assert!(
        line.reply_preview.as_deref().is_some_and(|preview| preview.contains("回复 [")
            && preview.contains("先把接口定下来")),
        "log 行要带引用摘录：{:?}",
        line.reply_preview
    );
    cleanup(&path);
}

#[test]
fn the_user_can_recall_a_chat_message_but_not_a_dispatch() {
    let (store, path, room) = seeded("recall");
    let sent = store.send_message(&room.id, "手滑发错了", None).unwrap();
    let chat_id = sent.messages.last().unwrap().id.clone();
    // 撤回一条群聊消息：打卡标记，正文留着（供审计与 log 说明），成员读到如实说明。
    let (recalled, id) = store.recall_message(&room.id, &short_msg_id(&chat_id)).unwrap();
    assert_eq!(id, chat_id);
    let message = recalled.messages.last().unwrap();
    assert!(message.recalled_at.is_some(), "撤回要打卡");
    assert_eq!(message.text, "手滑发错了", "正文留着");
    let log = store.member_log("tab-a", None, 5).unwrap();
    assert!(
        log.lines.iter().any(|line| line.text.contains("已撤回")),
        "成员读到的应是「已撤回」，不是原文"
    );
    // 重复撤回、幽灵消息一律拒绝。
    assert!(store.recall_message(&room.id, &chat_id).is_err(), "不能撤两次");
    assert!(store.recall_message(&room.id, "zzzzzzzz").is_err(), "幽灵消息要拒绝");
    cleanup(&path);
}

#[test]
fn members_and_the_user_can_react_and_toggle_by_emoji() {
    let (store, path, room) = seeded("react");
    store
        .add_member(&room.id, "tab-b", "codex", "审查", "")
        .unwrap();
    let room = store.send_message(&room.id, "把接口定下来", None).unwrap();
    let message = room.messages.last().unwrap().clone();
    // 成员点上 👍；同一个表情再点一次是取消。
    let first = store
        .member_react("tab-b", None, &short_msg_id(&message.id), "👍")
        .unwrap();
    assert!(first.active);
    assert_eq!(first.message_short, short_msg_id(&message.id));
    assert_eq!(store.get(&room.id).unwrap().messages.last().unwrap().reactions.len(), 1);
    let second = store.member_react("tab-b", None, &message.id, "👍").unwrap();
    assert!(!second.active, "同一个表情再点一次是取消");
    assert!(store.get(&room.id).unwrap().messages.last().unwrap().reactions.is_empty());
    // 用户侧（界面）也能点；白名单外的表情、幽灵消息、不在房里的人一律拒绝。
    store.user_react(&room.id, &message.id, "✅").unwrap();
    assert!(store.user_react(&room.id, &message.id, "🚀").is_err(), "白名单外的表情要拒绝");
    assert!(store.member_react("tab-b", None, "zzzzzzzz", "👍").is_err());
    assert!(store.member_react("tab-外", None, &message.id, "👍").is_err());
    // room log 带上计数（成员在 log 里能看到谁被「收到」了）。
    let log = store.member_log("tab-b", None, 5).unwrap();
    let line = log
        .lines
        .iter()
        .find(|line| line.text.contains("把接口定下来"))
        .unwrap();
    assert!(
        line.reactions.iter().any(|entry| entry.emoji == "✅" && entry.count == 1),
        "log 要带回应计数：{:?}",
        line.reactions
    );
    cleanup(&path);
}
