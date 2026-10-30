use super::*;
use crate::collab::registry::SessionSnapshot;
use crate::collab::task::TaskBoard;

fn snapshot(tab_id: &str, agent: &str) -> SessionSnapshot {
    SessionSnapshot {
        tab_id: tab_id.to_string(),
        name: None,
        title: "改存储层".to_string(),
        agent: agent.to_string(),
        activity: "idle".to_string(),
        can_receive: true,
        project_root: Some("/tmp/project".to_string()),
    }
}

fn token_of(env: &[(String, String)]) -> String {
    env.iter()
        .find(|(key, _)| key == belfry_protocol::ENV_TOKEN)
        .map(|(_, value)| value.clone())
        .unwrap()
}

fn line(tab: &str, token: &str, command: Command) -> String {
    serde_json::to_string(&Request::new(tab.to_string(), token.to_string(), command)).unwrap()
}

#[test]
fn a_valid_request_is_served() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    let token = token_of(&identities.issue("t1", None));
    registry.replace(vec![snapshot("t1", "claude"), snapshot("t2", "codex")]);

    let response = handle_line(
        &line("t1", &token, Command::Peers),
        &identities,
        &registry,
        &board,
        &RoomAccess::default(),
    );

    match response {
        Response::Ok {
            data: ResponseData::Peers { peers },
        } => {
            assert_eq!(peers.len(), 2);
            assert!(peers[0].is_self);
        }
        other => panic!("应该拿到名册：{other:?}"),
    }
}

#[test]
fn a_wrong_token_is_rejected() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    identities.issue("t1", None);

    let response = handle_line(
        &line("t1", "猜的", Command::Peers),
        &identities,
        &registry,
        &board,
        &RoomAccess::default(),
    );

    assert!(matches!(response, Response::Error { .. }));
}

#[test]
fn an_unknown_session_and_a_wrong_token_look_identical() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    identities.issue("t1", None);

    let wrong = handle_line(
        &line("t1", "猜的", Command::Peers),
        &identities,
        &registry,
        &board,
        &RoomAccess::default(),
    );
    let missing = handle_line(
        &line("t9", "猜的", Command::Peers),
        &identities,
        &registry,
        &board,
        &RoomAccess::default(),
    );

    // 区分这两种情况本身就是一个可试探的信号：能问出「哪些 tabId 是真的」。
    match (wrong, missing) {
        (Response::Error { message: a }, Response::Error { message: b }) => assert_eq!(a, b),
        other => panic!("两种失败都该是 Error：{other:?}"),
    }
}

#[test]
fn a_version_mismatch_says_so_explicitly() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    let token = token_of(&identities.issue("t1", None));

    let mut request = Request::new("t1".into(), token, Command::Peers);
    request.version = PROTOCOL_VERSION + 1;
    let response = handle_line(
        &serde_json::to_string(&request).unwrap(),
        &identities,
        &registry,
        &board,
        &RoomAccess::default(),
    );

    match response {
        // 版本问题必须说清，否则表现成「某个参数没生效」，最难查。
        Response::Error { message } => assert!(message.contains("版本"), "{message}"),
        other => panic!("应该报版本不匹配：{other:?}"),
    }
}

#[test]
fn malformed_input_does_not_panic() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();

    for bad in ["", "{", "null", "{\"version\":1}", "не json"] {
        let response = handle_line(bad, &identities, &registry, &board, &RoomAccess::default());
        assert!(matches!(response, Response::Error { .. }), "输入 {bad:?}");
    }
}

/// 同一个人常常同时开两个实例（正式版干活 + dev 调试）。
/// socket 名只带 uid 的话，后起来那个会掀掉前一个的桌子。
#[cfg(unix)]
#[test]
fn each_instance_gets_its_own_socket_path() {
    let path = super::socket_path().expect("应该算得出路径");
    let name = path.file_name().unwrap().to_str().unwrap();

    assert!(
        name.contains(&std::process::id().to_string()),
        "socket 名里要有 pid，否则两个实例互相拆台：{name}"
    );
}

