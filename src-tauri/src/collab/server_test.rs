use std::fs;
use std::path::PathBuf;

use super::*;
use crate::collab::registry::SessionSnapshot;
use crate::collab::task::TaskBoard;

fn temp_root(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "belfry-server-{tag}-{}-{}",
        std::process::id(),
        ulid::Ulid::generate()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn snapshot(tab_id: &str, agent: &str) -> SessionSnapshot {
    SessionSnapshot {
        tab_id: tab_id.to_string(),
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

    let response = handle_line(&line("t1", &token, Command::Peers), &identities, &registry, &board);

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

    let response = handle_line(&line("t1", "猜的", Command::Peers), &identities, &registry, &board);

    assert!(matches!(response, Response::Error { .. }));
}

#[test]
fn an_unknown_session_and_a_wrong_token_look_identical() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    identities.issue("t1", None);

    let wrong = handle_line(&line("t1", "猜的", Command::Peers), &identities, &registry, &board);
    let missing = handle_line(&line("t9", "猜的", Command::Peers), &identities, &registry, &board);

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
    let response = handle_line(&serde_json::to_string(&request).unwrap(), &identities, &registry, &board);

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

#[test]
fn context_write_records_the_real_agent_as_its_source() {
    let root = temp_root("put");
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    let token = token_of(&identities.issue("t1", Some(root.to_str().unwrap())));
    registry.replace(vec![snapshot("t1", "codex")]);

    let response = handle_line(&line(
            "t1",
            &token,
            Command::ContextPut {
                title: "跑测试的结论".into(),
                body: "队列回滚要保序".into(),
                tags: vec!["队列".into()],
            },
        ), &identities, &registry, &board);
    assert!(matches!(response, Response::Ok { .. }), "{response:?}");

    let items = crate::collab::store::list(root.to_str().unwrap()).unwrap();
    assert_eq!(items.len(), 1);
    // 来路要记真实 agent，且不是在这一层硬编码出来的。
    match &items[0].source {
        crate::collab::contracts::ContextSource::Agent { tab_id, agent } => {
            assert_eq!(tab_id, "t1");
            assert_eq!(agent, "codex");
        }
        other => panic!("来路应该是 agent：{other:?}"),
    }

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn context_round_trips_through_the_wire() {
    let root = temp_root("roundtrip");
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    let token = token_of(&identities.issue("t1", Some(root.to_str().unwrap())));
    registry.replace(vec![snapshot("t1", "claude")]);

    let put = handle_line(&line(
            "t1",
            &token,
            Command::ContextPut {
                title: "约定".into(),
                body: "只改路由字段".into(),
                tags: vec![],
            },
        ), &identities, &registry, &board);
    let id = match put {
        Response::Ok {
            data: ResponseData::ContextPut { id, .. },
        } => id,
        other => panic!("写入失败：{other:?}"),
    };

    let got = handle_line(&line("t1", &token, Command::ContextGet { id }), &identities, &registry, &board);
    match got {
        Response::Ok {
            data: ResponseData::ContextBody { body },
        } => assert_eq!(body, "只改路由字段"),
        other => panic!("读回失败：{other:?}"),
    }

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_session_without_a_project_gets_a_clear_reason() {
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    let token = token_of(&identities.issue("t1", None));

    let response = handle_line(&line("t1", &token, Command::ContextList), &identities, &registry, &board);

    match response {
        // 别让 Agent 对着静默失败反复重试。
        Response::Error { message } => assert!(message.contains("项目"), "{message}"),
        other => panic!("应该说明没打开项目：{other:?}"),
    }
}

#[test]
fn one_session_cannot_read_another_projects_context() {
    let mine = temp_root("mine");
    let theirs = temp_root("theirs");
    let identities = SessionIdentities::default();
    let registry = SessionRegistry::default();
    let board = TaskBoard::default();
    let my_token = token_of(&identities.issue("t1", Some(mine.to_str().unwrap())));
    identities.issue("t2", Some(theirs.to_str().unwrap()));
    registry.replace(vec![snapshot("t1", "claude"), snapshot("t2", "codex")]);

    // t2 往自己项目里写一条
    let their_token = token_of(&identities.issue("t2", Some(theirs.to_str().unwrap())));
    handle_line(&line(
            "t2",
            &their_token,
            Command::ContextPut {
                title: "别人的".into(),
                body: "机密".into(),
                tags: vec![],
            },
        ), &identities, &registry, &board);

    // t1 列自己的，看不到 t2 的东西：读写始终落在会话自己的项目里。
    let response = handle_line(&line("t1", &my_token, Command::ContextList), &identities, &registry, &board);
    match response {
        Response::Ok {
            data: ResponseData::ContextList { items },
        } => assert!(items.is_empty(), "不该看到别的项目的条目：{items:?}"),
        other => panic!("应该拿到空列表：{other:?}"),
    }

    let _ = fs::remove_dir_all(&mine);
    let _ = fs::remove_dir_all(&theirs);
}
