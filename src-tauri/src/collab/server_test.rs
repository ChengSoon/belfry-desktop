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
    );
    let missing = handle_line(
        &line("t9", "猜的", Command::Peers),
        &identities,
        &registry,
        &board,
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
        let response = handle_line(bad, &identities, &registry, &board);
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
