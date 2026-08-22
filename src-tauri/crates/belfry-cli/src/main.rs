//! `belfry` —— 从 Agent 会话里连回桌面端的控制命令。
//!
//! 这个二进制刻意做得很薄：解析参数、连上端点、发一行 JSON、把响应打成人话。
//! 所有判断都留在 app 侧，因为 CLI 是随安装包分发的，改它要发版；app 侧的
//! 逻辑可以跟着应用一起迭代。
//!
//! 输出面向的是 Agent，不是人：它读到的是终端文本，所以失败要说人话、
//! 说清下一步做什么，而不是抛一个错误码让它自己猜。

use std::io::{BufRead, BufReader, Write};
use std::process::ExitCode;

use belfry_protocol::{
    Command, ENV_ENDPOINT, ENV_TAB_ID, ENV_TOKEN, Request, Response, ResponseData,
};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: &[String]) -> Result<String, String> {
    let command = parse(args)?;
    let session = Session::from_env()?;
    let response = session.send(command)?;
    match response {
        Response::Ok { data } => Ok(render(data)),
        Response::Error { message } => Err(message),
    }
}

const USAGE: &str = "\
belfry —— Belfry 会话之间的协作命令

  belfry peers                     看看现在还有哪些会话，各自在忙什么
  belfry send <目标> <指令>         请另一条会话做点什么
  belfry inbox                     派给我、还没结的任务
  belfry done <任务号> [结果]       我做完了（唯一可信的完成信号）
  belfry fail <任务号> <原因>       我做不了

  belfry ctx list                  列出这个项目的共享上下文
  belfry ctx get <id>              读一条的正文
  belfry ctx put <标题> [正文]      写一条；省略正文时从标准输入读

目标可以写 tabId、会话标题的一部分，或 agent 名。
在别人派的任务里再派活时，加 --parent <任务号>，这样转包层数和环才算得准。

只在 Belfry 托管的 Agent 会话里可用。";

fn parse(args: &[String]) -> Result<Command, String> {
    let head = args.first().map(String::as_str);
    match (head, args.len()) {
        (Some("peers"), 1) => Ok(Command::Peers),
        (Some("inbox"), 1) => Ok(Command::Inbox),
        (Some("ctx"), _) => parse_ctx(&args[1..]),
        (Some("send"), _) => parse_send(&args[1..]),
        (Some("done"), _) => parse_done(&args[1..]),
        (Some("fail"), _) => parse_fail(&args[1..]),
        (Some("help") | Some("--help") | Some("-h"), _) | (None, _) => Err(USAGE.to_string()),
        (Some(other), _) => Err(format!("不认识的命令 `{other}`。\n\n{USAGE}")),
    }
}

fn parse_ctx(args: &[String]) -> Result<Command, String> {
    match args.first().map(String::as_str) {
        Some("list") => Ok(Command::ContextList),
        Some("get") => args
            .get(1)
            .map(|id| Command::ContextGet { id: id.clone() })
            .ok_or_else(|| "belfry ctx get 需要一个 id，用 belfry ctx list 查".to_string()),
        Some("put") => {
            let title = args
                .get(1)
                .ok_or_else(|| "belfry ctx put 需要一个标题".to_string())?;
            // 正文可以从管道来：Agent 更习惯把长内容 `cat` 进来，
            // 而不是塞进一个要小心转义的命令行参数。
            let body = match args.get(2) {
                Some(value) => value.clone(),
                None => read_stdin()?,
            };
            if body.trim().is_empty() {
                return Err("正文是空的，没有存的意义".to_string());
            }
            Ok(Command::ContextPut {
                title: title.clone(),
                body,
                tags: args.get(3..).map(<[String]>::to_vec).unwrap_or_default(),
            })
        }
        _ => Err(format!("belfry ctx 需要 list / get / put。\n\n{USAGE}")),
    }
}

/// `belfry send <目标> <指令> [--parent <任务号>]`
///
/// 目标和指令都按位置取，不搞 `--to` / `--message`：Agent 拼命令行时
/// 位置参数出错的概率明显低于记住一组标志名。
fn parse_send(args: &[String]) -> Result<Command, String> {
    let mut positional = Vec::new();
    let mut parent_task = None;
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        if arg == "--parent" {
            parent_task = Some(
                rest.next()
                    .ok_or_else(|| "--parent 后面要跟任务号".to_string())?
                    .clone(),
            );
        } else {
            positional.push(arg.clone());
        }
    }
    let to = positional
        .first()
        .ok_or_else(|| "belfry send 需要一个目标，用 belfry peers 看看有谁".to_string())?;
    if positional.len() < 2 {
        return Err("belfry send 需要一条指令".to_string());
    }
    Ok(Command::Send {
        to: to.clone(),
        // 指令允许不加引号写成多个词，拼回去比要求 Agent 记得转义可靠。
        instruction: positional[1..].join(" "),
        parent_task,
    })
}

