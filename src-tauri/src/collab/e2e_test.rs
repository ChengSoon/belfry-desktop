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
use super::server::CollabServer;
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
        sent_text.contains("已送给"),
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
