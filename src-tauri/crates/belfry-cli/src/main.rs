//! `belfry` —— 从 Agent 会话里连回桌面端的控制命令。
//!
//! 这个二进制刻意做得很薄：解析参数、连上端点、发一行 JSON、把响应打成人话。
//! 所有判断都留在 app 侧，因为 CLI 是随安装包分发的，改它要发版；app 侧的
//! 逻辑可以跟着应用一起迭代。
//!
//! 输出面向的是 Agent，不是人：它读到的是终端文本，所以失败要说人话、
//! 说清下一步做什么，而不是抛一个错误码让它自己猜。

mod transport;
mod inbox;
use transport::{Transport, IPC_TIMEOUT, MAX_RESPONSE_BYTES};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use belfry_protocol::{
    CAPABILITY_ROOMS_V1, Command, ENV_ENDPOINT, ENV_TAB_ID, ENV_TOKEN, Request, Response,
    ResponseData, RoomTaskOp, room_compat,
};

fn main() -> ExitCode {
    let invoked_at = Instant::now();
    belfry_i18n::initialize_cli();
    if belfry_protocol::hooks::run_if_requested() {
        return ExitCode::SUCCESS;
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args, invoked_at) {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{}", belfry_i18n::localize(&message));
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

fn run(args: &[String], invoked_at: Instant) -> Result<String, String> {
    if args.is_empty() || args.first().is_some_and(|arg| matches!(arg.as_str(), "help" | "--help" | "-h")) {
        return Ok(format!("{}{}", usage(), inbox::HELP));
    }
    let action = parse(args)?;
    let session = Session::from_env()?;
    match action {
        Action::Once(command) => {
            let room_command = command.is_room();
            match session.send(command).map_err(|message| explain_room_error(room_command, message))? {
                Response::Ok { data } => Ok(render(data)),
                Response::Error { message } => Err(explain_room_error(room_command, message)),
            }
        }
        Action::Wait { task, timeout } => wait_for(&session, &task, timeout, invoked_at),
    }
}

fn explain_room_error(room_command: bool, message: String) -> String {
    if room_command && (message.contains("协作房间协议不兼容") || message.contains("Incompatible room protocol")) {
        let message = belfry_i18n::localize(&message);
        return belfry_i18n::lformat!("{message}\n不要改用 belfry send 派房间任务，它不会写入房间任务板。恢复后先运行 belfry room status 核对，再拆解并创建任务。");
    }
    if room_command && ["协作请求格式无效", "应用协作响应无效", "协作协议版本不匹配", "回应看不懂", "Invalid collaboration request", "Invalid application collaboration response", "Collaboration protocol version mismatch", "Invalid response"]
        .iter().any(|hint| message.contains(hint))
    {
        let message = belfry_i18n::localize(&message);
        belfry_i18n::lformat!("{message}\n房间命令与当前应用或常驻后台的协议不兼容。请向用户报告原始错误；更新并重新打开 Belfry 应用后先用 belfry room status 核对，终端后台无需重启。\n\
不要改用 belfry send 派房间任务，它不会写入房间任务板。响应失败时写入结果可能未知，先核对任务板，不要自动重复创建任务。")
    } else {
        belfry_i18n::localize(&message)
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
fn wait_for(session: &Session, task: &str, timeout: Option<Duration>, started: Instant) -> Result<String, String> {
    let deadline = timeout.and_then(|value| started.checked_add(value));
    let mut latest = belfry_i18n::text("尚未收到任务状态，任务未完成确认。").to_string();
    loop {
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            return Err(belfry_i18n::lformat!("等了 {} 秒它还没结。{latest}\n要接着等就再敲一次 belfry wait。", started.elapsed().as_secs()));
        }
        let request_deadline = deadline.unwrap_or_else(|| Instant::now() + IPC_TIMEOUT).min(Instant::now() + IPC_TIMEOUT);
        let data = match session.send_until(Command::TaskState {
            task: task.to_string(),
        }, request_deadline).map_err(|error| belfry_i18n::lformat!("任务未完成确认。{latest}\n{error}"))? {
            Response::Ok { data } => data,
            Response::Error { message } => return Err(message),
        };
        if matches!(&data, ResponseData::TaskState { settled: true, .. }) {
            return Ok(render(data));
        }
        latest = render(data.clone());
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            // 超时不等于完成：如实说还没结，并把当前状态一起给出去，
            // 让 Agent 自己决定是接着等、还是去问用户。
            return Err(belfry_i18n::lformat!(
                "等了 {} 秒它还没结。{}\n要接着等就再敲一次 belfry wait（不加 --timeout 就一直等）。",
                started.elapsed().as_secs(),
                render(data)
            ));
        }
        let interval = poll_interval(started.elapsed());
        std::thread::sleep(deadline.map(|deadline| interval.min(deadline.saturating_duration_since(Instant::now()))).unwrap_or(interval));
    }
}

const USAGE: &str = "\
belfry —— Belfry 会话之间的协作命令

  belfry peers                     看看现在还有哪些会话，各自在忙什么
  belfry rooms                     我在的协作房间：我的角色、统筹是谁、还有几条活没完
  belfry room status               房间全貌：需求简报、成员与职责、任务板、等我回复的消息
  belfry room say <内容> [--to <角色>] [--ask] [--reply <消息id>]
                                   发消息。不写 --to 时看正文里的 @角色；都没有就发给统筹
                                   （统筹发的给全体）。--to 也接受 @全体 @成员 @统筹 @用户。
                                   --ask 要求回复，--reply 回复某条（默认回给原发件人）
  belfry room log [--count <条数>]  读房间最近的对话
  belfry room task add <标题> [--to <角色>] [--outcome <完成标准>] [--after T1,T2]
  belfry room task start|done|reopen|archive <任务号> [结果]
  belfry room task assign <任务号> <角色>      统筹换人；成员只能认领没人负责的给自己
  belfry room task note <任务号> <进展>
  belfry room brief [--objective <目标>] [--focus <当前重点>] [--constraint <约束>]…   统筹改需求简报
  所有 room 命令都能加 --room <房间名>（同时在多间房里时必须写）
  belfry send <目标> <指令>         请另一条会话做点什么
  belfry inbox                     派给我、还没结的任务
  belfry done <任务号> [结果]       我做完了（唯一可信的完成信号）
  belfry fail <任务号> <原因>       我做不了
  belfry wait <任务号>             盯着它，等对方交差再往下走（一直等；--timeout <秒> 设上限）

目标写会话的名字（在侧栏起的，如 reviewer），也接受 tabId。
不认标题片段和 agent 类型：标题会随对话变，同类会话又可能有好几条。
在别人派的任务里再派活时，加 --parent <任务号>，这样转包层数和环才算得准。

只在 Belfry 托管的 Agent 会话里可用。";

const USAGE_EN: &str = "\
belfry -- Collaboration commands for Belfry sessions

  belfry peers                     List sessions and their availability
  belfry rooms                     List your rooms, role, coordinator, and open work
  belfry room status               Show the brief, members, task board, and pending replies
  belfry room say <text> [--to <role>] [--ask] [--reply <message-id>]
                                   Without --to, use @mentions or send to the coordinator;
                                   coordinator messages default to all members.
                                   Selectors: @all, @members, @coordinator, @user.
                                   --ask keeps a reply request open; --reply replies to a message.
  belfry room log [--count <n>]     Read recent room messages
  belfry room task add <title> [--to <role>] [--outcome <criteria>] [--after T1,T2]
  belfry room task start|done|reopen|archive <task-id> [result]
  belfry room task assign <task-id> <role>   Coordinator assigns; members may claim unassigned work
  belfry room task note <task-id> <progress>
  belfry room brief [--objective <goal>] [--focus <focus>] [--constraint <constraint>]...
                                   Coordinator updates the room brief
  Every room command accepts --room <name>; required when you belong to multiple rooms.
  belfry send <target> <instruction>  Ask another session to do work
  belfry inbox                     List work assigned to you
  belfry done <task-id> [result]    Report completion (the authoritative completion signal)
  belfry fail <task-id> <reason>    Report that you cannot complete the task
  belfry wait <task-id>             Wait for completion; --timeout <seconds> sets an optional limit

Address a session by its sidebar name (for example reviewer) or tabId.
Titles and agent types are not addresses. When delegating assigned work, include --parent <task-id>.
An accepted or queued task has not necessarily reached the terminal or started running.
BELFRY_LANG=en|zh-CN overrides the app language; otherwise the app setting or system language is used.
Commands other than help require an Agent session hosted by Belfry.";

fn usage() -> &'static str {
    if belfry_i18n::current() == belfry_i18n::Locale::En { USAGE_EN } else { USAGE }
}

fn parse(args: &[String]) -> Result<Action, String> {
    let head = args.first().map(String::as_str);
    let once = |command| Ok(Action::Once(command));
    match (head, args.len()) {
        (Some("peers"), 1) => once(Command::Peers),
        (Some("rooms"), 1) => once(Command::Rooms),
        (Some("room"), _) => parse_room(&args[1..]).and_then(once),
        (Some("inbox"), 1) => once(Command::Inbox),
        (Some("inbox"), _) => inbox::parse(&args[1..]).and_then(once),
        (Some("send"), _) => parse_send(&args[1..]).and_then(once),
        (Some("done"), _) => parse_done(&args[1..]).and_then(once),
        (Some("fail"), _) => parse_fail(&args[1..]).and_then(once),
        (Some("wait"), _) => parse_wait(&args[1..]),
        (Some("help") | Some("--help") | Some("-h"), _) | (None, _) => Err(usage().to_string()),
        (Some(other), _) => Err(if belfry_i18n::current() == belfry_i18n::Locale::En {
            format!("Unknown command `{other}`.\n\n{}", usage())
        } else { format!("不认识的命令 `{other}`。\n\n{USAGE}") }),
    }
}

/// 把参数拆成「带值的标志」和位置参数。`valued` 是要吃一个值的标志，`switches` 是开关。
/// 同一个带值标志可以写多次（`--to 前端 --to 后端`）。
struct Flags {
    values: Vec<(String, String)>,
    switches: Vec<String>,
    positional: Vec<String>,
}

impl Flags {
    fn parse(args: &[String], valued: &[&str], switches: &[&str]) -> Result<Self, String> {
        let mut flags = Flags { values: Vec::new(), switches: Vec::new(), positional: Vec::new() };
        let mut rest = args.iter();
        while let Some(arg) = rest.next() {
            if valued.contains(&arg.as_str()) {
                let value = rest.next().filter(|value| !value.trim().is_empty());
                let value = value.ok_or_else(|| belfry_i18n::lformat!("{arg} 后面要跟一个值"))?;
                flags.values.push((arg.clone(), value.clone()));
            } else if switches.contains(&arg.as_str()) {
                flags.switches.push(arg.clone());
            } else if arg.starts_with("--") {
                return Err(belfry_i18n::lformat!("不认识的参数 `{arg}`，用 belfry help 看看"));
            } else {
                flags.positional.push(arg.clone());
            }
        }
        Ok(flags)
    }

    fn one(&self, name: &str) -> Option<String> {
        self.values.iter().rev().find(|(key, _)| key == name).map(|(_, value)| value.clone())
    }

    fn all(&self, name: &str) -> Vec<String> {
        self.values.iter().filter(|(key, _)| key == name).map(|(_, value)| value.clone()).collect()
    }

    fn has(&self, name: &str) -> bool {
        self.switches.iter().any(|switch| switch == name)
    }

    /// 位置参数拼回一句话：Agent 不加引号写成多个词也照样认。
    fn text(&self, from: usize) -> String {
        self.positional.get(from..).unwrap_or_default().join(" ")
    }
}

/// `belfry room <子命令>` 的分派。
fn parse_room(args: &[String]) -> Result<Command, String> {
    let rest = args.get(1..).unwrap_or_default();
    match args.first().map(String::as_str) {
        Some("status") => {
            let flags = Flags::parse(rest, &["--room"], &[])?;
            Ok(Command::RoomStatus { room: flags.one("--room") })
        }
        Some("say") => parse_room_say(rest),
        Some("log") => {
            let flags = Flags::parse(rest, &["--room", "--count"], &[])?;
            let count = match flags.one("--count") {
                None => None,
                Some(raw) => Some(raw.parse::<u32>().map_err(|_| belfry_i18n::lformat!("--count 要是条数，收到的是 `{raw}`"))?),
            };
            Ok(Command::RoomLog { room: flags.one("--room"), count })
        }
        Some("task") => parse_room_task(rest),
        Some("brief") => {
            let flags = Flags::parse(rest, &["--room", "--objective", "--focus", "--constraint"], &["--clear-constraints"])?;
            let constraints = flags.all("--constraint");
            let constraints = if flags.has("--clear-constraints") {
                Some(Vec::new())
            } else {
                (!constraints.is_empty()).then_some(constraints)
            };
            Ok(Command::RoomBrief {
                room: flags.one("--room"),
                objective: flags.one("--objective"),
                focus: flags.one("--focus"),
                constraints,
            })
        }
        _ => Err(belfry_i18n::lformat!("belfry room 后面要写 status、say、log、task 或 brief。\n\n{}", usage())),
    }
}

/// `belfry room say <内容…> [--to <角色>]… [--ask] [--reply <消息id>] [--room <房间>]`
fn parse_room_say(args: &[String]) -> Result<Command, String> {
    let flags = Flags::parse(args, &["--room", "--to", "--reply", "--topic", "--question", "--answer", "--class", "--correction-of", "--op"], &["--ask"])?;
    let text = flags.text(0);
    if text.trim().is_empty() {
        return Err(belfry_i18n::text("belfry room say 要说点什么，比如：belfry room say @后端 接口定了吗").to_string());
    }
    let class = flags.one("--class").map(|value| match value.as_str() {
        "discussion" => Ok(belfry_protocol::inbox::MessageClass::Discussion), "reply" => Ok(belfry_protocol::inbox::MessageClass::Reply),
        "fyi" => Ok(belfry_protocol::inbox::MessageClass::Fyi), _ => Err("--class must be discussion, reply or fyi".to_string()),
    }).transpose()?;
    let options = belfry_protocol::inbox::MessageOptions { topic_id: flags.one("--topic"), questions: flags.all("--question"), answers: flags.all("--answer"),
        class, correction_of: flags.one("--correction-of"), operation_id: flags.one("--op") };
    let inbox = (options != Default::default()).then_some(options);
    Ok(Command::RoomSay {
        inbox,
        room: flags.one("--room"),
        text,
        reply_to: flags.one("--reply"),
        to: flags.all("--to"),
        ask: flags.has("--ask"),
    })
}

/// `belfry room task <动作> …`
fn parse_room_task(args: &[String]) -> Result<Command, String> {
    let action = args.first().map(String::as_str);
    let flags = Flags::parse(args.get(1..).unwrap_or_default(), &["--room", "--to", "--outcome", "--after", "--generation"], &[])?;
    let task = || {
        flags
            .positional
            .first()
            .cloned()
            .ok_or_else(|| belfry_i18n::text("要写任务号（比如 T1），用 belfry room status 看任务板").to_string())
    };
    let op = match action {
        Some("add") => {
            let title = flags.text(0);
            if title.trim().is_empty() {
                return Err(belfry_i18n::text("belfry room task add 要写任务标题").to_string());
            }
            let after = flags
                .all("--after")
                .iter()
                .flat_map(|raw| raw.split([',', '，', ' ']))
                .filter(|id| !id.trim().is_empty())
                .map(|id| id.trim().to_string())
                .collect();
            RoomTaskOp::Add { title, outcome: flags.one("--outcome"), assignee: flags.one("--to"), after }
        }
        Some("assign") => {
            let assignee = flags
                .positional
                .get(1)
                .cloned()
                .or_else(|| flags.one("--to"))
                .ok_or(belfry_i18n::text("belfry room task assign 要写交给谁：belfry room task assign T1 前端"))?;
            RoomTaskOp::Assign { task: task()?, assignee }
        }
        Some("start") => RoomTaskOp::Start { task: task()? },
        Some("done") => {
            let result = flags.text(1);
            RoomTaskOp::Done { generation: flags.one("--generation").map(|value| value.parse::<u64>().map_err(|_| "--generation must be an unsigned integer".to_string())).transpose()?, task: task()?, result: (!result.trim().is_empty()).then_some(result) }
        }
        Some("reopen") => RoomTaskOp::Reopen { task: task()? },
        Some("archive") => RoomTaskOp::Archive { task: task()? },
        Some("note") => {
            let text = flags.text(1);
            if text.trim().is_empty() {
                return Err(belfry_i18n::text("belfry room task note 要写进展：belfry room task note T1 接口已联调").to_string());
            }
            RoomTaskOp::Note { task: task()?, text }
        }
        _ => return Err(belfry_i18n::text("belfry room task 后面要写 add、start、done、assign、note、reopen 或 archive").to_string()),
    };
    Ok(Command::RoomTask { room: flags.one("--room"), op })
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
                .ok_or_else(|| belfry_i18n::text("--timeout 后面要跟秒数").to_string())?;
            let secs: u64 = raw
                .parse()
                .map_err(|_| belfry_i18n::lformat!("--timeout 要是秒数，收到的是 `{raw}`"))?;
            if secs == 0 {
                return Err(belfry_i18n::text("--timeout 至少 1 秒").to_string());
            }
            timeout = Some(Duration::from_secs(secs));
        } else if task.is_none() {
            task = Some(arg.clone());
        } else {
            return Err(belfry_i18n::lformat!("belfry wait 只等一条任务，多出来的是 `{arg}`"));
        }
    }
    Ok(Action::Wait {
        task: task.ok_or_else(|| belfry_i18n::text("belfry wait 需要任务号，用 belfry inbox 查").to_string())?,
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
                    .ok_or_else(|| belfry_i18n::text("--parent 后面要跟任务号").to_string())?
                    .clone(),
            );
        } else {
            positional.push(arg.clone());
        }
    }
    let to = positional
        .first()
        .ok_or_else(|| belfry_i18n::text("belfry send 需要一个目标，用 belfry peers 看看有谁").to_string())?;
    if positional.len() < 2 {
        return Err(belfry_i18n::text("belfry send 需要一条指令").to_string());
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
        .ok_or_else(|| belfry_i18n::text("belfry done 需要任务号，用 belfry inbox 查").to_string())?;
    Ok(Command::Done {
        task: task.clone(),
        result: (args.len() > 1).then(|| args[1..].join(" ")),
    })
}

