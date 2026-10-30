use super::*;

fn target(exists: bool, can_receive: bool, same_project: bool) -> TargetInfo {
    TargetInfo {
        exists,
        can_receive,
        same_project,
    }
}

fn ok_target() -> TargetInfo {
    target(true, true, true)
}

fn request<'a>(from: &'a str, to: &'a str, parent: Option<&'a CollabTask>) -> TaskRequest<'a> {
    TaskRequest {
        from,
        to,
        instruction: "看一下队列回滚",
        parent,
    }
}

fn task_at(from: &str, to: &str, hop: u8, path: &[&str]) -> CollabTask {
    CollabTask {
        id: "01ABCDEF".into(),
        from: from.into(),
        to: to.into(),
        instruction: "上一手".into(),
        state: TaskState::Dispatched,
        hop,
        path: path.iter().map(|node| (*node).to_string()).collect(),
        created_at: 0,
        result: None,
        origin: None,
        chat: None,
        due_at: 0,
    }
}

#[test]
fn chat_deliveries_carry_conversation_not_task_paperwork() {
    let task = chat_task("01CHAT".into(), "msg-1", "t2", "t3", "前端：接口文档更新了", false, 0);
    assert_eq!(task.state, TaskState::Queued);
    assert!(matches!(task.chat, Some(ChatDelivery { mentioned: false, .. })));
    let injected = injection_text(&task, "发布检查");
    assert!(injected.contains("群聊") && injected.contains("前端：接口文档更新了"));
    assert!(injected.contains("看见即可") && injected.contains("room say"));
    assert!(!injected.contains("belfry done"), "聊天不该要求交差：{injected}");

    // 点名：请对方回一句，同样没有任务号。
    let mentioned = chat_task("01MENT".into(), "msg-2", "t2", "t3", "前端：你看下", true, 0);
    let injected = injection_text(&mentioned, "发布检查");
    assert!(injected.contains("点了你的名") && injected.contains("请回一句"), "点名要请对方接话：{injected}");
    assert!(injected.contains("belfry room say") && !injected.contains("belfry done"));
}

#[test]
fn a_burst_of_chat_merges_into_the_pending_delivery() {
    let board = TaskBoard::default();
    let origin = TaskOrigin::Room {
        id: "r1".into(),
        name: "发布检查".into(),
    };
    board.insert(
        chat_task("01A".into(), "msg-1", "t2", "t3", "前端：第一句", false, 1_000).with_origin(origin),
    );
    assert!(board.append_pending_chat("t3", "r1", "审查：第二句", "msg-2", 5_000, true));
    let task = board.get("01A").unwrap();
    assert_eq!(task.instruction, "前端：第一句\n审查：第二句");
    assert!(
        matches!(task.chat, Some(ChatDelivery { mentioned: true, .. })),
        "点名只升级不降级"
    );
    assert_eq!(
        task.chat.as_ref().unwrap().message_ids,
        vec!["msg-1".to_string(), "msg-2".to_string()],
        "合并后的投递要带上两句话各自的消息 id"
    );
    assert_eq!(task.due_at, 5_000 + CHAT_DEBOUNCE_MS, "有人还在说：投递往后顺延");
    // 已送达的投递不能再并：新消息得另起一条，绝不能往已经打进终端的文字里追加。
    board.mark_dispatched("01A");
    assert!(!board.append_pending_chat("t3", "r1", "审查：第三句", "msg-3", 6_000, false));
    // 超出窗口同样不并。
    board.insert(chat_task("01B".into(), "msg-4", "t2", "t4", "前端：第一句", false, 10_000).with_origin(
        TaskOrigin::Room {
            id: "r1".into(),
            name: "发布检查".into(),
        },
    ));
    assert!(!board.append_pending_chat(
        "t4",
        "r1",
        "审查：太久了",
        "msg-5",
        10_000 + CHAT_MERGE_WINDOW_MS + 1,
        false
    ));
}

#[test]
fn pending_chat_waits_for_the_debounce_before_delivery() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let board = TaskBoard::default();
    let request = request("t1", "t2", None);
    board.insert(build_task("01TASK".into(), &request, now, &Verdict::Allowed));
    board.insert(chat_task("01CHAT".into(), "msg-1", "t1", "t3", "闲聊", false, now));
    let pending = board.pending();
    assert_eq!(pending.len(), 1, "防抖期内的群聊不出投递");
    assert!(pending[0].chat.is_none(), "先出的是普通任务");
}

