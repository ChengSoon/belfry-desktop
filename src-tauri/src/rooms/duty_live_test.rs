//! Optional characterization of the real model, separate from deterministic regressions.
//! Requires an explicit ignored-test invocation, a freshly built CLI, and artifact directory.
use super::*;
use crate::collab::{CollabServer, RoomAccess, SessionIdentities};
use std::{
    io::Write,
    process::{Command as Process, Stdio},
};

fn write_json(root: &std::path::Path, name: &str, value: &impl serde::Serialize) {
    fs::write(root.join(name), serde_json::to_vec_pretty(value).unwrap()).unwrap();
}

fn user(f: &Fixture, text: &str) -> Vec<serde_json::Value> {
    f.store
        .mutate(&f.room, |room| {
            ops::say(room, &Actor::User, &[], text, None, false, now_millis())
        })
        .unwrap();
    f.drain("live-user")
}

fn cli(binary: &std::path::Path, env: &[(String, String)], args: &[&str]) -> String {
    let result = Process::new(binary)
        .args(args)
        .envs(env.iter().cloned())
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "CLI failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    String::from_utf8(result.stdout).unwrap()
}

#[test]
#[ignore = "manual live-model characterization; requires BELFRY_DUTY_CODEX and BELFRY_DUTY_LIVE_ARTIFACTS"]
fn model_assigns_by_current_responsibility_through_the_real_cli() {
    let codex = std::env::var("BELFRY_DUTY_CODEX").expect("explicit Codex executable required");
    let root = PathBuf::from(
        std::env::var_os("BELFRY_DUTY_LIVE_ARTIFACTS").expect("artifact directory required"),
    );
    fs::create_dir_all(&root).unwrap();
    let config_path = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap().join(".codex"))
        .join("config.toml");
    let config = fs::read_to_string(config_path)
        .unwrap_or_default()
        .parse::<toml_edit::DocumentMut>()
        .unwrap();
    let mcp = config
        .get("mcp_servers")
        .and_then(|item| item.as_table())
        .map(|table| table.iter().map(|(name, _)| name).collect::<Vec<_>>())
        .unwrap_or_default();
    write_json(
        &root,
        "codex-settings.json",
        &serde_json::json!({
            "model": config.get("model").and_then(|item| item.as_str()),
            "provider": config.get("model_provider").and_then(|item| item.as_str()),
            "mcpServers": mcp
        }),
    );
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let binary = std::env::var_os("BELFRY_DUTY_CLI")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest.join("target/debug/belfry"));
    let built = binary.metadata().unwrap().modified().unwrap();
    for path in [
        "crates/belfry-cli/src/main.rs",
        "crates/belfry-protocol/src/lib.rs",
        "crates/belfry-i18n/catalog.json",
    ] {
        assert!(
            manifest.join(path).metadata().unwrap().modified().unwrap() <= built,
            "rebuild the CLI after changing {path}"
        );
    }
    let only = std::env::var("BELFRY_DUTY_LIVE_CASE").ok();
    let cases = [
        "busy-matching-member",
        "changed-duty",
        "explicit-owner",
        "cross-responsibility",
        "no-match",
        "departed-identity",
    ];
    assert!(
        only.as_deref().is_none_or(|case| cases.contains(&case)),
        "unknown live case filter"
    );
    for case in cases {
        if only.as_deref().is_some_and(|only| only != case) {
            continue;
        }
        let artifacts = root.join(case);
        assert!(
            !artifacts.join("before.json").exists(),
            "use a fresh artifact directory to preserve prior results"
        );
        fs::create_dir_all(&artifacts).unwrap();
        let f = Fixture::new();
        let mut expected = vec![];
        let input = match case {
            "busy-matching-member" => {
                f.task(
                    "lead-tab",
                    RoomTaskOp::Add {
                        title: "准备存储格式规范".into(),
                        outcome: None,
                        assignee: Some(f.data.id.clone()),
                        after: vec![],
                    },
                );
                f.task("data-tab", RoomTaskOp::Start { task: "T1".into() });
                f.task(
                    "lead-tab",
                    RoomTaskOp::Add {
                        title: "界面检查".into(),
                        outcome: None,
                        assignee: Some(f.ui.id.clone()),
                        after: vec![],
                    },
                );
                f.drain("live-before-completion");
                f.task("ui-tab", RoomTaskOp::Done { task: "T2".into(), result: Some("界面检查完成。剩余问题是配置写回会丢失嵌套字段，需要补序列化兼容；该工作须等T1规范准备完成。".into()) });
                expected.push(f.data.id.clone());
                lead_text(&f.drain("live-task-done"))
            }
            "changed-duty" => {
                let old = cli_input(&f);
                f.task(
                    "lead-tab",
                    RoomTaskOp::Add {
                        title: "此前已明确分配的记录".into(),
                        outcome: None,
                        assignee: Some(f.data.id.clone()),
                        after: vec![],
                    },
                );
                f.drain("live-before-duty-change");
                f.store
                    .mutate(&f.room, |room| {
                        ops::update_member(room, &f.data.id, None, Some(UI), None, 500)?;
                        ops::update_member(room, &f.ui.id, None, Some(DATA), None, 501)
                    })
                    .unwrap();
                let updates = lead_text(&f.drain("live-duty-change"));
                expected.push(f.ui.id.clone());
                format!(
                    "此前读取的快照：\n{old}\n之后收到的通知：\n{updates}\n{}",
                    lead_text(&user(&f, "新任务：修正配置文件版本迁移，保留未知字段。"))
                )
            }
            "explicit-owner" => {
                expected.push(f.ui.id.clone());
                lead_text(&user(
                    &f,
                    "新任务：验证配置文件版本迁移。本项由我明确指定织羽负责，请保留这个负责人。",
                ))
            }
            "cross-responsibility" => {
                expected.extend([f.data.id.clone(), f.ui.id.clone()]);
                lead_text(&user(
                    &f,
                    "下一步同时修复配置写回的序列化兼容性，并完成设置页的键盘焦点和布局评审，最后汇总验收。",
                ))
            }
            "no-match" => lead_text(&user(
                &f,
                "接下来需要完成椭圆曲线新算法的数学安全性证明，请安排负责密码学证明的成员。",
            )),
            _ => {
                f.store
                    .mutate(&f.room, |room| {
                        ops::remove_member(room, &f.data.id, 500)?;
                        ops::add_member(
                            room,
                            "replacement-tab",
                            "codex",
                            "寻溪",
                            "核对供应商账单与付款记录",
                            false,
                            501,
                        )
                    })
                    .unwrap();
                f.registry.replace(["lead-tab", "replacement-tab", "ui-tab"].map(|tab| serde_json::from_value(serde_json::json!({
                    "tabId":tab,"name":tab,"title":tab,"agent":"codex","activity":"idle","canReceive":true,"projectRoot":f.root
                })).unwrap()).to_vec());
                let changes = lead_text(&f.drain("live-identity-change"));
                format!(
                    "{changes}\n{}",
                    lead_text(&user(
                        &f,
                        &format!(
                            "请把存储迁移交给原成员寻溪（成员ID：{}）。我指定的是这个身份，不要更换负责人。",
                            f.data.id
                        )
                    ))
                )
            }
        };
        let before = f.state();
        write_json(&artifacts, "before.json", &before);
        let identities = Arc::new(SessionIdentities::default());
        let access = Arc::new(RoomAccess::default());
        access.set(super::super::member_directory(
            f.store.clone(),
            f.registry.clone(),
        ));
        let server = CollabServer::start(
            identities.clone(),
            f.registry.clone(),
            f.board.clone(),
            access,
        )
        .unwrap();
        let mut env = identities.issue("lead-tab", f.root.to_str());
        env.extend([
            (
                belfry_protocol::ENV_ENDPOINT.into(),
                server.endpoint().to_string(),
            ),
            ("BELFRY_LANG".into(), "zh-CN".into()),
        ]);
        let status = cli(&binary, &env, &["room", "status"]);
        fs::write(artifacts.join("cli-before.txt"), &status).unwrap();
        let prompt = format!(
            "这是隔离的 Belfry 测试房间，没有真实业务代码。你是当前统筹。请根据下面收到的真实房间消息完成下一步派活；需要说明时用 room say 发给用户。\n唯一使用的控制程序是 {}，请用其 room status/task/say 命令操作本房间。不要实现任务、等待成员或访问别的会话。不需要给测试者提问。\n\n{input}",
            binary.display()
        );
        let mut process = Process::new("python3");
        process.args([
            manifest
                .join("../scripts/room-duty-model-probe.py")
                .as_os_str(),
            "--codex".as_ref(),
            codex.as_ref(),
            "--project".as_ref(),
            f.root.as_os_str(),
            "--artifacts".as_ref(),
            artifacts.as_os_str(),
            "--settings".as_ref(),
            root.join("codex-settings.json").as_os_str(),
        ]);
        for (key, _) in std::env::vars()
            .filter(|(key, _)| key.starts_with("BELFRY_") || key == "CODEX_THREAD_ID")
        {
            process.env_remove(key);
        }
        let mut child = process
            .envs(env.iter().cloned())
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(prompt.as_bytes())
            .unwrap();
        let result = child.wait().unwrap();
        let after = f.state();
        write_json(&artifacts, "after.json", &after);
        fs::write(
            artifacts.join("cli-after.txt"),
            cli(&binary, &env, &["room", "status"]),
        )
        .unwrap();
        identities.revoke("lead-tab");
        assert!(
            result.success(),
            "model process failed for {case}; see {}",
            artifacts.display()
        );
        let added = &after.tasks[before.tasks.len()..];
        let peer_owners = added
            .iter()
            .filter_map(|task| task.assignee.clone())
            .filter(|id| id != &f.lead.id)
            .collect::<std::collections::BTreeSet<_>>();
        let expected = expected
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>();
        write_json(
            &artifacts,
            "expectation.json",
            &serde_json::json!({ "peerOwners":expected, "actualPeerOwners":peer_owners, "newTasks":added }),
        );
        assert_eq!(
            peer_owners,
            expected,
            "wrong actual owner in {case}; see {}",
            artifacts.display()
        );
        for old in &before.tasks {
            assert_eq!(
                after
                    .tasks
                    .iter()
                    .find(|task| task.id == old.id)
                    .unwrap()
                    .assignee,
                old.assignee,
                "must not silently reassign existing task {}",
                old.id
            );
        }
        if case == "busy-matching-member" {
            assert!(
                added
                    .iter()
                    .any(|task| task.assignee.as_deref() == Some(f.data.id.as_str())
                        && task.blocked_by.iter().any(|id| id == "T1")),
                "the matching member's prerequisite must be retained"
            );
        }
        if expected.is_empty() {
            assert!(
                after
                    .messages
                    .iter()
                    .skip(before.messages.len())
                    .any(|m| m.by == f.lead.id
                        && m.to.iter().any(|to| to == "user")
                        && !m.text.trim().is_empty()),
                "the gap must be reported in the room"
            );
        }
        println!(
            "live model case {case}: actual room task owners verified; artifacts={}",
            artifacts.display()
        );
    }
}

fn cli_input(f: &Fixture) -> String {
    let (value, _) = f
        .directory()
        .handle("lead-tab", &Command::RoomStatus { room: None })
        .unwrap();
    serde_json::to_value(value).unwrap()["status"]["coordination"]
        .as_str()
        .unwrap()
        .to_string()
}