fn parse_fail(args: &[String]) -> Result<Command, String> {
    let task = args
        .first()
        .ok_or_else(|| belfry_i18n::text("belfry fail 需要任务号，用 belfry inbox 查").to_string())?;
    if args.len() < 2 {
        return Err(belfry_i18n::text("belfry fail 要说明原因：派活那边只能看到你写的这句").to_string());
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
            belfry_i18n::text("这里不是 Belfry 的 Agent 会话（缺少身份信息），belfry 命令只在那里面能用").to_string()
        };
        Ok(Self {
            endpoint: std::env::var(ENV_ENDPOINT)
                .map_err(|_| belfry_i18n::text("Belfry 的协作服务没有启动，这个会话没法和别的会话通信").to_string())?,
            tab_id: std::env::var(ENV_TAB_ID).map_err(|_| missing())?,
            token: std::env::var(ENV_TOKEN).map_err(|_| missing())?,
        })
    }

    fn send(&self, command: Command) -> Result<Response, String> {
        self.send_until(command, Instant::now() + IPC_TIMEOUT)
    }

    fn send_until(&self, command: Command, deadline: Instant) -> Result<Response, String> {
        // wait 只能查询真实任务号；内部传输外壳由本进程通过 exchange 发送。
        if room_compat::unwrap_command(&command).is_some() {
            return Err(belfry_i18n::text("任务编号无效：房间操作请使用 belfry room 命令").into());
        }
        if command.requires_inbox() {
            // Always use the opaque envelope: an older daemon may advertise room support but strip new fields.
            let probe = self.exchange(room_compat::wrap_command(&Command::Peers)?, deadline).and_then(room_compat::unwrap_response)?;
            match probe {
                Response::Ok { data: ResponseData::Peers { capabilities, .. } } if capabilities.iter().any(|value| value == belfry_protocol::inbox::CAPABILITY) => {},
                _ => return Err("Application does not support collaboration-inbox-v1; no inbox operation was sent".into()),
            }
            return room_compat::unwrap_response(self.exchange(room_compat::wrap_command(&command)?, deadline)?);
        }
        if command.is_room() {
            // 必须在写操作之前检查。旧后台可能已经转发 room say，却丢掉回执字段；
            // 收到解析错误后重试会重复发消息。peers 是旧后台也能处理的只读探针。
            match self.exchange(Command::Peers, deadline)? {
                Response::Ok {
                    data: ResponseData::Peers { capabilities, .. },
                } if capabilities.iter().any(|value| value == CAPABILITY_ROOMS_V1) => {}
                Response::Error { message } => return Err(message),
                _ => return self.send_compatible_room(command, deadline),
            }
        }
        self.exchange(command, deadline)
    }

    fn send_compatible_room(&self, command: Command, deadline: Instant) -> Result<Response, String> {
        // 缺少能力标记也可能只是旧后台把字段丢了。先走 v1 字符串外壳做只读
        // 探测；旧应用只会报「找不到任务」，不会执行任何房间写操作。
        let incompatible = |message: String| belfry_i18n::lformat!(
            "协作房间协议不兼容：当前应用未能确认房间兼容通道，本次房间操作未发送。\n\
             {message}\n请更新并重新打开 Belfry 应用后重试，现有终端后台无需重启。"
        );
        let probe = room_compat::wrap_command(&Command::Peers)?;
        let response = self.exchange(probe, deadline)
            .and_then(room_compat::unwrap_response)
            .map_err(incompatible)?;
        match response {
            Response::Ok { data: ResponseData::Peers { capabilities, .. } }
                if capabilities.iter().any(|value| value == CAPABILITY_ROOMS_V1) => {}
            Response::Error { message } => return Err(incompatible(message)),
            _ => return Err(incompatible(belfry_i18n::text("应用未声明房间协议能力").into())),
        }
        // 探测成功后只发送一次。写入后的回执异常不再换通道或重试。
        let wrapped = room_compat::wrap_command(&command)?;
        room_compat::unwrap_response(self.exchange(wrapped, deadline)?)
    }

    fn exchange(&self, command: Command, deadline: Instant) -> Result<Response, String> {
        let request = Request::new(self.tab_id.clone(), self.token.clone(), command);
        let mut line =
            serde_json::to_string(&request).map_err(|err| belfry_i18n::lformat!("请求序列化失败：{err}"))?;
        line.push('\n');

        if line.len() as u64 > MAX_RESPONSE_BYTES { return Err(belfry_i18n::text("请求超过 1 MiB 上限").into()); }
        let mut stream = Transport::connect(&self.endpoint, deadline).map_err(|error| belfry_i18n::lformat!("连不上 Belfry：{error}"))?;
        stream
            .write_all(line.as_bytes())
            .and_then(|()| stream.flush())
            .map_err(|err| belfry_i18n::lformat!("发不出去：{err}"))?;

        let mut reply = String::new();
        BufReader::new(stream.take(MAX_RESPONSE_BYTES + 1))
            .read_line(&mut reply)
            .map_err(|err| belfry_i18n::lformat!("没收到回应：{err}"))?;
        if reply.len() as u64 > MAX_RESPONSE_BYTES { return Err(belfry_i18n::text("回应超过 1 MiB 上限").into()); }
        if !reply.ends_with('\n') { return Err(belfry_i18n::text("回应不完整，结果未知；请先查询状态，勿自动重复写入").into()); }
        serde_json::from_str(&reply).map_err(|err| belfry_i18n::lformat!("回应看不懂：{err}"))
    }
}

