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
use std::time::{Duration, Instant};

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

/// 一次调用要么问一句就走，要么盯着一条任务等它结。
#[derive(Debug)]
enum Action {
    Once(Command),
    /// `timeout: None` 表示一直等到对方交差。
    Wait {
        task: String,
        timeout: Option<Duration>,
    },
}

/// 刚派出去的活可能很快就结，前 30 秒跟紧一点；之后放缓——
/// 一个跑一小时的活，每秒问一次纯属浪费。
fn poll_interval(waited: Duration) -> Duration {
    if waited < Duration::from_secs(30) {
        Duration::from_secs(1)
    } else {
        Duration::from_secs(5)
    }
}

fn run(args: &[String]) -> Result<String, String> {
    let action = parse(args)?;
    let session = Session::from_env()?;
    match action {
        Action::Once(command) => match session.send(command)? {
            Response::Ok { data } => Ok(render(data)),
            Response::Error { message } => Err(message),
        },
        Action::Wait { task, timeout } => wait_for(&session, &task, timeout),
    }
}

/// 反复问同一条任务，直到它结了或者等够了。
///
/// 轮询而不是让服务端 hold 住连接：hold 住要为每个等待方留一条线程和一套唤醒机制，
/// 而这里等的本来就是分钟级、甚至小时级的动作。
///
/// 不给 `--timeout` 就一直等。给个默认上限反而制造一类难查的失败：半小时后报一句
/// 「还没结」，而 Agent 很容易把它读成「可以往下走了」。一直等也不会真挂死——对方
/// 会话关掉、用户在面板按「全部停下」、或者 Esc 掉这条会话，三条路都会让它返回。
fn wait_for(session: &Session, task: &str, timeout: Option<Duration>) -> Result<String, String> {
    let started = Instant::now();
    let deadline = timeout.map(|value| started + value);
    loop {
        let data = match session.send(Command::TaskState {
            task: task.to_string(),
        })? {
            Response::Ok { data } => data,
            Response::Error { message } => return Err(message),
        };
        if matches!(&data, ResponseData::TaskState { settled: true, .. }) {
            return Ok(render(data));
        }
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            // 超时不等于完成：如实说还没结，并把当前状态一起给出去，
            // 让 Agent 自己决定是接着等、还是去问用户。
            return Err(format!(
                "等了 {} 秒它还没结。{}\n要接着等就再敲一次 belfry wait（不加 --timeout 就一直等）。",
                started.elapsed().as_secs(),
                render(data)
            ));
        }
        std::thread::sleep(poll_interval(started.elapsed()));
    }
}

const USAGE: &str = "\
belfry —— Belfry 会话之间的协作命令

  belfry peers                     看看现在还有哪些会话，各自在忙什么
  belfry send <目标> <指令>         请另一条会话做点什么
  belfry inbox                     派给我、还没结的任务
  belfry done <任务号> [结果]       我做完了（唯一可信的完成信号）
  belfry fail <任务号> <原因>       我做不了
  belfry wait <任务号>             盯着它，等对方交差再往下走（一直等；--timeout <秒> 设上限）

目标写会话的名字（在侧栏起的，如 reviewer），也接受 tabId。
不认标题片段和 agent 类型：标题会随对话变，同类会话又可能有好几条。
在别人派的任务里再派活时，加 --parent <任务号>，这样转包层数和环才算得准。

只在 Belfry 托管的 Agent 会话里可用。";

fn parse(args: &[String]) -> Result<Action, String> {
    let head = args.first().map(String::as_str);
    let once = |command| Ok(Action::Once(command));
    match (head, args.len()) {
        (Some("peers"), 1) => once(Command::Peers),
        (Some("inbox"), 1) => once(Command::Inbox),
        (Some("send"), _) => parse_send(&args[1..]).and_then(once),
        (Some("done"), _) => parse_done(&args[1..]).and_then(once),
        (Some("fail"), _) => parse_fail(&args[1..]).and_then(once),
        (Some("wait"), _) => parse_wait(&args[1..]),
        (Some("help") | Some("--help") | Some("-h"), _) | (None, _) => Err(USAGE.to_string()),
        (Some(other), _) => Err(format!("不认识的命令 `{other}`。\n\n{USAGE}")),
    }
}

/// `belfry wait <任务号> [--timeout <秒>]`
fn parse_wait(args: &[String]) -> Result<Action, String> {
    let mut task = None;
    // 默认一直等：这个命令的本意就是「等对方交差」。
    let mut timeout = None;
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        if arg == "--timeout" {
            let raw = rest
                .next()
                .ok_or_else(|| "--timeout 后面要跟秒数".to_string())?;
            let secs: u64 = raw
                .parse()
                .map_err(|_| format!("--timeout 要是秒数，收到的是 `{raw}`"))?;
            if secs == 0 {
                return Err("--timeout 至少 1 秒".to_string());
            }
            timeout = Some(Duration::from_secs(secs));
        } else if task.is_none() {
            task = Some(arg.clone());
        } else {
            return Err(format!("belfry wait 只等一条任务，多出来的是 `{arg}`"));
        }
    }
    Ok(Action::Wait {
        task: task.ok_or_else(|| "belfry wait 需要任务号，用 belfry inbox 查".to_string())?,
        timeout,
    })
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

