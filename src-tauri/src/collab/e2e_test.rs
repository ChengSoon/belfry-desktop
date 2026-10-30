//! 端到端：真起一个 server，用真的 `belfry` 二进制连上去。
//!
//! `server_test.rs` 直接调 `handle_line`，绕过了传输层——而传输层恰恰最容易
//! 出问题：socket 路径、文件权限、按行分帧、读写各持一半。这一条把那段也走完。
//!
//! 二进制没构建时跳过而不是失败：`cargo test` 不会自动构建别的 crate 的 bin，
//! 让整份测试因此变红只会训练人忽略红灯。

use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::identity::SessionIdentities;
use super::registry::{SessionRegistry, SessionSnapshot};
use super::server::{CollabServer, RoomAccess};
use super::task::{self, TaskBoard, TaskState};

#[test]
fn the_cli_talks_to_a_real_server() {
    let Some(binary) = cli_binary() else {
        eprintln!("跳过端到端：先 cargo build -p belfry-cli");
        return;
    };

    let identities = Arc::new(SessionIdentities::default());
    let registry = Arc::new(SessionRegistry::default());
    let project = std::env::temp_dir().join(format!(
        "belfry-e2e-{}-{}",
        std::process::id(),
        ulid::Ulid::generate()
    ));
    std::fs::create_dir_all(&project).unwrap();

    let board = Arc::new(TaskBoard::default());
    // 房间目录先挂空位，测到第 13 步再装满——顺带把「还没就绪」的诚实降级也测了。
    let room_access = Arc::new(RoomAccess::default());
    let Some(server) = CollabServer::start(
        identities.clone(),
        registry.clone(),
        board.clone(),
        room_access.clone(),
    ) else {
        panic!("server 起不来");
    };
    let endpoint = server.endpoint().to_string();

    let env = identities.issue("t1", project.to_str());
    let token = env
        .iter()
        .find(|(key, _)| key == belfry_protocol::ENV_TOKEN)
        .map(|(_, value)| value.clone())
        .unwrap();
    registry.replace(vec![
        SessionSnapshot {
            tab_id: "t1".into(),
            name: Some("planner".into()),
            title: "我".into(),
            agent: "claude".into(),
            activity: "idle".into(),
            can_receive: true,
            project_root: project.to_str().map(str::to_string),
        },
        SessionSnapshot {
            tab_id: "t3".into(),
            name: Some("审查".into()),
            title: "中文名那条".into(),
            agent: "claude".into(),
            activity: "idle".into(),
            can_receive: true,
            project_root: project.to_str().map(str::to_string),
        },
        SessionSnapshot {
            tab_id: "t2".into(),
            name: Some("reviewer".into()),
            title: "另一条".into(),
            agent: "codex".into(),
            activity: "idle".into(),
            can_receive: true,
            project_root: project.to_str().map(str::to_string),
        },
    ]);

    // 1. 连得上、鉴得过、拿得到名册
    let peers = run(&binary, &endpoint, &token, &["peers"]);
    let text = String::from_utf8_lossy(&peers.stdout).to_string();
    assert!(peers.status.success(), "peers 应该成功：{peers:?}");
    assert!(text.contains("* planner"), "自己那条要标出来：{text}");
    assert!(text.contains("reviewer"), "别的会话也该在：{text}");
    // 名字才是给 Agent 用的寻址键，tabId 不该出现在这份名单里。
    assert!(!text.contains("t1"), "名册里不该露 tabId：{text}");

    // 2. 伪造 token 必须被挡住，且失败要走 stderr、退出码非零
    let denied = run(&binary, &endpoint, "伪造的", &["peers"]);
    assert!(!denied.status.success(), "错 token 不该成功");
    assert!(
        !String::from_utf8_lossy(&denied.stderr).is_empty(),
        "失败得说清原因，Agent 读的是 stderr"
    );

    // 3. 派活：按名字找到 t2。同项目默认自动放行，直接进队列等投递
    let sent = run(
        &binary,
        &endpoint,
        &token,
        &["send", "reviewer", "审一下队列回滚"],
    );
    let sent_text = String::from_utf8_lossy(&sent.stdout).to_string();
    assert!(sent.status.success(), "派活应该受理：{sent:?}");
    assert!(
        sent_text.contains("已受理"),
        "同项目应该直接放行：{sent_text}"
    );
    let queued = board
        .snapshot()
        .into_iter()
        .find(|entry| entry.to == "t2")
        .expect("任务应该在板上");
    assert!(
        !matches!(queued.state, TaskState::PendingApproval),
        "自动放行的任务不该停在等确认：{:?}",
        queued.state
    );

    // 4. 标题不是寻址键：它每敲一条 prompt 就变，靠它派活迟早打到别人身上
    let by_title = run(&binary, &endpoint, &token, &["send", "另一条", "审一下"]);
    assert!(!by_title.status.success(), "标题不该能寻址");
    let hint = String::from_utf8_lossy(&by_title.stderr).to_string();
    assert!(
        hint.contains("reviewer"),
        "错误里要列出真能派的名字：{hint}"
    );

    // 5. 中文名字要能一路走通：CLI 的 argv、JSON 传输、registry 的大小写折叠
    let zh = run(&binary, &endpoint, &token, &["send", "审查", "看一下这段"]);
    assert!(zh.status.success(), "中文名字应该能寻址：{zh:?}");
    let zh_text = String::from_utf8_lossy(&zh.stdout).to_string();
    assert!(
        zh_text.contains("审查"),
        "回执里要带上那个中文名：{zh_text}"
    );

    // 6. 派给自己会绕成死结，必须挡住
    let to_self = run(&binary, &endpoint, &token, &["send", "t1", "自己干"]);
    assert!(!to_self.status.success(), "不该允许给自己派活");

    // 7. 结任务：只有接收方能结，派活方不行
    let task_id = board
        .snapshot()
        .first()
        .map(|task| crate::collab::task::short_id(&task.id).to_string())
        .expect("刚派的任务应该在板上");
    let by_sender = run(&binary, &endpoint, &token, &["done", &task_id]);
    assert!(
        !by_sender.status.success(),
        "派活方不能替接收方宣布完成，否则这个信号就没有可信度了"
    );

    // 8. 注入给 Agent 的那行命令必须真的能用：语法对不上的话，
    //    它照着敲会「成功」地结掉一个不存在的任务号，而真任务永远悬着。
    let entry = board
        .snapshot()
        .into_iter()
        .find(|task| task.to == "t2")
        .expect("刚派的任务应该在板上");
    let injected = crate::collab::task::injection_text(&entry, "planner");
    let args = command_from_injection(&injected);
    let receiver_env = identities.issue("t2", project.to_str());
    let receiver_token = receiver_env
        .iter()
        .find(|(key, _)| key == belfry_protocol::ENV_TOKEN)
        .map(|(_, value)| value.clone())
        .unwrap();
    let settled = run_as(
        &binary,
        &endpoint,
        "t2",
        &receiver_token,
        &args.iter().map(String::as_str).collect::<Vec<_>>(),
    );
    assert!(
        settled.status.success(),
        "注入文本里的命令要能原样跑通，实际跑的是 {args:?}：{settled:?}"
    );

    // 9. 超时要如实说「还没结」——不能把「等烦了」当成「干完了」
    let extra = run(
        &binary,
        &endpoint,
        &token,
        &["send", "reviewer", "再来一条不会有人结的"],
    );
    assert!(extra.status.success(), "派活应该成功：{extra:?}");
    let stuck = board
        .snapshot()
        .into_iter()
        .find(|entry| entry.instruction.contains("不会有人结的"))
        .expect("刚派的那条应该在板上");
    let stuck_short = task::short_id(&stuck.id).to_string();
    let timed = run(
        &binary,
        &endpoint,
        &token,
        &["wait", &stuck_short, "--timeout", "1"],
    );
    assert!(!timed.status.success(), "超时不该按成功返回：{timed:?}");
    let timed_text = String::from_utf8_lossy(&timed.stderr).to_string();
    assert!(timed_text.contains("还没结"), "要说清还没结：{timed_text}");
    // 超时也要把当前状态交代清楚，Agent 才知道是在排队还是已经送到了。
    assert!(
        timed_text.contains("排队") || timed_text.contains("送到"),
        "超时消息里要带上当前状态：{timed_text}"
    );

    // 10. wait 要真的等：另一个线程 1.5 秒后才结掉它，wait 得盯到那一刻
    let pending = board
        .snapshot()
        .into_iter()
        .find(|entry| entry.to == "t3")
        .expect("中文名那条任务应该在板上");
    let short = task::short_id(&pending.id).to_string();
    let settler = Arc::clone(&board);
    let settling_id = pending.id.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1_500));
        let _ = settler.settle(
            &settling_id,
            "t3",
            TaskState::Done,
            Some("原型给你了".into()),
        );
    });

    let started = Instant::now();
    let waited = run(&binary, &endpoint, &token, &["wait", &short]);
    let elapsed = started.elapsed();
    assert!(waited.status.success(), "wait 应该等到完成：{waited:?}");
    let waited_text = String::from_utf8_lossy(&waited.stdout).to_string();
    assert!(waited_text.contains("已完成"), "要报完成：{waited_text}");
    assert!(
        waited_text.contains("原型给你了"),
        "要带上对方交差时写的那句：{waited_text}"
    );
    // 立刻返回就说明它没在等，而是拿了一个过期状态就走。
    assert!(
        elapsed >= Duration::from_secs(1),
        "应该真的等到状态变化，实际只花了 {elapsed:?}"
    );

    // 11. 只能等自己派的：别人派出去的任务，连状态都不该看到
    let peeking = run_as(&binary, &endpoint, "t2", &receiver_token, &["wait", &short]);
    assert!(!peeking.status.success(), "不该让别人查我派出去的任务");

    // 12. 对方会话中途没了：wait 不能一直挂着等一个永远不会来的 done
    let orphan = run(
        &binary,
        &endpoint,
        &token,
        &["send", "reviewer", "这条的目标会中途消失"],
    );
    assert!(orphan.status.success(), "派活应该成功：{orphan:?}");
    let orphan_task = board
        .snapshot()
        .into_iter()
        .find(|entry| entry.instruction.contains("目标会中途消失"))
        .expect("刚派的那条应该在板上");
    let orphan_short = task::short_id(&orphan_task.id).to_string();
    let abandoner = Arc::clone(&board);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1_200));
        // 前端发现会话关了之后走的就是这条：同步名册时把派给它的未结任务收掉。
        abandoner.abandon_for("t2");
    });

    let started = Instant::now();
    let orphaned = run(&binary, &endpoint, &token, &["wait", &orphan_short]);
    assert!(
        orphaned.status.success(),
        "作废也是一种「结了」，wait 该正常返回而不是等到超时：{orphaned:?}"
    );
    let orphan_text = String::from_utf8_lossy(&orphaned.stdout).to_string();
    assert!(
        orphan_text.contains("作废"),
        "要说清是作废、不是完成：{orphan_text}"
    );
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "不该挂到默认超时，实际花了 {:?}",
        started.elapsed()
    );

    // 13. 房间：成员在终端里看得见自己的房间；目录还没装好时如实回答不在
    let before_ready = run(&binary, &endpoint, &token, &["rooms"]);
    let before_text = String::from_utf8_lossy(&before_ready.stdout).to_string();
    assert!(before_ready.status.success(), "rooms 应该成功：{before_ready:?}");
    assert!(
        before_text.contains("不在"),
        "目录未就绪要说清不在任何房间：{before_text}"
    );

    let store = Arc::new(crate::rooms::RoomStore::load(Some(
        project.join("rooms.json"),
    )));
    let room = store.create("发布检查", project.to_str().unwrap()).unwrap();
    store
        .add_member(&room.id, "t1", "claude", "前端", "")
        .unwrap();
    room_access.set(store.clone());

    let listed = run(&binary, &endpoint, &token, &["rooms"]);
    let listed_text = String::from_utf8_lossy(&listed.stdout).to_string();
    assert!(listed.status.success(), "rooms 应该成功：{listed:?}");
    assert!(
        listed_text.contains("发布检查") && listed_text.contains("前端"),
        "房间里要看到房间名和我的角色：{listed_text}"
    );

    // 不在这间房里的会话看不到它。
    let outsider = run_as(&binary, &endpoint, "t2", &receiver_token, &["rooms"]);
    let outsider_text = String::from_utf8_lossy(&outsider.stdout).to_string();
    assert!(outsider.status.success(), "rooms 应该成功：{outsider:?}");
    assert!(
        outsider_text.contains("不在"),
        "不在房间里的会话不该看到这间房：{outsider_text}"
    );

    // 13b. 房间群聊：没进房间前说不了话；进房之后能说话，点名只投给被点的人（请 TA 接话），不点名才发给全体。
    let outside_say = run_as(&binary, &endpoint, "t2", &receiver_token, &["room", "say", "有人吗"]);
    assert!(!outside_say.status.success(), "不在房间里不该说得了话");
    assert!(
        String::from_utf8_lossy(&outside_say.stderr).contains("不在任何"),
        "要说清为什么说不了"
    );

    store
        .add_member(&room.id, "t2", "codex", "审查", "")
        .unwrap();
    store
        .add_member(&room.id, "t3", "claude", "测试", "")
        .unwrap();

    let said = run_as(
        &binary,
        &endpoint,
        "t1",
        &token,
        &["room", "say", "@审查", "接口文档更新了"],
    );
    assert!(said.status.success(), "成员应该能往房间里说话：{said:?}");
    let said_text = String::from_utf8_lossy(&said.stdout).to_string();
    assert!(
        said_text.contains("已记进房间「发布检查」") && said_text.contains("审查") && !said_text.contains("测试"),
        "回执要说清去了哪间房、通知了谁（点名只通知被点的人）：{said_text}"
    );

    // 群聊不是派活：消息不进收件箱（inbox 只列要交差的活）。
    let mentioned = run_as(&binary, &endpoint, "t2", &receiver_token, &["inbox"]);
    let mentioned_text = String::from_utf8_lossy(&mentioned.stdout).to_string();
    assert!(
        !mentioned_text.contains("接口文档更新了"),
        "群聊消息不该出现在收件箱里：{mentioned_text}"
    );
    // 投给终端的那条是聊天口吻：不挂任务号、不要 done，要接话走 room say。
    let chat_task = board
        .snapshot()
        .into_iter()
        .find(|entry| entry.to == "t2" && entry.instruction.contains("接口文档更新了"))
        .expect("群聊投递应该在板上");
    assert!(chat_task.chat.is_some(), "群聊投递要带聊天标记");
    let injected = task::injection_text(&chat_task, "发布检查");
    assert!(
        injected.contains("点了你的名")
            && injected.contains("room say")
            && !injected.contains("belfry done"),
        "群聊注入要是聊天口吻：{injected}"
    );

    // 点名收窄投递：被点名的只有「审查」，「测试」的终端不该收到这条。
    assert!(
        !board
            .snapshot()
            .iter()
            .any(|entry| entry.to == "t3" && entry.instruction.contains("接口文档更新了")),
        "点名只发给被点的人，旁观成员不该收到"
    );

    // 群聊语义：不带点名的发言发给所有成员。
    let shouted = run_as(
        &binary,
        &endpoint,
        "t1",
        &token,
        &["room", "say", "大家同步一下进度"],
    );
    assert!(
        shouted.status.success(),
        "不带点名的发言应该发给全体：{shouted:?}"
    );
    let shouted_text = String::from_utf8_lossy(&shouted.stdout).to_string();
    assert!(
        shouted_text.contains("已发给：") && shouted_text.contains("审查"),
        "回执要说清发给了谁：{shouted_text}"
    );
    // 20 秒窗口内的连发并进同一条排队中的投递：两句话在同一条正文里。
    let chat_tasks: Vec<_> = board
        .snapshot()
        .into_iter()
        .filter(|entry| entry.to == "t2" && entry.chat.is_some())
        .collect();
    assert_eq!(chat_tasks.len(), 1, "连发要合并成一条投递");
    assert!(
        chat_tasks[0].instruction.contains("大家同步一下进度"),
        "合并后正文要带上后一句：{}",
        chat_tasks[0].instruction
    );
    let passive_merged = board
        .snapshot()
        .into_iter()
        .find(|entry| entry.to == "t3" && entry.chat.is_some())
        .expect("不带点名的发言要送达全体成员");
    assert!(
        passive_merged.instruction.contains("大家同步一下进度")
            && !passive_merged.instruction.contains("接口文档更新了"),
        "旁观成员只收到群发那条，点名那条不越界：{}",
        passive_merged.instruction
    );
    // 群发到旁观成员的口径是「看见即可」；被点名才有「点了你的名」。
    let passive_injected = task::injection_text(&passive_merged, "发布检查");
    assert!(
        passive_injected.contains("看见即可") && !passive_injected.contains("点了你的名"),
        "旁观成员的口径是看见即可：{passive_injected}"
    );

    let logged = run_as(
        &binary,
        &endpoint,
        "t1",
        &token,
        &["room", "log", "--room", "发布检查"],
    );
    let logged_text = String::from_utf8_lossy(&logged.stdout).to_string();
    assert!(logged.status.success(), "日志应该读得到：{logged:?}");
    assert!(
        logged_text.contains("前端：@审查 接口文档更新了"),
        "日志要按角色名读回对话：{logged_text}"
    );
    assert!(logged_text.contains("["), "日志行要带消息短 id：{logged_text}");

    // 13b-2. 成员引用回复：从 log 里取短 id，`room say --reply` 引用它回话；
    // 投给其他成员的注入行要带原话摘录——群里指代不靠猜。
    let line = logged_text
        .lines()
        .find(|line| line.contains("接口文档更新了"))
        .expect("日志里应有那条消息");
    let id_start = line.find('[').expect("日志行要带消息 id") + 1;
    let id_end = line[id_start..]
        .find(']')
        .map(|at| id_start + at)
        .expect("日志行要带消息 id");
    let quoted_id = line[id_start..id_end].to_string();
    let quoted = run_as(
        &binary,
        &endpoint,
        "t2",
        &receiver_token,
        &["room", "say", "--reply", &quoted_id, "收到，我按新的改"],
    );
    assert!(quoted.status.success(), "引用回复应该成功：{quoted:?}");
    let quoted_task = board
        .snapshot()
        .into_iter()
        .find(|entry| entry.to == "t1" && entry.instruction.contains("收到，我按新的改"))
        .expect("引用回复应投给其他成员");
    assert!(
        quoted_task.instruction.contains("回复") && quoted_task.instruction.contains("接口文档更新了"),
        "注入行要带引用摘要：{}",
        quoted_task.instruction
    );
    // 幽灵 id：当场拒绝。
    let ghost = run_as(
        &binary,
        &endpoint,
        "t2",
        &receiver_token,
        &["room", "say", "--reply", "zzzzzzzz", "引用幽灵"],
    );
    assert!(!ghost.status.success(), "引用不存在的消息要报错");

    // 13b-3. 表情回应：真 CLI 走真服务端——点上、log 带计数、再点取消、幽灵消息拒绝。
    let reacted = run_as(
        &binary,
        &endpoint,
        "t2",
        &receiver_token,
        &["room", "react", &quoted_id, "👍"],
    );
    assert!(reacted.status.success(), "回应应该成功：{reacted:?}");
    assert!(
        String::from_utf8_lossy(&reacted.stdout).contains("点上"),
        "回执要说清点上了：{:?}",
        String::from_utf8_lossy(&reacted.stdout)
    );
    let re_logged = run_as(
        &binary,
        &endpoint,
        "t2",
        &receiver_token,
        &["room", "log", "--room", "发布检查"],
    );
    let re_logged_text = String::from_utf8_lossy(&re_logged.stdout).to_string();
    assert!(
        re_logged_text.contains("👍×1"),
        "log 要带回应计数：{re_logged_text}"
    );
    let undone = run_as(
        &binary,
        &endpoint,
        "t2",
        &receiver_token,
        &["room", "react", &quoted_id, "👍"],
    );
    assert!(undone.status.success(), "取消应该成功：{undone:?}");
    assert!(
        String::from_utf8_lossy(&undone.stdout).contains("取消"),
        "回执要说清取消了：{:?}",
        String::from_utf8_lossy(&undone.stdout)
    );
    let ghost_react = run_as(
        &binary,
        &endpoint,
        "t2",
        &receiver_token,
        &["room", "react", "zzzzzzzz", "👍"],
    );
    assert!(!ghost_react.status.success(), "幽灵消息要拒绝");

    // 13c. 成员转手：转给同房成员的活，交差回复要回到房间时间线——
    // 聊天不能断在交接处。send 直派没有可见痕迹，先在时间线留一条系统留痕。
    let handoff = run(
        &binary,
        &endpoint,
        &token,
        &["send", "reviewer", "顺带把回归脚本补上"],
    );
    assert!(handoff.status.success(), "转手应该受理：{handoff:?}");
    let announced = store.get(&room.id).unwrap();
    assert!(
        announced
            .messages
            .iter()
            .any(|m| m.text.contains("把任务交给了") && m.text.contains("回归脚本")),
        "send 转手要在时间线留痕"
    );

    // 群聊投递：送达（进过终端）后先留在板上等对账把回执写回消息，再回收。
    let chat_short = task::short_id(&chat_task.id).to_string();
    let passive_short = task::short_id(&passive_merged.id).to_string();
    board.mark_dispatched(&chat_task.id);
    board.mark_dispatched(&passive_merged.id);
    assert!(
        board
            .snapshot()
            .iter()
            .any(|entry| task::short_id(&entry.id) == chat_short),
        "送达后先留在板上等回执记录"
    );

    // 转手是任务通道：一条带结果交差（以成员口吻回显），一条不带结果（系统摘要）。
    let direct_task = board
        .snapshot()
        .into_iter()
        .find(|entry| entry.to == "t2" && entry.instruction.contains("回归脚本"))
        .expect("转手任务应该在板上");
    let direct_short = task::short_id(&direct_task.id).to_string();
    let replied = run_as(
        &binary,
        &endpoint,
        "t2",
        &receiver_token,
        &["done", &direct_short, "回归脚本补完了"],
    );
    assert!(replied.status.success(), "交差应该成功：{replied:?}");
    let second = run(
        &binary,
        &endpoint,
        &token,
        &["send", "reviewer", "顺手把改动记录也更新一下"],
    );
    assert!(second.status.success(), "第二笔转手应该受理：{second:?}");
    let another = board
        .snapshot()
        .into_iter()
        .find(|entry| entry.to == "t2" && entry.instruction.contains("改动记录"))
        .expect("第二笔转手应该在板上");
    let another_short = task::short_id(&another.id).to_string();
    let closed = run_as(&binary, &endpoint, "t2", &receiver_token, &["done", &another_short]);
    assert!(closed.status.success(), "交差应该成功：{closed:?}");

    store.reconcile(&board, 9_999).unwrap();
    assert!(
        !board
            .snapshot()
            .iter()
            .any(|entry| task::short_id(&entry.id) == chat_short),
        "回执记录后群聊投递要出板"
    );
    assert!(
        !board
            .snapshot()
            .iter()
            .any(|entry| task::short_id(&entry.id) == passive_short),
        "旁观成员的投递同样回收"
    );
    let echoed = store.get(&room.id).unwrap();
    let reviewer_id = echoed
        .members
        .iter()
        .find(|member| member.role == "审查")
        .map(|member| member.id.clone())
        .expect("审查应该还在成员里");
    let tester_id = echoed
        .members
        .iter()
        .find(|member| member.role == "测试")
        .map(|member| member.id.clone())
        .expect("测试应该还在成员里");
    assert!(
        echoed
            .messages
            .iter()
            .any(|m| m.text.contains("大家同步一下进度")
                && m.delivered_to.contains(&reviewer_id)
                && m.delivered_to.contains(&tester_id)),
        "群聊送达要记到消息上（含旁观成员）：{:?}",
        echoed
            .messages
            .iter()
            .map(|m| (m.text.clone(), m.delivered_to.clone()))
            .collect::<Vec<_>>()
    );
    assert!(
        echoed
            .messages
            .iter()
            .any(|m| m.text.contains("接口文档更新了") && m.delivered_to == vec![reviewer_id.clone()]),
        "点名消息的送达只记被点的人"
    );
    assert!(
        echoed
            .messages
            .iter()
            .any(|m| m.text.contains("回归脚本补完了")),
        "转手对象的交差要以他的口吻回显进房间时间线"
    );
    assert!(
        echoed
            .messages
            .iter()
            .any(|m| m.text.contains("「审查」交差了")),
        "不带结果的交差要留一条系统摘要"
    );

    let _ = std::fs::remove_dir_all(&project);
}