/// 任务状态说成人话。认不出的原样给出去——不猜，也不假装它已经完成了。
fn describe_state(state: &str) -> &str {
    match state {
        "pendingapproval" => belfry_i18n::text("还等用户点头，没送出去"),
        "accepted" => belfry_i18n::text("已受理，尚未进入终端投递队列"),
        "queued" => belfry_i18n::text("已排队，等对方空闲"),
        "submitting" => belfry_i18n::text("正在提交到终端，尚未收到提交回执"),
        "uncertain" => belfry_i18n::text("提交结果不确定，请核对目标终端；未自动重复投递"),
        "cancelled" => belfry_i18n::text("投递已取消"),
        "dispatched" => belfry_i18n::text("已送到对方终端，它还没交差"),
        "done" => belfry_i18n::text("已完成"),
        "failed" => belfry_i18n::text("对方说做不了"),
        "abandoned" => belfry_i18n::text("已作废（对方会话没了或被中止）"),
        other => other,
    }
}

fn render_line(entry: &belfry_protocol::RoomLine) -> String {
    let to = if entry.to.is_empty() { String::new() } else { format!(" → {}", entry.to.join("、")) };
    let mut line = format!("[{}] {}{to}：{}", entry.id, entry.author, entry.text);
    if let Some(preview) = &entry.reply_preview {
        line.push_str(&format!("（{preview}）"));
    }
    if entry.needs_my_reply {
        line.push_str(belfry_i18n::text("  ← 等你回复"));
    }
    line
}