struct Session {
    endpoint: String,
    tab_id: String,
    token: String,
}

impl Session {
    fn from_env() -> Result<Self, String> {
        // 三个变量是一起注入的，缺任何一个都说明这不是 Belfry 开的 Agent 会话。
        let missing = || {
            "这里不是 Belfry 的 Agent 会话（缺少身份信息），belfry 命令只在那里面能用".to_string()
        };
        Ok(Self {
            endpoint: std::env::var(ENV_ENDPOINT)
                .map_err(|_| "Belfry 的协作服务没有启动，这个会话没法和别的会话通信".to_string())?,
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

/// 任务状态说成人话。认不出的原样给出去——不猜，也不假装它已经完成了。
fn describe_state(state: &str) -> &str {
    match state {
        "pendingapproval" => "还等用户点头，没送出去",
        "queued" => "已排队，等对方空闲",
        "dispatched" => "已送到对方终端，它还没交差",
        "done" => "已完成",
        "failed" => "对方说做不了",
        "abandoned" => "已作废（对方会话没了或被中止）",
        other => other,
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
                    // 名字排在最前：那是派活时要写的东西。没名字的会话不能被寻址，
                    // 直说该怎么办，别让 Agent 拿标题去试——标题每敲一条 prompt 就变。
                    let handle = peer.name.as_deref().unwrap_or("(未命名)");
                    let state = if peer.is_self {
                        "（我自己）".to_string()
                    } else if peer.name.is_none() {
                        "要派活得先在侧栏给它起个名字".to_string()
                    } else if peer.can_receive {
                        format!("{} · 可以派活", peer.activity)
                    } else {
                        format!("{} · 现在收不了", peer.activity)
                    };
                    format!("{mark}{handle}  {}  {state}  — {}", peer.agent, peer.title)
                })
                .collect::<Vec<_>>()
                .join("\n")
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
        ResponseData::TaskState {
            task,
            state,
            result,
            ..
        } => {
            let line = format!("任务 {task} {}", describe_state(&state));
            match result {
                Some(text) => format!("{line}：{text}"),
                None => line,
            }
        }
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

    /// 大多数测试只关心解析出哪条命令；`wait` 那条单独验。
    fn parsed(args: &[String]) -> Result<Command, String> {
        match parse(args)? {
            Action::Once(command) => Ok(command),
            Action::Wait { .. } => panic!("这条不该解析成等待动作"),
        }
    }

    #[test]
    fn peers_needs_no_arguments() {
        assert!(matches!(parsed(&["peers".into()]), Ok(Command::Peers)));
        // 多给参数说明用法理解错了，早点说清比默默忽略强。
        assert!(parsed(&["peers".into(), "多余".into()]).is_err());
    }

    #[test]
    fn wait_takes_a_task_and_an_optional_timeout() {
        match parse(&["wait".into(), "01abcdef".into()]) {
            Ok(Action::Wait { task, timeout }) => {
                assert_eq!(task, "01abcdef");
                // 不给上限就一直等：给个默认上限反而会让 Agent 把「等超时了」
                // 读成「可以往下走了」。
                assert_eq!(timeout, None);
            }
            other => panic!("解析结果不对：{other:?}"),
        }
        match parse(&[
            "wait".into(),
            "01abcdef".into(),
            "--timeout".into(),
            "90".into(),
        ]) {
            Ok(Action::Wait { timeout, .. }) => {
                assert_eq!(timeout, Some(Duration::from_secs(90)))
            }
            other => panic!("解析结果不对：{other:?}"),
        }
    }

    #[test]
    fn wait_rejects_input_it_cannot_act_on() {
        // 没任务号就没得等。
        assert!(parse(&["wait".into()]).is_err());
        // --timeout 后面得跟数字，缺了或写成别的都要当场说，别默默用默认值等半小时。
        assert!(parse(&["wait".into(), "a".into(), "--timeout".into()]).is_err());
        assert!(parse(&["wait".into(), "a".into(), "--timeout".into(), "x".into()]).is_err());
        assert!(parse(&["wait".into(), "a".into(), "--timeout".into(), "0".into()]).is_err());
        // 一次只等一条：多给一个任务号说明理解错了。
        assert!(parse(&["wait".into(), "a".into(), "b".into()]).is_err());
    }

    #[test]
    fn polling_backs_off_once_the_wait_gets_long() {
        // 刚派出去的活可能几秒就结，前 30 秒跟紧；一个跑一小时的活每秒问一次纯属浪费。
        assert_eq!(poll_interval(Duration::ZERO), Duration::from_secs(1));
        assert_eq!(
            poll_interval(Duration::from_secs(29)),
            Duration::from_secs(1)
        );
        assert_eq!(
            poll_interval(Duration::from_secs(30)),
            Duration::from_secs(5)
        );
        assert_eq!(
            poll_interval(Duration::from_secs(3_600)),
            Duration::from_secs(5)
        );
    }

    #[test]
    fn an_unknown_state_is_shown_as_is() {
        // app 侧加了新状态而 CLI 还没跟上时，原样显示，不猜、也不假装它完成了。
        assert_eq!(describe_state("something-new"), "something-new");
        assert!(describe_state("dispatched").contains("还没交差"));
        assert_eq!(describe_state("done"), "已完成");
    }

    #[test]
    fn an_unknown_command_shows_usage() {
        let err = parsed(&["派活".into()]).unwrap_err();
        assert!(err.contains("belfry peers"), "{err}");
    }

    #[test]
    fn no_arguments_shows_usage() {
        assert!(parsed(&[]).unwrap_err().contains("belfry peers"));
    }

    #[test]
    fn peers_render_marks_self_and_readiness() {
        let text = render(ResponseData::Peers {
            peers: vec![
                belfry_protocol::Peer {
                    tab_id: "t1".into(),
                    name: Some("planner".into()),
                    title: "我".into(),
                    agent: "claude".into(),
                    can_receive: true,
                    activity: "idle".into(),
                    is_self: true,
                },
                belfry_protocol::Peer {
                    tab_id: "t2".into(),
                    name: Some("reviewer".into()),
                    title: "忙着".into(),
                    agent: "codex".into(),
                    can_receive: false,
                    activity: "talking".into(),
                    is_self: false,
                },
                belfry_protocol::Peer {
                    tab_id: "t3".into(),
                    name: None,
                    title: "还没起名".into(),
                    agent: "claude".into(),
                    can_receive: true,
                    activity: "idle".into(),
                    is_self: false,
                },
            ],
        });
        assert!(text.contains("* planner"), "自己那条要标出来：{text}");
        assert!(text.contains("收不了"), "{text}");
        // 没名字的会话不能被寻址，输出要直接说该干什么，
        // 而不是让 Agent 拿标题去试——标题每敲一条 prompt 就变。
        assert!(text.contains("(未命名)"), "{text}");
        assert!(text.contains("起个名字"), "{text}");
    }

    #[test]
    fn an_empty_roster_says_so_instead_of_printing_nothing() {
        // 空输出会被 Agent 当成命令失败，得给一句明确的话。
        assert!(!render(ResponseData::Peers { peers: vec![] }).is_empty());
    }

    #[test]
    fn send_takes_target_then_instruction() {
        match parsed(&[
            "send".into(),
            "reviewer".into(),
            "审".into(),
            "一下队列".into(),
        ]) {
            Ok(Command::Send {
                to,
                instruction,
                parent_task,
            }) => {
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
        match parsed(&[
            "send".into(),
            "reviewer".into(),
            "--parent".into(),
            "01ABCDEF".into(),
            "接着".into(),
            "干".into(),
        ]) {
            Ok(Command::Send {
                to,
                instruction,
                parent_task,
            }) => {
                assert_eq!(to, "reviewer");
                assert_eq!(instruction, "接着 干");
                assert_eq!(parent_task.as_deref(), Some("01ABCDEF"));
            }
            other => panic!("解析结果不对：{other:?}"),
        }
    }

    #[test]
    fn send_without_an_instruction_is_rejected() {
        assert!(parsed(&["send".into(), "reviewer".into()]).is_err());
        let err = parsed(&["send".into()]).unwrap_err();
        assert!(err.contains("belfry peers"), "要告诉它去哪找目标：{err}");
    }

    #[test]
    fn a_dangling_parent_flag_is_rejected() {
        assert!(parsed(&["send".into(), "r".into(), "干活".into(), "--parent".into()]).is_err());
    }

    #[test]
    fn done_can_carry_a_result_or_not() {
        match parsed(&["done".into(), "01ABCDEF".into()]) {
            Ok(Command::Done { task, result }) => {
                assert_eq!(task, "01ABCDEF");
                assert!(result.is_none());
            }
            other => panic!("{other:?}"),
        }
        match parsed(&[
            "done".into(),
            "01ABCDEF".into(),
            "写在".into(),
            "out.md".into(),
        ]) {
            Ok(Command::Done { result, .. }) => assert_eq!(result.as_deref(), Some("写在 out.md")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn fail_requires_a_reason() {
        // 派活那边只能看到这句话，空着等于什么都没说。
        assert!(parsed(&["fail".into(), "01ABCDEF".into()]).is_err());
        assert!(parsed(&["fail".into(), "01ABCDEF".into(), "跑不动".into()]).is_ok());
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
        assert!(
            text.contains("01ABCDEF") && text.contains("审一下队列回滚"),
            "{text}"
        );
    }
}