fn parse_done(args: &[String]) -> Result<Command, String> {
    let task = args
        .first()
        .ok_or_else(|| "belfry done 需要任务号，用 belfry inbox 查".to_string())?;
    Ok(Command::Done {
        task: task.clone(),
        result: (args.len() > 1).then(|| args[1..].join(" ")),
    })
}

fn parse_fail(args: &[String]) -> Result<Command, String> {
    let task = args
        .first()
        .ok_or_else(|| "belfry fail 需要任务号，用 belfry inbox 查".to_string())?;
    if args.len() < 2 {
        return Err("belfry fail 要说明原因：派活那边只能看到你写的这句".to_string());
    }
    Ok(Command::Fail {
        task: task.clone(),
        reason: args[1..].join(" "),
    })
}

fn read_stdin() -> Result<String, String> {
    let mut body = String::new();
    std::io::Read::read_to_string(&mut std::io::stdin(), &mut body)
        .map_err(|err| format!("读不了标准输入：{err}"))?;
    Ok(body)
}

struct Session {
    endpoint: String,
    tab_id: String,
    token: String,
}

impl Session {
    fn from_env() -> Result<Self, String> {
        // 三个变量是一起注入的，缺任何一个都说明这不是 Belfry 开的 Agent 会话。
        let missing = || {
            "这里不是 Belfry 的 Agent 会话（缺少身份信息），belfry 命令只在那里面能用"
                .to_string()
        };
        Ok(Self {
            endpoint: std::env::var(ENV_ENDPOINT).map_err(|_| {
                "Belfry 的协作服务没有启动，这个会话没法和别的会话通信".to_string()
            })?,
            tab_id: std::env::var(ENV_TAB_ID).map_err(|_| missing())?,
            token: std::env::var(ENV_TOKEN).map_err(|_| missing())?,
        })
    }

    fn send(&self, command: Command) -> Result<Response, String> {
        let request = Request::new(self.tab_id.clone(), self.token.clone(), command);
        let mut line =
            serde_json::to_string(&request).map_err(|err| format!("请求序列化失败：{err}"))?;
        line.push('\n');

        let stream = self.connect()?;
        let mut writer = stream.write_half()?;
        writer
            .write_all(line.as_bytes())
            .and_then(|()| writer.flush())
            .map_err(|err| format!("发不出去：{err}"))?;

        let mut reply = String::new();
        BufReader::new(stream)
            .read_line(&mut reply)
            .map_err(|err| format!("没收到回应：{err}"))?;
        serde_json::from_str(&reply).map_err(|err| format!("回应看不懂：{err}"))
    }

    fn connect(&self) -> Result<Transport, String> {
        let cannot = |err| format!("连不上 Belfry（{}）：{err}", self.endpoint);
        if let Some(path) = self.endpoint.strip_prefix("unix:") {
            #[cfg(unix)]
            {
                return std::os::unix::net::UnixStream::connect(path)
                    .map(Transport::Unix)
                    .map_err(cannot);
            }
            #[cfg(not(unix))]
            {
                let _ = path;
                return Err("这个平台上不支持 unix socket 端点".to_string());
            }
        }
        if let Some(addr) = self.endpoint.strip_prefix("tcp:") {
            return std::net::TcpStream::connect(addr)
                .map(Transport::Tcp)
                .map_err(cannot);
        }
        Err(format!("端点格式不认识：{}", self.endpoint))
    }
}

enum Transport {
    #[cfg(unix)]
    Unix(std::os::unix::net::UnixStream),
    Tcp(std::net::TcpStream),
}

impl Transport {
    /// 读写分开持有：BufReader 会把 stream 吃掉。
    fn write_half(&self) -> Result<Box<dyn Write>, String> {
        let cloned = match self {
            #[cfg(unix)]
            Self::Unix(stream) => stream
                .try_clone()
                .map(|value| Box::new(value) as Box<dyn Write>),
            Self::Tcp(stream) => stream
                .try_clone()
                .map(|value| Box::new(value) as Box<dyn Write>),
        };
        cloned.map_err(|err| format!("连接不可用：{err}"))
    }
}