fn render_task(task: &belfry_protocol::RoomTaskLine) -> String {
    let owner = task.assignee.as_deref().unwrap_or(belfry_i18n::text("没人负责"));
    let mut line = format!("{} [{}] {}（{owner}）", task.id, belfry_i18n::text(&task.status), task.title);
    if !task.waiting_for.is_empty() {
        line.push_str(&belfry_i18n::lformat!(" 等 {} 完成", task.waiting_for.join("、")));
    }
    if !task.outcome.is_empty() {
        line.push_str(&belfry_i18n::lformat!("\n    完成标准：{}", task.outcome));
    }
    if let Some(result) = &task.result {
        line.push_str(&belfry_i18n::lformat!("\n    结果：{result}"));
    }
    if let Some(last) = task.notes.lines().last() {
        line.push_str(&belfry_i18n::lformat!("\n    最近进展：{last}"));
    }
    line
}

fn render_brief(brief: &belfry_protocol::RoomBriefView) -> String {
    let or_blank = |value: &str| if value.is_empty() { belfry_i18n::text("（未写）").to_string() } else { value.to_string() };
    let mut lines = vec![belfry_i18n::lformat!("目标：{}", or_blank(&brief.objective)), belfry_i18n::lformat!("当前重点：{}", or_blank(&brief.focus))];
    if !brief.constraints.is_empty() {
        lines.push(belfry_i18n::lformat!("约束：{}", brief.constraints.join("；")));
    }
    lines.join("\n")
}