#[test]
fn chat_deliveries_do_not_eat_the_dispatch_budget() {
    let board = TaskBoard::default();
    board.insert(chat_task("01A".into(), "msg-1", "t1", "t2", "闲聊", false, 0));
    assert_eq!(board.count_in_path("t1"), 0, "群聊不占派活预算");
}

#[test]
fn a_plain_request_needs_approval_by_default() {
    // 默认 Ask：项目的取向是不静默做危险的事。
    let verdict = judge(
        &request("t1", "t2", None),
        &ok_target(),
        ApprovalMode::Ask,
        0,
    );
    assert_eq!(verdict, Verdict::NeedsApproval);
}

#[test]
fn auto_in_project_skips_the_prompt() {
    let verdict = judge(
        &request("t1", "t2", None),
        &ok_target(),
        ApprovalMode::AutoInProject,
        0,
    );
    assert_eq!(verdict, Verdict::Allowed);
}

#[test]
fn sending_to_yourself_is_rejected() {
    // 自己派给自己会变成一个自己等自己的死结。
    let verdict = judge(
        &request("t1", "t1", None),
        &ok_target(),
        ApprovalMode::Off,
        0,
    );
    assert!(matches!(verdict, Verdict::Rejected(_)));
}

#[test]
fn an_empty_instruction_is_rejected() {
    let mut req = request("t1", "t2", None);
    req.instruction = "   \n  ";
    assert!(matches!(
        judge(&req, &ok_target(), ApprovalMode::Off, 0),
        Verdict::Rejected(_)
    ));
}

#[test]
fn a_missing_or_busy_target_is_rejected() {
    for info in [target(false, true, true), target(true, false, true)] {
        assert!(matches!(
            judge(&request("t1", "t2", None), &info, ApprovalMode::Off, 0),
            Verdict::Rejected(_)
        ));
    }
}

#[test]
fn cross_project_is_rejected_even_with_approvals_off() {
    // 跨项目不是「危险但用户认了」，是共享上下文和工作目录都对不上，
    // 派过去也做不对——所以连 Off 都不放行。
    let verdict = judge(
        &request("t1", "t2", None),
        &target(true, true, false),
        ApprovalMode::Off,
        0,
    );
    assert!(matches!(verdict, Verdict::Rejected(_)));
}

#[test]
fn hops_stop_at_the_limit() {
    let deep = task_at("t9", "t1", MAX_HOPS, &["t9", "t1"]);
    let verdict = judge(
        &request("t1", "t2", Some(&deep)),
        &ok_target(),
        ApprovalMode::Off,
        0,
    );
    match verdict {
        Verdict::Rejected(message) => assert!(message.contains("转包"), "{message}"),
        other => panic!("第 {} 手应该被拦下：{other:?}", MAX_HOPS + 1),
    }
}

#[test]
fn one_hop_below_the_limit_still_passes() {
    let parent = task_at("t9", "t1", MAX_HOPS - 1, &["t9", "t1"]);
    let verdict = judge(
        &request("t1", "t2", Some(&parent)),
        &ok_target(),
        ApprovalMode::Off,
        0,
    );
    assert_eq!(verdict, Verdict::Allowed);
}

#[test]
fn a_cycle_back_to_an_earlier_session_is_rejected() {
    // A→B→A：两条会话互相等待，谁也不会先动。
    let parent = task_at("t1", "t2", 1, &["t1", "t2"]);
    let verdict = judge(
        &request("t2", "t1", Some(&parent)),
        &ok_target(),
        ApprovalMode::Off,
        0,
    );
    match verdict {
        Verdict::Rejected(message) => assert!(message.contains("环"), "{message}"),
        other => panic!("回到链路里已有的会话应该被拦：{other:?}"),
    }
}

#[test]
fn the_message_budget_stops_a_fan_out() {
    // 环检测挡不住 A→B、A→C、A→D…… 这种扇出，靠预算兜底。
    let verdict = judge(
        &request("t1", "t2", None),
        &ok_target(),
        ApprovalMode::Off,
        MAX_MESSAGES_PER_RUN,
    );
    match verdict {
        Verdict::Rejected(message) => assert!(message.contains("上限"), "{message}"),
        other => panic!("超预算应该被拦：{other:?}"),
    }
}