/// CLI 二进制的位置。
///
/// 没构建就跳过整条测试；构建了但比源码旧则**明确失败**。这两种处理不一样是有意的：
/// `cargo test --lib` 不会重建别的 crate 的 bin，拿上一版二进制跑出来的绿灯是假的，
/// 而假绿灯比红灯危险得多——改坏了 CLI 却看到全绿，下一步就直接发版了。
fn cli_binary() -> Option<std::path::PathBuf> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let name = if cfg!(windows) {
        "belfry.exe"
    } else {
        "belfry"
    };
    let path = root.join("target/debug").join(name);
    let built = path.metadata().and_then(|meta| meta.modified()).ok()?;

    // 协议也算：它一变，CLI 和 app 的线上格式就对不上了。
    for source in [
        "crates/belfry-cli/src/main.rs",
        "crates/belfry-protocol/src/lib.rs",
    ] {
        let Ok(changed) = root
            .join(source)
            .metadata()
            .and_then(|meta| meta.modified())
        else {
            continue;
        };
        assert!(
            changed <= built,
            "{source} 比 target/debug/{name} 新。先跑 cargo build -p belfry-cli，\
             否则这条端到端测的是上一版 CLI。"
        );
    }
    Some(path)
}

fn run(
    binary: &std::path::Path,
    endpoint: &str,
    token: &str,
    args: &[&str],
) -> std::process::Output {
    run_as(binary, endpoint, "t1", token, args)
}

fn run_as(
    binary: &std::path::Path,
    endpoint: &str,
    tab_id: &str,
    token: &str,
    args: &[&str],
) -> std::process::Output {
    Command::new(binary)
        .args(args)
        .env(belfry_protocol::ENV_ENDPOINT, endpoint)
        .env(belfry_protocol::ENV_TAB_ID, tab_id)
        .env(belfry_protocol::ENV_TOKEN, token)
        .output()
        .expect("跑不起来 belfry")
}

/// 从注入文本里抠出那行 `belfry …` 命令的实参。
///
/// 注入文本是唯一告诉 Agent「怎么交差」的地方，而它和 CLI 的参数语法一旦对不上，
/// Agent 会照着敲、拿到一个语义完全不同的结果，还以为自己交差了。
fn command_from_injection(text: &str) -> Vec<String> {
    text.lines()
        .find_map(|line| line.split_once("belfry "))
        .map(|(_, rest)| rest.split_whitespace().map(str::to_string).collect())
        .expect("注入文本里应该有一行 belfry 命令")
}