fn render_status(status: &belfry_protocol::RoomStatusView) -> String {
    let role = if status.i_am_foreman { belfry_i18n::text("统筹") } else { belfry_i18n::text("成员") };
    let mut lines = vec![belfry_i18n::lformat!("房间「{}」，我是{}「{}」", status.room, role, status.my_title), String::new()];
    lines.push(belfry_i18n::text("需求简报").to_string());
    lines.extend(render_brief(&status.brief).lines().map(|line| format!("  {line}")));
    lines.push(String::new());
    lines.push(belfry_i18n::text("成员").to_string());
    for member in &status.members {
        let me = if member.is_me { belfry_i18n::text("（我）") } else { "" };
        let duty = if member.duty.is_empty() { String::new() } else { format!(" — {}", member.duty) };
        lines.push(format!("  {}{me} [{}] {}{duty}", member.title, belfry_i18n::text(&member.role), member.activity));
    }
    lines.push(String::new());
    if status.tasks.is_empty() {
        lines.push(if status.i_am_foreman {
            belfry_i18n::text("任务板是空的。拆活：belfry room task add <标题> --to <角色>").to_string()
        } else {
            belfry_i18n::text("任务板是空的，等统筹派活。").to_string()
        });
    } else {
        lines.push(belfry_i18n::text("任务板").to_string());
        lines.extend(status.tasks.iter().map(|task| format!("  {}", render_task(task).replace('\n', "\n  "))));
    }
    if !status.awaiting_me.is_empty() {
        lines.push(String::new());
        lines.push(belfry_i18n::text("等你回复（belfry room say --reply <id> <话>）").to_string());
        lines.extend(status.awaiting_me.iter().map(|entry| format!("  {}", render_line(entry))));
    }
    lines.join("\n")
}