#[test]
fn a_doomed_request_is_rejected_before_asking_the_user() {
    // 顺序有讲究：用户不该为一条注定失败的指令被弹窗打断。
    let verdict = judge(
        &request("t1", "t2", None),
        &target(false, true, true),
        ApprovalMode::Ask,
        0,
    );
    assert!(matches!(verdict, Verdict::Rejected(_)));
}

#[test]
fn a_task_records_the_whole_chain() {
    let parent = task_at("t1", "t2", 1, &["t1", "t2"]);
    let task = build_task(
        "id-2".into(),
        &request("t2", "t3", Some(&parent)),
        100,
        &Verdict::Allowed,
    );

    assert_eq!(task.hop, 2);
    assert_eq!(task.path, vec!["t1", "t2", "t3"]);
    assert_eq!(task.state, TaskState::Queued);
}

#[test]
fn a_first_hand_task_starts_the_chain_with_its_sender() {
    let task = build_task(
        "id-1".into(),
        &request("t1", "t2", None),
        100,
        &Verdict::Allowed,
    );
    assert_eq!(task.hop, 1);
    assert_eq!(task.path, vec!["t1", "t2"]);
}

#[test]
fn the_injection_stays_three_lines() {
    let task = build_task(
        "01ABCDEFGH".into(),
        &request("t1", "t2", None),
        0,
        &Verdict::Allowed,
    );
    let text = injection_text(&task, "写实现的那条");

    // 每一行都占目标 Agent 的上下文，超出三行就是在替它做主。
    assert_eq!(text.lines().count(), 3, "{text}");
    assert!(text.contains("belfry done"), "得告诉它怎么回话：{text}");
    assert!(text.contains("写实现的那条"), "{text}");
}

#[test]
fn only_the_recipient_can_settle_a_task() {
    let board = TaskBoard::default();
    board.insert(build_task(
        "id-1".into(),
        &request("t1", "t2", None),
        0,
        &Verdict::Allowed,
    ));

    // 派活方说「你干完了」没有意义；让任意会话都能标完成，
    // 等于把这个信号的可信度降为零。
    assert!(board.settle("id-1", "t1", TaskState::Done, None).is_err());
    assert!(board.settle("id-1", "t9", TaskState::Done, None).is_err());
    assert!(board.settle("id-1", "t2", TaskState::Done, None).is_ok());
}

#[test]
fn settling_twice_is_rejected() {
    let board = TaskBoard::default();
    board.insert(build_task(
        "id-1".into(),
        &request("t1", "t2", None),
        0,
        &Verdict::Allowed,
    ));
    board
        .settle("id-1", "t2", TaskState::Done, Some("out.md".into()))
        .unwrap();

    assert!(board.settle("id-1", "t2", TaskState::Failed, None).is_err());
    assert_eq!(board.get("id-1").unwrap().result.as_deref(), Some("out.md"));
}

#[test]
fn settling_an_unknown_task_says_so() {
    let board = TaskBoard::default();
    assert!(board.settle("nope", "t2", TaskState::Done, None).is_err());
}

#[test]
fn closing_a_session_abandons_its_open_tasks() {
    let board = TaskBoard::default();
    board.insert(build_task(
        "id-1".into(),
        &request("t1", "t2", None),
        0,
        &Verdict::Allowed,
    ));
    board.insert(build_task(
        "id-2".into(),
        &request("t1", "t3", None),
        0,
        &Verdict::Allowed,
    ));
    board
        .settle("id-2", "t3", TaskState::Done, None)
        .expect("先结掉一条");

    board.abandon_for("t2");
    board.abandon_for("t3");

    assert_eq!(board.get("id-1").unwrap().state, TaskState::Abandoned);
    // 已经结了的不该被改回去。
    assert_eq!(board.get("id-2").unwrap().state, TaskState::Done);
}

#[test]
fn the_run_counter_follows_the_chain_root() {
    let board = TaskBoard::default();
    let first = build_task(
        "id-1".into(),
        &request("t1", "t2", None),
        0,
        &Verdict::Allowed,
    );
    let second = build_task(
        "id-2".into(),
        &request("t2", "t3", Some(&first)),
        0,
        &Verdict::Allowed,
    );
    board.insert(first);
    board.insert(second);
    board.insert(build_task(
        "id-3".into(),
        &request("t9", "t8", None),
        0,
        &Verdict::Allowed,
    ));

    // 同一条链路上的都算一轮，别的链路不算。
    assert_eq!(board.count_in_path("t1"), 2);
    assert_eq!(board.count_in_path("t9"), 1);
}