/// 升级前留下的 socket 没有活体标记，只能退回 connect 探测——这条测的就是那条
/// 兼容路径（下面几个 socket 都刻意不带 `.lock`）。带标记的情形见
/// `sweeping_spares_a_busy_instance_that_holds_its_live_lock`。
#[cfg(unix)]
#[test]
fn sweeping_keeps_the_sockets_that_still_answer() {
    // 目录名要短：Unix socket 路径有 SUN_LEN 上限（macOS 104 字节），
    // 而 macOS 的 TMPDIR 前缀本身就占了将近一半。
    let dir = std::path::PathBuf::from(format!("/tmp/bfsw{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    // 一个还在服务的（有人监听），一个是上次没退干净留下的空壳。
    let alive = dir.join("belfry-1-111.sock");
    let stale = dir.join("belfry-1-222.sock");
    let listener = std::os::unix::net::UnixListener::bind(&alive).unwrap();
    std::fs::write(&stale, b"").unwrap();
    // 升级前那批只按 uid 命名的也要能收掉，否则永远躺在临时目录里。
    let legacy = dir.join("belfry-1.sock");
    std::fs::write(&legacy, b"").unwrap();
    // 不匹配前缀的文件一律不碰，别把别人的东西删了。
    let other = dir.join("something-else.sock");
    std::fs::write(&other, b"").unwrap();

    super::sweep_stale_sockets_in(&dir, "belfry-1", &dir.join("belfry-1-333.sock"));

    assert!(alive.exists(), "还在服务的实例不能被扫掉");
    assert!(!stale.exists(), "连不上的空壳该清掉");
    assert!(!legacy.exists(), "旧命名的残留也该清掉");
    assert!(other.exists(), "前缀不匹配的文件不该动");

    drop(listener);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 这条是这个模块最该守住的：**connect 失败不等于进程死了**。backlog 满、accept
/// 线程正忙、瞬时 EAGAIN 都会让 connect 失败，误判一次就把活实例的 socket 文件
/// unlink 掉——而 listener 对此毫无感知，它还在 accept，客户端却永远 ENOENT，
/// 报错指向「文件不存在」，看起来像应用根本没启动。真出过：正式版跑了 20 分钟，
/// 被本仓库起的一个测试实例扫掉了 socket。
#[cfg(unix)]
#[test]
fn sweeping_spares_a_busy_instance_that_holds_its_live_lock() {
    let dir = std::path::PathBuf::from(format!("/tmp/bfbusy{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    // 一个「活着但连不上」的实例：socket 文件在，但没人 accept，所以 connect 必
    // 失败——旧的判活逻辑到这里就会把它删掉。活体标记是它唯一的护身符。
    let busy = dir.join("belfry-1-444.sock");
    std::fs::write(&busy, b"").unwrap();
    let held = super::hold_live_lock_at(&busy).expect("应该能拿到活体标记");
    let next = dir.join("belfry-1-555.sock");
    // 落单的标记（没有 .sock 陪着、也没人握着）该收掉，否则会一直攒着。
    let orphan = dir.join("belfry-1-666.lock");
    std::fs::write(&orphan, b"").unwrap();
    // 而本进程自己的标记天生就是「落单」的：sweep 跑在 bind 之前，.sock 还没建。
    let mine = super::hold_live_lock_at(&next).expect("应该能拿到自己的标记");

    super::sweep_stale_sockets_in(&dir, "belfry-1", &next);

    assert!(
        busy.exists(),
        "还握着活体标记的实例不能被扫掉，哪怕它一时连不上"
    );
    assert!(!orphan.exists(), "落单又没人握着的标记该收掉");
    assert!(
        super::live_lock_path(&next).exists(),
        "本进程自己的标记不能被自己扫掉"
    );

    // 标记放掉（进程退出时内核也会这么做），同一个 socket 就该被认成残留了。
    //
    // 要等一下才能断言：并行跑的测试会 spawn 子进程（起 shell、ssh），fork 的
    // 瞬间子进程就继承了这个 fd 的副本，要到 exec 时 O_CLOEXEC 才关掉它。撞上
    // 那个窗口的话，父进程这边 drop 完了，锁还被子进程按着。
    //
    // 生产里这个偏差是安全方向的：把已经死的实例判成活的，只是让残留文件多留
    // 一轮，下次启动会收掉；反过来把活的判成死的才是致命的——那正是这条测试
    // 要守的东西。
    drop(held);
    let lock = super::live_lock_path(&busy);
    for _ in 0..50 {
        if super::try_grab_existing(&lock).is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    super::sweep_stale_sockets_in(&dir, "belfry-1", &next);

    assert!(!busy.exists(), "标记已释放，残留该清掉");
    assert!(
        !super::live_lock_path(&busy).exists(),
        "标记文件要跟着 socket 一起收，否则它自己会在临时目录里攒着"
    );

    drop(mine);
    let _ = std::fs::remove_dir_all(&dir);
}

/// socket 路径吃 SUN_LEN 预算（macOS 104 字节），而 macOS 的 TMPDIR 前缀本身
/// 就占了将近一半。往文件名里加东西（app 名、版本号）时要看着这条线——
/// 超了 bind 直接失败，表现是「协作静默不可用」，很难联想到路径长度。
#[cfg(unix)]
#[test]
fn the_socket_path_fits_in_the_platform_limit() {
    let path = super::socket_path().expect("应该算得出路径");
    let len = path.as_os_str().len();

    assert!(len < 104, "socket 路径 {len} 字节，超了 SUN_LEN：{path:?}");
}

/// 测试桩：只认「前端」和「审查」两个角色，并记录转手登记调用。
#[derive(Default)]
struct StubRooms {
    handoffs: std::sync::Mutex<Vec<(String, String, String)>>,
}

impl RoomDirectory for StubRooms {
    fn note_delegation(
        &self,
        room_id: Option<&str>,
        from_tab: &str,
        to_tab: &str,
        _bus_task_id: &str,
        _text: &str,
        _announce: bool,
    ) {
        if let Ok(mut list) = self.handoffs.lock() {
            list.push((
                room_id.unwrap_or_default().to_string(),
                from_tab.to_string(),
                to_tab.to_string(),
            ));
        }
    }

    fn say(
        &self,
        _tab_id: &str,
        _room: Option<&str>,
        text: &str,
        _reply_to: Option<&str>,
    ) -> Result<SayOutcome, String> {

        // 桩里只有「审查」一个别人：点名收窄后投递对象仍是它，靠 addressed/mentioned 区分口径。
        Ok(SayOutcome {
            room_id: "r-1".into(),
            room_name: "发布检查".into(),
            sender_role: "前端".into(),
            addressed: text.contains("@审查"),
            recipients: vec![MentionTarget {
                member_id: "m-2".into(),
                tab_id: "t2".into(),
                role: "审查".into(),
            }],
            message_id: "msg-1".into(),
            mentioned: if text.contains("@审查") { vec!["m-2".into()] } else { vec![] },
            reply_preview: None,
        })
    }

    fn react(
        &self,
        _tab_id: &str,
        _room: Option<&str>,
        message: &str,
        emoji: &str,
    ) -> Result<ReactOutcome, String> {
        Ok(ReactOutcome {
            room_id: "r-1".into(),
            room_name: "发布检查".into(),
            message_id: message.into(),
            message_short: "a1b2c3d4".into(),
            emoji: emoji.into(),
            active: true,
        })
    }

    fn log(&self, _tab_id: &str, _room: Option<&str>, _count: usize) -> Result<LogOutcome, String> {
        Ok(LogOutcome {
            room_name: "发布检查".into(),
            lines: vec![belfry_protocol::RoomLine {
                id: "a1b2c3d4".into(),
                author: "前端".into(),
                kind: "member".into(),
                text: "接口文档更新了".into(),
                at: 42,
                reactions: Vec::new(),
                reply_preview: None,
            }],
        })
    }

    fn my_rooms(&self, _tab_id: &str) -> Vec<RoomBrief> {
        vec![RoomBrief {
            name: "发布检查".into(),
            my_role: "前端".into(),
            members: vec!["前端".into(), "审查".into()],
            tasks: vec![belfry_protocol::RoomTaskBrief {
                title: "统一登录失败的错误提示".into(),
                stage: "已提交待验证".into(),
                receivers: vec!["前端".into()],
            }],
        }]
    }
}

#[test]
fn a_member_can_list_its_rooms() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    let access = RoomAccess::default();
    access.set(std::sync::Arc::new(StubRooms::default()));
    let token = token_of(&identities.issue("t1", None));

    let response = handle_line(
        &line("t1", &token, Command::Rooms),
        &identities,
        &registry,
        &board,
        &access,
    );
    match response {
        Response::Ok {
            data: ResponseData::Rooms { rooms },
        } => {
            assert_eq!(rooms.len(), 1);
            assert_eq!(rooms[0].name, "发布检查");
            assert_eq!(rooms[0].my_role, "前端");
            assert_eq!(rooms[0].tasks[0].stage, "已提交待验证");
        }
        other => panic!("应该拿到房间清单：{other:?}"),
    }
}

#[test]
fn rooms_before_the_store_is_ready_read_as_empty() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    let token = token_of(&identities.issue("t1", None));

    let response = handle_line(
        &line("t1", &token, Command::Rooms),
        &identities,
        &registry,
        &board,
        &RoomAccess::default(),
    );
    match response {
        Response::Ok {
            data: ResponseData::Rooms { rooms },
        } => assert!(rooms.is_empty(), "未就绪时如实回答不在任何房间，而不是报错"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_member_can_say_something_and_mentions_become_tasks() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    registry.replace(vec![crate::collab::registry::SessionSnapshot {
        tab_id: "t2".into(),
        name: Some("审查".into()),
        title: "另一条".into(),
        agent: "codex".into(),
        activity: "idle".into(),
        can_receive: true,
        project_root: Some("/proj/demo".into()),
    }]);
    let board = TaskBoard::default();
    let rooms = RoomAccess::default();
    let stub = std::sync::Arc::new(StubRooms::default());
    rooms.set(stub.clone());
    let token = identities
        .issue("t1", Some("/proj/demo"))
        .iter()
        .find(|(key, _)| key == belfry_protocol::ENV_TOKEN)
        .map(|(_, value)| value.clone())
        .unwrap();
    let request = Request {
        version: PROTOCOL_VERSION,
        tab_id: "t1".into(),
        token: token.clone(),
        command: Command::RoomSay {
            room: None,
            text: "@审查 你看下这个".into(),
            reply_to: None,
        },
    };
    let response = handle_line(
        &serde_json::to_string(&request).unwrap(),
        &identities,
        &registry,
        &board,
        &rooms,
    );
    match response {
        Response::Ok {
            data: ResponseData::RoomSaid {
                room,
                recipients,
                skipped,
            },
        } => {
            assert_eq!(room, "发布检查");
            assert_eq!(recipients, vec!["审查".to_string()]);
            assert!(skipped.is_empty());
        }
        other => panic!("{other:?}"),
    }
    // 群聊不是派活：不登记转手（交差回执属于 send 直派）。
    let handoffs = stub.handoffs.lock().unwrap().clone();
    assert!(handoffs.is_empty(), "群聊不该登记转手：{handoffs:?}");
    let tasks = board.snapshot();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].to, "t2");
    assert!(matches!(
        tasks[0].origin,
        Some(crate::collab::task::TaskOrigin::Room { .. })
    ));
    assert!(
        matches!(
            tasks[0].chat,
            Some(crate::collab::task::ChatDelivery { mentioned: true, .. })
        ),
        "点名是聊天投递，不是交差任务"
    );
    // 投给终端的口吻：聊天、要接话走 room say、没有 done 行。
    let injected = crate::collab::task::injection_text(&tasks[0], "发布检查");
    assert!(
        injected.contains("点了你的名") && injected.contains("room say") && !injected.contains("belfry done"),
        "被点名的人看到的是聊天口吻：{injected}"
    );

    // 不带点名＝群发：同样送达，注入口径是「看见即可」。
    let broadcast = Request {
        version: PROTOCOL_VERSION,
        tab_id: "t1".into(),
        token,
        command: Command::RoomSay {
            room: None,
            text: "大家同步一下进度".into(),
            reply_to: None,
        },
    };
    let response = handle_line(
        &serde_json::to_string(&broadcast).unwrap(),
        &identities,
        &registry,
        &board,
        &rooms,
    );
    match response {
        Response::Ok {
            data: ResponseData::RoomSaid { recipients, .. },
        } => assert_eq!(recipients, vec!["审查".to_string()]),
        other => panic!("{other:?}"),
    }
    // 20 秒窗口内的连发并进同一条排队中的投递：板上仍只有一条，正文带两句话。
    let tasks = board.snapshot();
    assert_eq!(tasks.len(), 1, "连发要合并成一条投递");
    assert!(
        tasks[0].instruction.contains("你看下这个") && tasks[0].instruction.contains("大家同步一下进度"),
        "合并后正文要按行带上每一句：{}",
        tasks[0].instruction
    );
    assert!(
        matches!(
            &tasks[0].chat,
            Some(crate::collab::task::ChatDelivery { message_ids, .. })
                if message_ids.iter().any(|id| id == "msg-1")
        ),
        "投递要带上消息 id，送达回执才写得回时间线"
    );

    let handoffs = stub.handoffs.lock().unwrap().clone();
    assert!(handoffs.is_empty(), "群发是讨论不是交接，不该登记转手：{handoffs:?}");
}

#[test]
fn a_member_can_react_and_the_response_names_the_message() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    let rooms = RoomAccess::default();
    rooms.set(std::sync::Arc::new(StubRooms::default()));
    let token = token_of(&identities.issue("t1", None));
    let response = handle_line(
        &line(
            "t1",
            &token,
            Command::RoomReact {
                room: None,
                message: "a1b2c3d4".into(),
                emoji: "👍".into(),
            },
        ),
        &identities,
        &registry,
        &board,
        &rooms,
    );
    match response {
        Response::Ok {
            data: ResponseData::RoomReacted {
                room,
                message,
                emoji,
                active,
            },
        } => {
            assert_eq!(room, "发布检查");
            assert_eq!(message, "a1b2c3d4");
            assert_eq!(emoji, "👍");
            assert!(active);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn say_before_the_store_is_ready_says_so() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    let rooms = RoomAccess::default();
    let token = identities
        .issue("t1", Some("/proj/demo"))
        .iter()
        .find(|(key, _)| key == belfry_protocol::ENV_TOKEN)
        .map(|(_, value)| value.clone())
        .unwrap();
    let request = Request {
        version: PROTOCOL_VERSION,
        tab_id: "t1".into(),
        token,
        command: Command::RoomSay {
            room: None,
            text: "有人吗".into(),
            reply_to: None,
        },
    };
    let response = handle_line(
        &serde_json::to_string(&request).unwrap(),
        &identities,
        &registry,
        &board,
        &rooms,
    );
    match response {
        Response::Error { message } => assert!(message.contains("还没就绪"), "{message}"),
        other => panic!("目录未就绪不该返回成功：{other:?}"),
    }
}