/// 渲染成给 Agent 读的文本。
///
/// 不输出 JSON：Agent 读的是终端，人话它一样解析得了，而且用户瞟一眼也能看懂。
fn render(data: ResponseData) -> String {
    match data {
        ResponseData::CollaborationInbox { result } => serde_json::to_string_pretty(&result).unwrap_or_else(|error| error.to_string()),
        ResponseData::Peers { peers, .. } => {
            if peers.is_empty() {
                return belfry_i18n::text("现在没有别的会话").to_string();
            }
            peers
                .iter()
                .map(|peer| {
                    let mark = if peer.is_self { "* " } else { "  " };
                    // 名字排在最前：那是派活时要写的东西。没名字的会话不能被寻址，
                    // 直说该怎么办，别让 Agent 拿标题去试——标题每敲一条 prompt 就变。
                    let handle = peer.name.as_deref().unwrap_or(belfry_i18n::text("(未命名)"));
                    let state = if peer.is_self {
                        belfry_i18n::text("（我自己）").to_string()
                    } else if peer.name.is_none() {
                        belfry_i18n::text("要派活得先在侧栏给它起个名字").to_string()
                    } else if peer.can_receive {
                        belfry_i18n::lformat!("{} · 可以派活", peer.activity)
                    } else {
                        belfry_i18n::lformat!("{} · 现在收不了", peer.activity)
                    };
                    format!("{mark}{handle}  {}  {state}  — {}", peer.agent, peer.title)
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        ResponseData::Rooms { rooms } => {
            if rooms.is_empty() {
                return belfry_i18n::text("你不在任何协作房间里。房间由用户在界面上搭好，把你拉进去之后才用得上 belfry room。").to_string();
            }
            rooms
                .iter()
                .map(|room| {
                    let role = if room.i_am_foreman { belfry_i18n::text("统筹") } else { belfry_i18n::text("成员") };
                    let mut lines = vec![belfry_i18n::lformat!("房间「{}」：我是{}「{}」", room.name, role, room.my_title)];
                    if !room.my_duty.is_empty() {
                        lines.push(belfry_i18n::lformat!("  职责：{}", room.my_duty));
                    }
                    if !room.i_am_foreman {
                        lines.push(belfry_i18n::lformat!("  统筹：{}", room.foreman.as_deref().unwrap_or(belfry_i18n::text("还没定"))));
                    }
                    if !room.objective.is_empty() {
                        lines.push(belfry_i18n::lformat!("  目标：{}", room.objective));
                    }
                    lines.push(belfry_i18n::lformat!("  没完成的任务 {} 条；等我回复的消息 {} 条", room.open_tasks, room.awaiting_me));
                    lines.join("\n")
                })
                .collect::<Vec<_>>()
                .join("\n\n")
                + belfry_i18n::text("\n\n全貌用 belfry room status。")
        }
        ResponseData::RoomStatus { status } => render_status(&status),
        ResponseData::RoomSaid { room, message, recipients, skipped, ask } => {
            let mut text = belfry_i18n::lformat!("已发到房间「{room}」[{message}]，收件人：{}。", recipients.join("、"));
            if ask {
                text.push_str(belfry_i18n::text("对方回复之前会一直挂着「等你回复」。"));
            }
            for reason in skipped {
                text.push('\n');
                text.push_str(&belfry_i18n::localize(&reason));
            }
            text
        }
        ResponseData::RoomLog { room, entries } => {
            if entries.is_empty() {
                return belfry_i18n::lformat!("房间「{room}」还没有消息。");
            }
            let mut lines = vec![belfry_i18n::lformat!("房间「{room}」最近的对话（回复某条：belfry room say --reply <id> <话>）：")];
            lines.extend(entries.iter().map(render_line));
            lines.join("\n")
        }
        ResponseData::RoomTaskChanged { room: _, task, note } => format!("{}\n{}", render_task(&task), belfry_i18n::localize(&note)),
        ResponseData::RoomBriefUpdated { room, brief } => {
            belfry_i18n::lformat!("房间「{room}」的需求简报已更新，成员都会收到通知。\n{}", render_brief(&brief))
        }
        ResponseData::Sent {
            task,
            to,
            pending_approval,
        } => {
            if pending_approval {
                // 说清「还没送到」，否则 Agent 会当成对方已经开工，接着去等结果。
                belfry_i18n::lformat!("任务 {task} 已提交给「{to}」，等用户确认后才会送达")
            } else {
                belfry_i18n::lformat!("任务 {task} 已受理，等待投递给「{to}」（目标空闲时自动提交；受理不等于已开始处理）")
            }
        }
        ResponseData::Settled { task } => belfry_i18n::lformat!("任务 {task} 已结"),
        ResponseData::TaskState {
            task,
            state,
            result,
            ..
        } => {
            let line = belfry_i18n::lformat!("任务 {task} {}", describe_state(&state));
            match result {
                Some(text) => format!("{line}：{text}"),
                None => line,
            }
        }
        ResponseData::Inbox { tasks } => {
            if tasks.is_empty() {
                return belfry_i18n::text("没有派给你的任务").to_string();
            }
            tasks
                .iter()
                .map(|task| {
                    belfry_i18n::lformat!(
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
    fn regression_cli_translates_status_but_preserves_user_results() {
        belfry_i18n::with_locale(belfry_i18n::Locale::En, || {
            let output = render(ResponseData::TaskState { task: "T1".into(), state: "uncertain".into(), result: Some("用户的原文".into()), settled: false });
            assert!(output.contains("uncertain"), "{output}");
            assert!(output.contains("用户的原文"));
            assert!(!output.contains("提交结果不确定"));
            assert_eq!(render(ResponseData::Inbox { tasks: vec![] }), "No tasks have been assigned to you.");
        });
    }

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
    fn incompatible_room_protocols_explain_the_empty_board_without_retrying() {
        for error in ["协作请求格式无效", "应用协作响应无效", "回应看不懂：missing field `message`"] {
            let explained = explain_room_error(true, error.into());
            assert!(explained.starts_with(error));
            assert!(explained.contains("belfry room status") && explained.contains("不会写入房间任务板"));
            assert!(explained.contains("不要自动重复创建任务"));
        }
        assert_eq!(explain_room_error(true, "房间里没有这个成员".into()), "房间里没有这个成员");
        assert_eq!(explain_room_error(false, "应用协作响应无效".into()), "应用协作响应无效");
        let unsent = explain_room_error(true, "协作房间协议不兼容，本次房间操作未发送".into());
        assert!(unsent.contains("本次房间操作未发送") && unsent.contains("不会写入房间任务板"));
        assert!(!unsent.contains("写入结果可能未知"));
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
            capabilities: vec![],
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
        assert!(!render(ResponseData::Peers { peers: vec![], capabilities: vec![] }).is_empty());
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

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| arg.to_string()).collect()
    }

    fn command(args: &[&str]) -> Command {
        match parse(&strings(args)) {
            Ok(Action::Once(command)) => command,
            Ok(_) => panic!("不是一次性命令"),
            Err(message) => panic!("{message}"),
        }
    }

    #[test]
    fn room_say_reads_recipients_ask_reply_and_room() {
        match command(&["room", "say", "--to", "后端", "--to", "@前端", "--ask", "接口", "定了吗", "--room", "登录"]) {
            Command::RoomSay { room, text, reply_to, to, ask, .. } => {
                assert_eq!(room.as_deref(), Some("登录"));
                assert_eq!(text, "接口 定了吗");
                assert_eq!(reply_to, None);
                assert_eq!(to, strings(&["后端", "@前端"]));
                assert!(ask);
            }
            other => panic!("{other:?}"),
        }
        match command(&["room", "say", "--reply", "abcd1234", "能"]) {
            Command::RoomSay { reply_to, ask, .. } => {
                assert_eq!(reply_to.as_deref(), Some("abcd1234"));
                assert!(!ask);
            }
            other => panic!("{other:?}"),
        }
        assert!(parse(&strings(&["room", "say"])).is_err());
        assert!(parse(&strings(&["room", "say", "--to"])).is_err(), "--to 后面要有值");
        assert!(parse(&strings(&["room", "say", "--loud", "x"])).is_err(), "不认识的参数要报出来");
    }

    #[test]
    fn room_task_add_reads_assignee_outcome_and_dependencies() {
        match command(&["room", "task", "add", "登录", "接口", "--to", "后端", "--outcome", "返回 token", "--after", "T1,t2"]) {
            Command::RoomTask { op: RoomTaskOp::Add { title, outcome, assignee, after }, .. } => {
                assert_eq!(title, "登录 接口");
                assert_eq!(outcome.as_deref(), Some("返回 token"));
                assert_eq!(assignee.as_deref(), Some("后端"));
                assert_eq!(after, strings(&["T1", "t2"]));
            }
            other => panic!("{other:?}"),
        }
        assert!(parse(&strings(&["room", "task", "add"])).is_err());
    }

    #[test]
    fn room_task_actions_take_a_task_number() {
        assert!(matches!(command(&["room", "task", "start", "T1"]), Command::RoomTask { op: RoomTaskOp::Start { .. }, .. }));
        match command(&["room", "task", "done", "T1", "已", "合并"]) {
            Command::RoomTask { op: RoomTaskOp::Done { task, result, .. }, .. } => {
                assert_eq!(task, "T1");
                assert_eq!(result.as_deref(), Some("已 合并"));
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            command(&["room", "task", "done", "T1"]),
            Command::RoomTask { op: RoomTaskOp::Done { result: None, .. }, .. }
        ));
        assert!(matches!(
            command(&["room", "task", "assign", "T1", "前端"]),
            Command::RoomTask { op: RoomTaskOp::Assign { .. }, .. }
        ));
        assert!(parse(&strings(&["room", "task", "start"])).is_err());
        assert!(parse(&strings(&["room", "task", "note", "T1"])).is_err());
        assert!(parse(&strings(&["room", "task", "fly", "T1"])).is_err());
    }

    #[test]
    fn room_brief_and_log_and_status_parse() {
        match command(&["room", "brief", "--focus", "先做手机号", "--constraint", "不动协议", "--constraint", "本周内"]) {
            Command::RoomBrief { objective, focus, constraints, .. } => {
                assert_eq!(objective, None);
                assert_eq!(focus.as_deref(), Some("先做手机号"));
                assert_eq!(constraints, Some(strings(&["不动协议", "本周内"])));
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(command(&["room", "log", "--count", "5"]), Command::RoomLog { count: Some(5), .. }));
        assert!(parse(&strings(&["room", "log", "--count", "很多"])).is_err());
        assert!(matches!(command(&["room", "status"]), Command::RoomStatus { room: None }));
        assert!(matches!(command(&["rooms"]), Command::Rooms));
        assert!(parse(&strings(&["room"])).is_err());
    }

    fn line(id: &str, author: &str, text: &str, needs: bool) -> belfry_protocol::RoomLine {
        belfry_protocol::RoomLine {
            id: id.into(),
            author: author.into(),
            to: vec!["后端".into()],
            text: text.into(),
            at: 0,
            reply_preview: None,
            needs_my_reply: needs,
        }
    }

    #[test]
    fn room_status_render_shows_brief_members_tasks_and_pending_replies() {
        let text = render(ResponseData::RoomStatus {
            status: belfry_protocol::RoomStatusView {
                room: "登录改版".into(),
                my_title: "后端".into(),
                i_am_foreman: false,
                brief: belfry_protocol::RoomBriefView {
                    objective: "做完登录页".into(),
                    focus: String::new(),
                    constraints: vec!["不动协议".into()],
                },
                members: vec![belfry_protocol::RoomMemberLine {
                    title: "后端".into(),
                    role: "成员".into(),
                    duty: "接口".into(),
                    is_me: true,
                    activity: "idle".into(),
                }],
                tasks: vec![belfry_protocol::RoomTaskLine {
                    id: "T2".into(),
                    title: "登录页".into(),
                    status: "待开工".into(),
                    assignee: Some("前端".into()),
                    outcome: "能登录".into(),
                    waiting_for: vec!["T1".into()],
                    notes: String::new(),
                    result: None,
                }],
                awaiting_me: vec![line("abcd1234", "统筹", "今天能好吗", true)],
            },
        });
        for needle in ["我是成员「后端」", "目标：做完登录页", "当前重点：（未写）", "约束：不动协议", "后端（我）", "T2 [待开工] 登录页（前端） 等 T1 完成", "完成标准：能登录", "等你回复", "[abcd1234] 统筹 → 后端：今天能好吗"] {
            assert!(text.contains(needle), "缺「{needle}」：\n{text}");
        }
    }

    #[test]
    fn room_log_and_said_render_read_like_a_conversation() {
        let text = render(ResponseData::RoomLog { room: "登录改版".into(), entries: vec![line("abcd1234", "统筹", "开工", false)] });
        assert!(text.contains("[abcd1234] 统筹 → 后端：开工") && !text.contains("等你回复"), "{text}");
        assert!(render(ResponseData::RoomLog { room: "登录改版".into(), entries: vec![] }).contains("还没有消息"));
        let said = render(ResponseData::RoomSaid {
            room: "登录改版".into(),
            message: "abcd1234".into(),
            recipients: vec!["统筹".into()],
            skipped: vec!["「测试」的会话已经不在了".into()],
            ask: true,
        });
        assert!(said.contains("[abcd1234]") && said.contains("统筹") && said.contains("等你回复") && said.contains("测试"), "{said}");
    }

    #[test]
    fn an_empty_rooms_list_says_so() {
        assert!(render(ResponseData::Rooms { rooms: vec![] }).contains("不在任何协作房间"));
    }
}