#[test]
fn pending_lists_only_undelivered_tasks_in_order() {
    let board = TaskBoard::default();
    let mut later = build_task(
        "id-2".into(),
        &request("t1", "t3", None),
        200,
        &Verdict::Allowed,
    );
    later.created_at = 200;
    let mut earlier = build_task(
        "id-1".into(),
        &request("t1", "t2", None),
        100,
        &Verdict::Allowed,
    );
    earlier.created_at = 100;
    board.insert(later);
    board.insert(earlier);
    board.insert(build_task(
        "id-3".into(),
        &request("t1", "t4", None),
        300,
        &Verdict::Allowed,
    ));
    board.mark_dispatched("id-3");

    let pending = board.pending();

    // 已经投出去的不该再投一次。
    assert_eq!(pending.len(), 2);
    // 同一目标收到多条时，顺序该和派活顺序一致。
    assert_eq!(pending[0].id, "id-1");
    assert_eq!(pending[1].id, "id-2");
}

#[test]
fn marking_dispatched_does_not_revive_a_settled_task() {
    let board = TaskBoard::default();
    board.insert(build_task(
        "id-1".into(),
        &request("t1", "t2", None),
        0,
        &Verdict::Allowed,
    ));
    board.settle("id-1", "t2", TaskState::Done, None).unwrap();

    // 一次迟到的投递回执不该把已经结掉的任务改回进行中。
    board.mark_dispatched("id-1");

    assert_eq!(board.get("id-1").unwrap().state, TaskState::Done);
}

#[test]
fn a_short_id_takes_the_random_tail() {
    // 取尾部是有意的：ULID 前 10 位是毫秒时间戳，按前缀截会让同一毫秒里派出的
    // 两条任务拿到同一个短 id，而 done / wait 都按短 id 查。
    assert_eq!(short_id("01ABCDEFGHIJ"), "CDEFGHIJ");
    assert_eq!(short_id(&"x".repeat(26)), "xxxxxxxx");
    // 比 8 位还短的 id 不该出现，但也不能 panic。
    assert_eq!(short_id("abc"), "abc");
    assert_eq!(short_id(""), "");
}

#[test]
fn a_task_needing_approval_does_not_go_straight_to_the_queue() {
    let task = build_task(
        "id-1".into(),
        &request("t1", "t2", None),
        0,
        &Verdict::NeedsApproval,
    );

    // 直接进 Queued 的话前端下一轮就投出去了，Ask 模式形同虚设。
    assert_eq!(task.state, TaskState::PendingApproval);
}

#[test]
fn pending_approval_tasks_are_not_delivered() {
    let board = TaskBoard::default();
    board.insert(build_task(
        "id-1".into(),
        &request("t1", "t2", None),
        0,
        &Verdict::NeedsApproval,
    ));

    assert!(board.pending().is_empty(), "没批准之前不该投递");

    board.approve("id-1").unwrap();
    assert_eq!(board.pending().len(), 1);
}

#[test]
fn approving_or_rejecting_twice_is_rejected() {
    let board = TaskBoard::default();
    board.insert(build_task(
        "id-1".into(),
        &request("t1", "t2", None),
        0,
        &Verdict::NeedsApproval,
    ));
    board.approve("id-1").unwrap();

    // 已经放行的不该被一次误点改回去，反之亦然。
    assert!(board.approve("id-1").is_err());
    assert!(board.reject("id-1").is_err());
}

#[test]
fn rejecting_marks_it_abandoned_with_a_reason() {
    let board = TaskBoard::default();
    board.insert(build_task(
        "id-1".into(),
        &request("t1", "t2", None),
        0,
        &Verdict::NeedsApproval,
    ));

    board.reject("id-1").unwrap();

    let task = board.get("id-1").unwrap();
    assert_eq!(task.state, TaskState::Abandoned);
    // 派活方要看得出这是被否了，而不是石沉大海。
    assert!(task.result.is_some());
}

