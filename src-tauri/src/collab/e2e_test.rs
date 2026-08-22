//! 端到端：真起一个 server，用真的 `belfry` 二进制连上去。
//!
//! `server_test.rs` 直接调 `handle_line`，绕过了传输层——而传输层恰恰最容易
//! 出问题：socket 路径、文件权限、按行分帧、读写各持一半。这一条把那段也走完。
//!
//! 二进制没构建时跳过而不是失败：`cargo test` 不会自动构建别的 crate 的 bin，
//! 让整份测试因此变红只会训练人忽略红灯。

use std::process::Command;
use std::sync::Arc;

use super::identity::SessionIdentities;
use super::registry::{SessionRegistry, SessionSnapshot};
use super::server::CollabServer;
use super::task::TaskBoard;

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
    let Some(server) = CollabServer::start(identities.clone(), registry.clone(), board.clone())
    else {
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
            title: "我".into(),
            agent: "claude".into(),
            activity: "idle".into(),
            can_receive: true,
            project_root: project.to_str().map(str::to_string),
        },
        SessionSnapshot {
            tab_id: "t2".into(),
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
    assert!(text.contains("* t1"), "自己那条要标出来：{text}");
    assert!(text.contains("t2"), "别的会话也该在：{text}");

    // 2. 写进去再读回来：IPC + 落盘走完整一圈
    let put = run(
        &binary,
        &endpoint,
        &token,
        &["ctx", "put", "端到端", "这条是 CLI 写进去的"],
    );
    assert!(put.status.success(), "写入应该成功：{put:?}");

    let list = run(&binary, &endpoint, &token, &["ctx", "list"]);
    let listed = String::from_utf8_lossy(&list.stdout).to_string();
    assert!(listed.contains("端到端"), "刚写的应该列得出来：{listed}");

    // 3. 伪造 token 必须被挡住，且失败要走 stderr、退出码非零
    let denied = run(&binary, &endpoint, "伪造的", &["peers"]);
    assert!(!denied.status.success(), "错 token 不该成功");
    assert!(
        !String::from_utf8_lossy(&denied.stderr).is_empty(),
        "失败得说清原因，Agent 读的是 stderr"
    );

    // 4. 派活：t1 用标题片段找到 t2，闸门默认 Ask，所以只是受理
    let sent = run(&binary, &endpoint, &token, &["send", "另一条", "审一下队列回滚"]);
    let sent_text = String::from_utf8_lossy(&sent.stdout).to_string();
    assert!(sent.status.success(), "派活应该受理：{sent:?}");
    assert!(
        sent_text.contains("确认"),
        "默认 Ask 下要说清还没送到：{sent_text}"
    );

    // 5. 派给自己会绕成死结，必须挡住
    let to_self = run(&binary, &endpoint, &token, &["send", "t1", "自己干"]);
    assert!(!to_self.status.success(), "不该允许给自己派活");

    // 6. 结任务：只有接收方能结，派活方不行
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

    let _ = std::fs::remove_dir_all(&project);
}

fn cli_binary() -> Option<std::path::PathBuf> {
    let name = if cfg!(windows) { "belfry.exe" } else { "belfry" };
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target/debug")
        .join(name);
    path.exists().then_some(path)
}

fn run(
    binary: &std::path::Path,
    endpoint: &str,
    token: &str,
    args: &[&str],
) -> std::process::Output {
    Command::new(binary)
        .args(args)
        .env(belfry_protocol::ENV_ENDPOINT, endpoint)
        .env(belfry_protocol::ENV_TAB_ID, "t1")
        .env(belfry_protocol::ENV_TOKEN, token)
        .output()
        .expect("跑不起来 belfry")
}