impl std::io::Read for Transport {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            #[cfg(unix)]
            Self::Unix(stream) => stream.read(buf),
            Self::Tcp(stream) => stream.read(buf),
        }
    }
}

/// 渲染成给 Agent 读的文本。
///
/// 不输出 JSON：Agent 读的是终端，人话它一样解析得了，而且用户瞟一眼也能看懂。
fn render(data: ResponseData) -> String {
    match data {
        ResponseData::Peers { peers } => {
            if peers.is_empty() {
                return "现在没有别的会话".to_string();
            }
            peers
                .iter()
                .map(|peer| {
                    let mark = if peer.is_self { "* " } else { "  " };
                    let state = if peer.is_self {
                        "（我自己）".to_string()
                    } else if peer.can_receive {
                        format!("{} · 可以派活", peer.activity)
                    } else {
                        format!("{} · 现在收不了", peer.activity)
                    };
                    format!("{mark}{}  {}  {state}", peer.tab_id, peer.title)
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        ResponseData::ContextList { items } => {
            if items.is_empty() {
                return "共享上下文还是空的".to_string();
            }
            items
                .iter()
                .map(|item| {
                    let pin = if item.pinned { "[置顶] " } else { "" };
                    // 落盘的直接给路径：Agent 自己 cat 比再走一趟 IPC 快。
                    let where_ = item
                        .path
                        .as_deref()
                        .map(|path| format!("  → {path}"))
                        .unwrap_or_default();
                    format!("{pin}{}  {}{where_}", item.id, item.title)
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        ResponseData::ContextBody { body } => body,
        ResponseData::ContextPut { id, reference } => {
            format!("已存下 {id}，引用它用：{reference}")
        }
        ResponseData::Sent {
            task,
            to,
            pending_approval,
        } => {
            if pending_approval {
                // 说清「还没送到」，否则 Agent 会当成对方已经开工，接着去等结果。
                format!("任务 {task} 已提交给「{to}」，等用户确认后才会送达")
            } else {
                format!("任务 {task} 已送给「{to}」")
            }
        }
        ResponseData::Settled { task } => format!("任务 {task} 已结"),
        ResponseData::Inbox { tasks } => {
            if tasks.is_empty() {
                return "没有派给你的任务".to_string();
            }
            tasks
                .iter()
                .map(|task| {
                    format!(
                        "{}  来自 {}  [{}]\n    {}",
                        task.task, task.from, task.state, task.instruction
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peers_needs_no_arguments() {
        assert!(matches!(parse(&["peers".into()]), Ok(Command::Peers)));
        // 多给参数说明用法理解错了，早点说清比默默忽略强。
        assert!(parse(&["peers".into(), "多余".into()]).is_err());
    }

    #[test]
    fn ctx_get_requires_an_id() {
        assert!(matches!(
            parse(&["ctx".into(), "get".into(), "abc".into()]),
            Ok(Command::ContextGet { .. })
        ));
        let err = parse(&["ctx".into(), "get".into()]).unwrap_err();
        // 错误里要带上「怎么找到 id」，Agent 才知道下一步敲什么。
        assert!(err.contains("ctx list"), "{err}");
    }

    #[test]
    fn ctx_put_takes_tags_after_the_body() {
        match parse(&[
            "ctx".into(),
            "put".into(),
            "标题".into(),
            "正文".into(),
            "队列".into(),
            "回滚".into(),
        ]) {
            Ok(Command::ContextPut { title, body, tags }) => {
                assert_eq!(title, "标题");
                assert_eq!(body, "正文");
                assert_eq!(tags, vec!["队列".to_string(), "回滚".to_string()]);
            }
            other => panic!("解析结果不对：{other:?}"),
        }
    }

    #[test]
    fn an_unknown_command_shows_usage() {
        let err = parse(&["派活".into()]).unwrap_err();
        assert!(err.contains("belfry peers"), "{err}");
    }

    #[test]
    fn no_arguments_shows_usage() {
        assert!(parse(&[]).unwrap_err().contains("belfry peers"));
    }

    #[test]
    fn peers_render_marks_self_and_readiness() {
        let text = render(ResponseData::Peers {
            peers: vec![
                belfry_protocol::Peer {
                    tab_id: "t1".into(),
                    title: "我".into(),
                    agent: "claude".into(),
                    can_receive: true,
                    activity: "idle".into(),
                    is_self: true,
                },
                belfry_protocol::Peer {
                    tab_id: "t2".into(),
                    title: "忙着".into(),
                    agent: "codex".into(),
                    can_receive: false,
                    activity: "talking".into(),
                    is_self: false,
                },
            ],
        });
        assert!(text.contains("* t1"), "自己那条要标出来：{text}");
        assert!(text.contains("收不了"), "{text}");
    }

    #[test]
    fn an_empty_roster_says_so_instead_of_printing_nothing() {
        // 空输出会被 Agent 当成命令失败，得给一句明确的话。
        assert!(!render(ResponseData::Peers { peers: vec![] }).is_empty());
        assert!(!render(ResponseData::ContextList { items: vec![] }).is_empty());
    }

    #[test]
    fn a_spilled_entry_shows_its_path_so_the_agent_can_read_it() {
        let text = render(ResponseData::ContextList {
            items: vec![belfry_protocol::ContextEntry {
                id: "c1".into(),
                title: "长产物".into(),
                kind: "artifact".into(),
                path: Some(".belfry/context/c1.md".into()),
                pinned: true,
                tags: vec![],
            }],
        });
        assert!(text.contains(".belfry/context/c1.md"), "{text}");
        assert!(text.contains("[置顶]"), "{text}");
    }

    #[test]
    fn send_takes_target_then_instruction() {
        match parse(&["send".into(), "reviewer".into(), "审".into(), "一下队列".into()]) {
            Ok(Command::Send { to, instruction, parent_task }) => {
                assert_eq!(to, "reviewer");
                // 指令不加引号写成多个词也要拼得回来。
                assert_eq!(instruction, "审 一下队列");
                assert!(parent_task.is_none());
            }
            other => panic!("解析结果不对：{other:?}"),
        }
    }

    #[test]
    fn send_picks_up_the_parent_task_anywhere() {
        match parse(&[
            "send".into(), "reviewer".into(), "--parent".into(), "01ABCDEF".into(),
            "接着".into(), "干".into(),
        ]) {
            Ok(Command::Send { to, instruction, parent_task }) => {
                assert_eq!(to, "reviewer");
                assert_eq!(instruction, "接着 干");
                assert_eq!(parent_task.as_deref(), Some("01ABCDEF"));
            }
            other => panic!("解析结果不对：{other:?}"),
        }
    }

    #[test]
    fn send_without_an_instruction_is_rejected() {
        assert!(parse(&["send".into(), "reviewer".into()]).is_err());
        let err = parse(&["send".into()]).unwrap_err();
        assert!(err.contains("belfry peers"), "要告诉它去哪找目标：{err}");
    }

    #[test]
    fn a_dangling_parent_flag_is_rejected() {
        assert!(parse(&["send".into(), "r".into(), "干活".into(), "--parent".into()]).is_err());
    }

    #[test]
    fn done_can_carry_a_result_or_not() {
        match parse(&["done".into(), "01ABCDEF".into()]) {
            Ok(Command::Done { task, result }) => {
                assert_eq!(task, "01ABCDEF");
                assert!(result.is_none());
            }
            other => panic!("{other:?}"),
        }
        match parse(&["done".into(), "01ABCDEF".into(), "写在".into(), "out.md".into()]) {
            Ok(Command::Done { result, .. }) => assert_eq!(result.as_deref(), Some("写在 out.md")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn fail_requires_a_reason() {
        // 派活那边只能看到这句话，空着等于什么都没说。
        assert!(parse(&["fail".into(), "01ABCDEF".into()]).is_err());
        assert!(parse(&["fail".into(), "01ABCDEF".into(), "跑不动".into()]).is_ok());
    }

    #[test]
    fn a_pending_send_says_it_is_not_delivered_yet() {
        let text = render(ResponseData::Sent {
            task: "01ABCDEF".into(),
            to: "审查那条".into(),
            pending_approval: true,
        });
        // 不说清楚的话，Agent 会以为对方已经开工，接着去等结果。
        assert!(text.contains("确认"), "{text}");

        let sent = render(ResponseData::Sent {
            task: "01ABCDEF".into(),
            to: "审查那条".into(),
            pending_approval: false,
        });
        assert!(!sent.contains("确认"), "{sent}");
    }

    #[test]
    fn an_empty_inbox_says_so() {
        assert!(!render(ResponseData::Inbox { tasks: vec![] }).is_empty());
    }

    #[test]
    fn inbox_shows_who_asked_and_what_for() {
        let text = render(ResponseData::Inbox {
            tasks: vec![belfry_protocol::InboxTask {
                task: "01ABCDEF".into(),
                from: "t1".into(),
                instruction: "审一下队列回滚".into(),
                state: "dispatched".into(),
            }],
        });
        assert!(text.contains("01ABCDEF") && text.contains("审一下队列回滚"), "{text}");
    }
}