#[test]
fn stop_all_clears_everything_still_in_flight() {
    let board = TaskBoard::default();
    board.insert(build_task(
        "a".into(),
        &request("t1", "t2", None),
        0,
        &Verdict::NeedsApproval,
    ));
    board.insert(build_task(
        "b".into(),
        &request("t1", "t3", None),
        0,
        &Verdict::Allowed,
    ));
    board.insert(build_task(
        "c".into(),
        &request("t1", "t4", None),
        0,
        &Verdict::Allowed,
    ));
    board.mark_dispatched("c");
    board.insert(build_task(
        "d".into(),
        &request("t1", "t5", None),
        0,
        &Verdict::Allowed,
    ));
    board.settle("d", "t5", TaskState::Done, None).unwrap();

    let stopped = board.stop_all();

    // 三种在途状态都要停：等确认、排队中、已投递。
    assert_eq!(stopped, 3);
    for id in ["a", "b", "c"] {
        assert_eq!(board.get(id).unwrap().state, TaskState::Abandoned, "{id}");
    }
    // 已经完成的不动——那不是「在途」。
    assert_eq!(board.get("d").unwrap().state, TaskState::Done);
}

/// 同一毫秒里派出的两条任务，短 id 必须能区分开。
///
/// ULID 前 10 个字符是毫秒时间戳：按前缀截短的话，连着派两条活会得到同一个短 id，
/// 而 `done` / `wait` 都按短 id 查——查到的可能是别人那条。
#[test]
fn short_ids_stay_distinct_within_the_same_millisecond() {
    let first = ulid::Ulid::generate().to_string().to_lowercase();
    let second = ulid::Ulid::generate().to_string().to_lowercase();

    // 先确认这两个 id 真的同毫秒（否则这条测试等于没测）。前 10 位是时间戳。
    if first[..10] != second[..10] {
        eprintln!("跳过：两次生成跨了毫秒，这次测不到碰撞");
        return;
    }
    assert_ne!(
        super::short_id(&first),
        super::short_id(&second),
        "同毫秒的两条任务短 id 撞了：{first} / {second}"
    );
}

#[test]
fn stop_marks_a_live_task_abandoned() {
    let board = TaskBoard::default();
    let request = request("t1", "t2", None);
    let task = build_task("01A".into(), &request, 0, &Verdict::Allowed);
    let id = task.id.clone();
    board.insert(task);
    board.stop(&id).unwrap();
    assert_eq!(board.get(&id).unwrap().state, TaskState::Abandoned);
    assert!(board.stop(&id).is_err(), "已经结掉的任务不能再停");
}

#[test]
fn a_room_origin_rides_along_with_the_task() {
    let request = request("room:r1", "t2", None);
    let task = build_task("01B".into(), &request, 0, &Verdict::Allowed).with_origin(
        TaskOrigin::Room {
            id: "r1".into(),
            name: "登录体验小组".into(),
        },
    );
    assert_eq!(
        task.origin,
        Some(TaskOrigin::Room {
            id: "r1".into(),
            name: "登录体验小组".into()
        })
    );
}

#[test]
fn recalling_a_message_drops_its_line_from_the_pending_delivery() {
    let board = TaskBoard::default();
    let origin = TaskOrigin::Room {
        id: "r1".into(),
        name: "发布检查".into(),
    };
    board.insert(
        chat_task("01A".into(), "msg-1", "t2", "t3", "前端：第一句", false, 1_000).with_origin(origin),
    );
    assert!(board.append_pending_chat("t3", "r1", "审查：第二句", "msg-2", 1_200, false));
    // 撤回第一条：正文摘掉对应那行，消息 id 与 lines 同步摘掉。
    assert_eq!(board.drop_pending_message("msg-1"), 1);
    let task = board.get("01A").unwrap();
    assert_eq!(task.instruction, "审查：第二句");
    assert_eq!(task.chat.as_ref().unwrap().message_ids, vec!["msg-2".to_string()]);
    assert_eq!(task.chat.as_ref().unwrap().lines, vec!["审查：第二句".to_string()]);
    // 已送达的投递动不了：撤回不假装能追回已经进过终端的字。
    board.mark_dispatched("01A");
    assert_eq!(board.drop_pending_message("msg-2"), 0);
    assert!(board.get("01A").is_some(), "已送达的投递不因撤回被删");
}

#[test]
fn recalling_the_only_message_removes_the_empty_delivery() {
    let board = TaskBoard::default();
    board.insert(chat_task("01B".into(), "msg-9", "t2", "t4", "前端：就这一句", false, 0).with_origin(
        TaskOrigin::Room { id: "r1".into(), name: "发布检查".into() },
    ));
    assert_eq!(board.drop_pending_message("msg-9"), 1);
    assert!(board.get("01B").is_none(), "摘空的投递整条撤掉，不该留一条空注入");
}
