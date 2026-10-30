//! 控制 CLI 的接入点。
//!
//! 传输按平台分两种，但只在 `bind` 这一处分支，上面的请求处理完全共享：
//!
//! - macOS / Linux：Unix domain socket，文件权限 0600 把访问面锁到本用户
//! - Windows：loopback TCP。没有等价的简单原语（named pipe 要手写 win32），
//!   本机其他进程能连上，但没有 token 做不了任何事
//!
//! 一来一回：读一行 JSON、答一行 JSON、关闭。不做长连接——CLI 的每次调用
//! 都是一次性的，多余的状态只会带来重连语义。

use std::io::{BufRead, BufReader, Write};
#[cfg(not(unix))]
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;

use belfry_protocol::{
    Command, InboxTask, PROTOCOL_VERSION, Request, Response, ResponseData, RoomBrief, RoomLine,
};

use super::identity::SessionIdentities;
use super::registry::SessionRegistry;
use super::task::{self, ApprovalMode, TargetInfo, TaskBoard, TaskRequest, TaskState, Verdict};

/// 单行请求的上限。够放一条派活指令，又不至于让一个坏客户端把内存吃光。
const MAX_REQUEST_BYTES: u64 = 1024 * 1024;

/// 房间层的只读视图。
///
/// 总线对房间的具体类型保持无知：它只问「这条会话在哪些房间里」。实现放在
/// rooms 层，依赖方向是 rooms → collab，总线不回头认识 rooms。
/// 投递的目标：房间里的一个成员（点名的，或群发的）。
#[derive(Clone, Debug)]
pub struct MentionTarget {
    pub member_id: String,
    pub tab_id: String,
    pub role: String,
}

/// 一次「往房间说话」的结果：消息落在哪间房，投给谁。
pub struct SayOutcome {
    pub room_id: String,
    pub room_name: String,
    pub sender_role: String,
    /// 是不是点名：true＝有人被点名（投递收窄到被点的人，口径「请你说」）。
    pub addressed: bool,
    pub recipients: Vec<MentionTarget>,
    /// 这次发言落到时间线上的消息 id：投递送达后按它把回执写回消息。
    pub message_id: String,
    /// 被显式点名的成员 id（收窄后也就是投递对象）。不点名时为空，
    /// 投递发给全体其他成员、口径是「看见即可」。
    pub mentioned: Vec<String>,
    /// 引用回复的现成摘录（「（回复 前端：「原话摘要」）」），注入行直接缀上；
    /// 没引用时为 None。
    pub reply_preview: Option<String>,
}

/// 一次表情回应的结果：落到哪条消息上、点上了还是取消了。
pub struct ReactOutcome {
    pub room_id: String,
    pub room_name: String,
    pub message_id: String,
    /// 被点消息的短 id（回执与界面照写这个）。
    pub message_short: String,
    pub emoji: String,
    /// true＝点上，false＝取消。
    pub active: bool,
}

/// 一次「读房间对话」的结果。
pub struct LogOutcome {
    pub room_name: String,
    pub lines: Vec<RoomLine>,
}

pub trait RoomDirectory: Send + Sync {
    fn my_rooms(&self, tab_id: &str) -> Vec<RoomBrief>;
    /// 成员往自己的房间说一句话。Err 是给人看的理由（不在房间、没说清哪间、说太快）。
    fn say(
        &self,
        tab_id: &str,
        room: Option<&str>,
        text: &str,
        reply_to: Option<&str>,
    ) -> Result<SayOutcome, String>;
    /// 给房间里某条消息点表情（同一人同一表情再点一次取消）。
    fn react(
        &self,
        tab_id: &str,
        room: Option<&str>,
        message: &str,
        emoji: &str,
    ) -> Result<ReactOutcome, String>;
    /// 成员读自己房间最近的对话。
    fn log(&self, tab_id: &str, room: Option<&str>, count: usize) -> Result<LogOutcome, String>;
    /// 登记一次成员间的转手（`send` 直派，或房间点名的接收方）：对方交差时
    /// 把回复回显进房间时间线——聊天不能断在交接处。best-effort：
    /// 登记失败不该挡住投递本身。
    fn note_delegation(
        &self,
        room_id: Option<&str>,
        from_tab: &str,
        to_tab: &str,
        bus_task_id: &str,
        text: &str,
        announce: bool,
    );
}

/// 房间目录的挂载点。
///
/// 服务线程在应用 setup 之前就起来了（socket 要先于任何 PTY 存在），而房间
/// 存储要等 Tauri 的 app 句柄才拿得到路径。装好之前按「不在任何房间」回答；
/// 挂载只发生一次，装完之后所有请求自动看到真实数据。
#[derive(Default)]
pub struct RoomAccess(std::sync::OnceLock<Arc<dyn RoomDirectory>>);

impl RoomAccess {
    pub fn set(&self, directory: Arc<dyn RoomDirectory>) {
        let _ = self.0.set(directory);
    }

    fn my_rooms(&self, tab_id: &str) -> Vec<RoomBrief> {
        match self.0.get() {
            Some(directory) => directory.my_rooms(tab_id),
            None => Vec::new(),
        }
    }

    fn say(
        &self,
        tab_id: &str,
        room: Option<&str>,
        text: &str,
        reply_to: Option<&str>,
    ) -> Result<SayOutcome, String> {
        match self.0.get() {
            Some(directory) => directory.say(tab_id, room, text, reply_to),
            None => Err("房间目录还没就绪，稍后再试".to_string()),
        }
    }

    fn react(
        &self,
        tab_id: &str,
        room: Option<&str>,
        message: &str,
        emoji: &str,
    ) -> Result<ReactOutcome, String> {
        match self.0.get() {
            Some(directory) => directory.react(tab_id, room, message, emoji),
            None => Err("房间目录还没就绪，稍后再试".to_string()),
        }
    }

    fn log(&self, tab_id: &str, room: Option<&str>, count: usize) -> Result<LogOutcome, String> {
        match self.0.get() {
            Some(directory) => directory.log(tab_id, room, count),
            None => Err("房间目录还没就绪，稍后再试".to_string()),
        }
    }

    fn note_delegation(
        &self,
        room_id: Option<&str>,
        from_tab: &str,
        to_tab: &str,
        bus_task_id: &str,
        text: &str,
        announce: bool,
    ) {
        if let Some(directory) = self.0.get() {
            directory.note_delegation(room_id, from_tab, to_tab, bus_task_id, text, announce);
        }
    }
}

pub struct CollabServer {
    endpoint: String,
}

impl CollabServer {
    /// 起监听线程，返回要注入 PTY 的端点串。
    ///
    /// 起不来就返回 None：协作是增强功能，socket 占用或权限不足不该让整个
    /// 应用起不来——这和「Agent 检测失败不该让你打不开一个 Shell」是同一条取向。
    pub fn start(
        identities: Arc<SessionIdentities>,
        registry: Arc<SessionRegistry>,
        board: Arc<TaskBoard>,
        rooms: Arc<RoomAccess>,
    ) -> Option<Self> {
        let listener = Listener::bind()?;
        let endpoint = listener.endpoint();
        thread::spawn(move || listener.serve(identities, registry, board, rooms));
        Some(Self { endpoint })
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
}

enum Listener {
    #[cfg(unix)]
    Unix(std::os::unix::net::UnixListener, std::path::PathBuf),
    #[cfg(not(unix))]
    Tcp(TcpListener),
}

impl Listener {
    #[cfg(unix)]
    fn bind() -> Option<Self> {
        use std::os::unix::fs::PermissionsExt;

        let path = socket_path()?;
        // 先立自己的活体标记，再建 socket。顺序反过来会开一个窗口：socket 文件
        // 已经在了、标记还没有，这时候别的实例扫到这里会退回 connect 探测，而
        // 我们还没开始 accept，正好被判死、文件被删。
        hold_live_lock(&path);
        // 扫掉自己那些没退干净的旧 socket，别让临时目录慢慢攒满。
        sweep_stale_sockets();
        // 同名文件还在（pid 复用这种极小概率）会让 bind 报「地址已占用」。
        let _ = std::fs::remove_file(&path);
        let listener = std::os::unix::net::UnixListener::bind(&path).ok()?;
        // 0600：同机器上的其他用户连不上。这是这条通道的第一道闸，
        // token 是第二道——两道都要有，任一单独都不够。
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).ok()?;
        Some(Self::Unix(listener, path))
    }

    #[cfg(not(unix))]
    fn bind() -> Option<Self> {
        // 端口交给系统挑：固定端口会在开第二个实例时撞车。
        TcpListener::bind(("127.0.0.1", 0)).ok().map(Self::Tcp)
    }

    fn endpoint(&self) -> String {
        match self {
            #[cfg(unix)]
            Self::Unix(_, path) => format!("unix:{}", path.display()),
            #[cfg(not(unix))]
            Self::Tcp(listener) => listener
                .local_addr()
                .map(|addr| format!("tcp:{addr}"))
                .unwrap_or_default(),
        }
    }

    fn serve(
        self,
        identities: Arc<SessionIdentities>,
        registry: Arc<SessionRegistry>,
        board: Arc<TaskBoard>,
        rooms: Arc<RoomAccess>,
    ) {
        match self {
            #[cfg(unix)]
            Self::Unix(listener, _) => {
                for stream in listener.incoming().flatten() {
                    let (identities, registry, board, rooms) = (
                        identities.clone(),
                        registry.clone(),
                        board.clone(),
                        rooms.clone(),
                    );
                    // 每个连接一个短线程：一次请求处理里有文件 IO，
                    // 卡在一个客户端上会让其他 Agent 一起等。
                    thread::spawn(move || {
                        serve_connection(stream, &identities, &registry, &board, &rooms)
                    });
                }
            }
            #[cfg(not(unix))]
            Self::Tcp(listener) => {
                for stream in listener.incoming().flatten() {
                    let (identities, registry, board, rooms) = (
                        identities.clone(),
                        registry.clone(),
                        board.clone(),
                        rooms.clone(),
                    );
                    thread::spawn(move || {
                        serve_connection(stream, &identities, &registry, &board, &rooms)
                    });
                }
            }
        }
    }
}

/// 读写要分别持有：BufReader 会把 stream 吃掉，所以每种传输自己给一份写端。
trait Connection: std::io::Read + Send + 'static {
    fn write_half(&self) -> Option<Box<dyn Write + Send>>;
}

#[cfg(not(unix))]
impl Connection for TcpStream {
    fn write_half(&self) -> Option<Box<dyn Write + Send>> {
        self.try_clone().ok().map(|value| Box::new(value) as _)
    }
}

#[cfg(unix)]
impl Connection for std::os::unix::net::UnixStream {
    fn write_half(&self) -> Option<Box<dyn Write + Send>> {
        self.try_clone().ok().map(|value| Box::new(value) as _)
    }
}

fn serve_connection<S: Connection>(
    stream: S,
    identities: &SessionIdentities,
    registry: &SessionRegistry,
    board: &TaskBoard,
    rooms: &RoomAccess,
) {
    let Some(mut writer) = stream.write_half() else {
        return;
    };
    let mut line = String::new();
    let mut reader = BufReader::new(stream).take(MAX_REQUEST_BYTES);
    if reader.read_line(&mut line).is_err() {
        return;
    }

    let response = handle_line(&line, identities, registry, board, rooms);
    if let Ok(mut text) = serde_json::to_string(&response) {
        text.push('\n');
        let _ = writer.write_all(text.as_bytes());
        let _ = writer.flush();
    }
}

fn handle_line(
    line: &str,
    identities: &SessionIdentities,
    registry: &SessionRegistry,
    board: &TaskBoard,
    rooms: &RoomAccess,
) -> Response {
    let request: Request = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(err) => return Response::error(format!("请求格式不对：{err}")),
    };
    if request.version != PROTOCOL_VERSION {
        // 说清是版本问题，否则表现成「某个参数没生效」，最难查。
        return Response::error(format!(
            "belfry 命令行版本与应用不匹配（协议 {} vs {}），请更新后重试",
            request.version, PROTOCOL_VERSION
        ));
    }
    if !identities.verify(&request.tab_id, &request.token) {
        // 不区分「会话不存在」和「token 不对」：区分本身就是一个可试探的信号。
        return Response::error("身份校验失败：这条会话不能通过 belfry 说话");
    }
    dispatch(&request, registry, board, rooms)
}

fn dispatch(
    request: &Request,
    registry: &SessionRegistry,
    board: &TaskBoard,
    rooms: &RoomAccess,
) -> Response {
    match &request.command {
        Command::Peers => Response::Ok {
            data: ResponseData::Peers {
                peers: registry.peers_for(&request.tab_id),
            },
        },
        Command::Rooms => Response::Ok {
            data: ResponseData::Rooms {
                rooms: rooms.my_rooms(&request.tab_id),
            },
        },
        Command::RoomSay {
            room,
            text,
            reply_to,
        } => dispatch_room_say(
            request,
            registry,
            board,
            rooms,
            room.as_deref(),
            text,
            reply_to.as_deref(),
        ),
        Command::RoomReact {
            room,
            message,
            emoji,
        } => match rooms.react(&request.tab_id, room.as_deref(), message, emoji) {
            Ok(outcome) => Response::Ok {
                data: ResponseData::RoomReacted {
                    room: outcome.room_name,
                    message: outcome.message_short,
                    emoji: outcome.emoji,
                    active: outcome.active,
                },
            },
            Err(reason) => Response::error(reason),
        },
        Command::RoomLog { room, count } => match rooms.log(
            &request.tab_id,
            room.as_deref(),
            count.unwrap_or(20) as usize,
        ) {
            Ok(outcome) => Response::Ok {
                data: ResponseData::RoomLog {
                    room: outcome.room_name,
                    entries: outcome.lines,
                },
            },
            Err(message) => Response::error(message),
        },
        Command::Send {
            to,
            instruction,
            parent_task,
        } => dispatch_send(
            request,
            registry,
            board,
            rooms,
            to,
            instruction,
            parent_task.as_deref(),
        ),
        Command::Done { task, result } => settle(
            board,
            &request.tab_id,
            task,
            TaskState::Done,
            result.clone(),
        ),
        Command::Fail { task, reason } => settle(
            board,
            &request.tab_id,
            task,
            TaskState::Failed,
            Some(reason.clone()),
        ),
        Command::TaskState { task } => task_state(board, &request.tab_id, task),
        Command::Inbox => Response::Ok {
            data: ResponseData::Inbox {
                tasks: board
                    .snapshot()
                    .into_iter()
                    .filter(|entry| {
                        entry.to == request.tab_id
                            // 群聊消息不是要交差的活：不进 inbox，免得成员对着一条
                            // 闲聊找 done 号。
                            && entry.chat.is_none()
                            && matches!(entry.state, TaskState::Queued | TaskState::Dispatched)
                    })
                    .map(|entry| InboxTask {
                        task: task::short_id(&entry.id).to_string(),
                        // 房间派发的任务对成员显示房间名；互派退回 tabId 兜底。
                        from: match &entry.origin {
                            Some(task::TaskOrigin::Room { name, .. }) => format!("房间「{name}」"),
                            None => entry.from.clone(),
                        },
                        instruction: entry.instruction,
                        state: format!("{:?}", entry.state).to_lowercase(),
                    })
                    .collect(),
            },
        },
    }
}

/// 房间群聊的投递（`belfry room say` 的落点）。
///
/// 群聊通道：不建交差任务、不要求 `done`——只把对话送进被点名者（或全体其他
/// 成员）的终端，回复走同一条 `room say`，时间线直接成环。点名＝请对方接话，
/// 不点名＝看见即可。不走 `judge`：房间成员资格就是用户的授权；忙碌与否交给
/// 队列背压——聊天不该因为对方正忙就被拒。防刷屏靠房间层的限速（见
/// `RoomStore::member_say`）。
fn dispatch_room_say(
    request: &Request,
    registry: &SessionRegistry,
    board: &TaskBoard,
    rooms: &RoomAccess,
    room: Option<&str>,
    text: &str,
    reply_to: Option<&str>,
) -> Response {
    let outcome = match rooms.say(&request.tab_id, room, text, reply_to) {
        Ok(outcome) => outcome,
        Err(message) => return Response::error(message),
    };
    // 每行带发言者角色名，多条并进同一条注入时就是一段对话摘录；
    // 引用回复缀上原话摘录，群里指代不靠猜。
    let mut line = format!("{}：{}", outcome.sender_role, text.trim());
    if let Some(preview) = &outcome.reply_preview {
        line.push_str(preview);
    }
    let mut recipients = Vec::new();
    let mut skipped = Vec::new();
    for target in &outcome.recipients {
        if registry.find(&target.tab_id).is_none() {
            skipped.push(format!("「{}」的会话已经不在了", target.role));
            continue;
        }
        // 口径：点名收窄后投递对象就是被点的人（「请你说」）；群发到全体（「看见即可」）。
        let direct = outcome
            .addressed
            && outcome.mentioned.iter().any(|id| id == &target.member_id);
        let now = now_millis();
        // 窗口内的连发并进同一条排队中的注入；已送达／超窗则另起一条。
        if !board.append_pending_chat(
            &target.tab_id,
            &outcome.room_id,
            &line,
            &outcome.message_id,
            now,
            direct,
        ) {
            let id = ulid::Ulid::generate().to_string().to_lowercase();
            board.insert(
                task::chat_task(
                    id,
                    &outcome.message_id,
                    &request.tab_id,
                    &target.tab_id,
                    &line,
                    direct,
                    now,
                )
                .with_origin(task::TaskOrigin::Room {
                    id: outcome.room_id.clone(),
                    name: outcome.room_name.clone(),
                }),
            );
        }
        recipients.push(target.role.clone());
    }
    Response::Ok {
        data: ResponseData::RoomSaid {
            room: outcome.room_name,
            recipients,
            skipped,
        },
    }
}

/// 派活。
///
/// 闸门判断在 `task::judge` 里，这里只把上下文凑齐：解析目标、找父任务、
/// 比对项目归属。分开是因为闸门是最不能出错的部分，它必须能脱离 IPC 单测。
fn dispatch_send(
    request: &Request,
    registry: &SessionRegistry,
    board: &TaskBoard,
    rooms: &RoomAccess,
    to: &str,
    instruction: &str,
    parent_task: Option<&str>,
) -> Response {
    let target = match registry.resolve(to, &request.tab_id) {
        Ok(session) => session,
        Err(message) => return Response::error(message),
    };
    // 父任务用短 id 传递：Agent 照抄它在提示里看到的那串就行。
    let parent = parent_task.and_then(|short| {
        board
            .snapshot()
            .into_iter()
            .find(|candidate| task::short_id(&candidate.id) == short)
    });

    // 项目归属从名册读而不是身份表：身份表里只有领过牌子的会话才有这一项，
    // 而名册是前端推过来的完整状态，两条会话都在里面。
    let mine = registry
        .find(&request.tab_id)
        .and_then(|session| session.project_root);
    let info = TargetInfo {
        exists: true,
        can_receive: target.can_receive,
        // 两边都没有项目时不算同项目：那说明谁都没打开目录，
        // 派过去也没有共同的工作现场。
        same_project: mine.is_some() && mine == target.project_root,
    };
    let outgoing = TaskRequest {
        from: &request.tab_id,
        to: &target.tab_id,
        instruction,
        parent: parent.as_ref(),
    };
    let root = parent
        .as_ref()
        .and_then(|entry| entry.path.first().cloned())
        .unwrap_or_else(|| request.tab_id.clone());

    // 同项目派活默认自动放行。
    //
    // 一开始默认 Ask（每条都要用户点头），但真用起来才发现代价错位：用户为了协作
    // 已经开好会话、起好名字、写清流程，意图明明白白，再要求他为每一条点一次确认，
    // 一条流水线就是六七次点击——而他多半正等着看结果，不是在守着面板。
    //
    // 换掉的只是「同项目内要不要问一声」。真正的边界一条没动：跨项目仍然硬拒，
    // 转包跳数、成环检测、每轮消息预算照旧，面板上那个一键全停也还在。
    match task::judge(
        &outgoing,
        &info,
        ApprovalMode::AutoInProject,
        board.count_in_path(&root),
    ) {
        Verdict::Rejected(message) => Response::error(message),
        verdict => {
            let id = ulid::Ulid::generate().to_string().to_lowercase();
            let created = task::build_task(id, &outgoing, now_millis(), &verdict);
            let short = task::short_id(&created.id).to_string();
            let bus_id = created.id.clone();
            board.insert(created);
            // 两边都是同房成员时留痕：对方交差后回复回到房间时间线。
            // 找不到共同房间（或有一边不在房间里）就静默跳过——send 不要求房间。
            // 先入板、再登记：登记在前、对账抢先看到时会误报「结果未知」。
            rooms.note_delegation(None, &request.tab_id, &target.tab_id, &bus_id, instruction, true);
            Response::Ok {
                data: ResponseData::Sent {
                    task: short,
                    // 回名字而不是标题：Agent 之后要用它跟对方说话。
                    to: target.name.unwrap_or(target.tab_id),
                    // 「已受理」不等于「已送到」——不说清楚，Agent 会以为对方开工了。
                    pending_approval: verdict == Verdict::NeedsApproval,
                },
            }
        }
    }
}

/// 查一条自己派出去的任务现在什么状态。`wait` 反复调它。
///
/// 只让派活方查。别人派的活里写着什么不该被第三方看见，而「不存在」和「不是你的」
/// 回同一句话——区分开本身就是一个可以拿来试探的信号。
fn task_state(board: &TaskBoard, asker: &str, short: &str) -> Response {
    let missing = || Response::error(format!("没有编号 {short} 的任务，用 belfry inbox 看看"));
    let Some(entry) = board
        .snapshot()
        .into_iter()
        .find(|entry| task::short_id(&entry.id) == short)
    else {
        return missing();
    };
    if entry.from != asker {
        return missing();
    }
    Response::Ok {
        data: ResponseData::TaskState {
            task: short.to_string(),
            state: format!("{:?}", entry.state).to_lowercase(),
            settled: task::is_settled(&entry.state),
            result: entry.result,
        },
    }
}

/// 结掉一条任务。短 id 来自注入提示里那串，先还原成完整 id 再交给 board。
fn settle(
    board: &TaskBoard,
    claimant: &str,
    short: &str,
    state: TaskState,
    result: Option<String>,
) -> Response {
    let Some(full) = board
        .snapshot()
        .into_iter()
        .find(|entry| task::short_id(&entry.id) == short)
        .map(|entry| entry.id)
    else {
        return Response::error(format!("没有编号 {short} 的任务，用 belfry inbox 看看"));
    };
    match board.settle(&full, claimant, state, result) {
        Ok(entry) => Response::Ok {
            data: ResponseData::Settled {
                task: task::short_id(&entry.id).to_string(),
            },
        },
        Err(message) => Response::error(message),
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

use std::io::Read as _;

#[cfg(unix)]
fn socket_path() -> Option<std::path::PathBuf> {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    // 带 uid：多用户机器上各连各的，不会撞名也不会互相看见。
    //
    // 还要带 pid：同一个人经常同时开两个实例（一个正式版干活，一个 dev 调试）。
    // 只按 uid 命名的话，后起来那个会把前一个的 socket 文件 remove 掉，前一个
    // 里的 Agent 突然就连不上 belfry 了——而它自己毫不知情，报错还指向别处。
    // CLI 不猜路径，它从 BELFRY_ENDPOINT 拿完整地址，所以带 pid 不影响寻址。
    Some(dir.join(format!(
        "belfry-{}-{}.sock",
        current_uid(),
        std::process::id()
    )))
}

/// 清掉自己那些没退干净的旧 socket。
///
/// 带 pid 命名之后残留文件不会撞车，但会一个个攒在临时目录里。判活看的是活体
/// 标记（见 `owner_is_gone`），不是信号也不是「连一下试试」。
#[cfg(unix)]
fn sweep_stale_sockets() {
    let Some(current) = socket_path() else {
        return;
    };
    let Some(dir) = current.parent() else {
        return;
    };
    // 前缀不带尾部连字符，好把升级前那批只按 uid 命名的（`belfry-<uid>.sock`）
    // 一起收掉。理论上会碰到 uid 前缀相近的别人的文件（501 与 5011），但那些是
    // 0600 且属于别的用户，remove 会失败并被忽略。
    sweep_stale_sockets_in(dir, &format!("belfry-{}", current_uid()), &current);
}

/// 目录和前缀由调用方给，好让测试在自己的临时目录里验，
/// 而不是扫真实的临时目录——那里可能躺着正在服务的实例。
#[cfg(unix)]
fn sweep_stale_sockets_in(dir: &std::path::Path, prefix: &str, current: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with(prefix) {
            continue;
        }
        // 落单的活体标记：上面那轮只遍历 .sock，收不到它们，会自己在临时目录里
        // 攒着。同样只在抢到锁时才动手——注意这里也覆盖了本进程自己的标记（sweep
        // 跑在 bind 之前，此刻我们的 .sock 还没建，看起来正是「落单」的），靠的是
        // flock 按 fd 计：换个 fd 打开也抢不到，所以自己的标记扫不掉。
        if name.ends_with(".lock") && !path.with_extension("sock").exists() {
            if try_grab_existing(&path).is_some() {
                let _ = std::fs::remove_file(&path);
            }
            continue;
        }
        if !name.ends_with(".sock") || path == current {
            continue;
        }
        if !owner_is_gone(&path) {
            continue;
        }
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(live_lock_path(&path));
    }
}

/// socket 旁边那个活体标记的路径：`belfry-501-73734.sock` → `…-73734.lock`。
#[cfg(unix)]
fn live_lock_path(socket: &std::path::Path) -> std::path::PathBuf {
    socket.with_extension("lock")
}

/// 这个 socket 的主人还在不在。
///
/// 有活体标记就只认它：抢到锁说明原主人已经不在了。没有标记（升级前留下的
/// socket）才退回 connect 探测——那条路会误判，但只作用于这批老残留。
#[cfg(unix)]
fn owner_is_gone(socket: &std::path::Path) -> bool {
    let lock = live_lock_path(socket);
    if lock.exists() {
        // 抢到就 drop，我们只是探一下，不占着。
        return try_grab_existing(&lock).is_some();
    }
    std::os::unix::net::UnixStream::connect(socket).is_err()
}

/// 活体标记要活到进程结束，所以存进 static 而不是靠局部变量或结构体字段。
///
/// File 一旦 drop，flock 立刻就放了，别的实例会把我们的 socket 当残留删掉。
/// 那个后果特别隐蔽：Unix socket 的 listener 绑的是 inode，文件被 unlink 之后
/// 服务端毫无感知——fd 还有效、还在 accept、`lsof` 还显示那个路径，但客户端
/// 拿路径连过来永远 ENOENT，报错指向「文件不存在」，看起来像应用没启动。
/// 拿着标记的那个 fd 会被 spawn 出去的 PTY 子进程短暂继承（fork 复制一份，exec
/// 时 O_CLOEXEC 才关掉）。所以判活偶尔会假阳性：主进程已经退了，锁却还被某个
/// 正在 fork 的子进程按着。这个方向是刻意选的——把死实例判成活的只是让残留文件
/// 多留一轮，下次启动会收掉；把活实例判成死的才是要命的，那就是这套标记要挡的。
#[cfg(unix)]
static LIVE_LOCK: std::sync::OnceLock<std::fs::File> = std::sync::OnceLock::new();

#[cfg(unix)]
fn hold_live_lock(socket: &std::path::Path) {
    if let Some(file) = hold_live_lock_at(socket) {
        let _ = LIVE_LOCK.set(file);
    }
}

/// 建标记文件并抢锁，把 File 交回调用方——**必须一直握着**，见 `LIVE_LOCK`。
#[cfg(unix)]
fn hold_live_lock_at(socket: &std::path::Path) -> Option<std::fs::File> {
    use std::os::unix::fs::PermissionsExt;

    let path = live_lock_path(socket);
    let file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&path)
        .ok()?;
    // 和 socket 一样锁到本用户：别人连不上，也别让别人来抢我们的标记。
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    try_grab(file)
}

/// 只对已存在的文件抢锁。不带 create：「文件不存在」要能和「存在但被占着」
/// 分开——如果这里顺手把文件建出来，就永远抢得到，等于把所有人判死。
///
/// 这也是没法复用 `plugins::owner::PluginOwner` 的原因：它的 `open_file` 带
/// `create(true)`，那个语义对「占坑」是对的，对「探活」是错的。
#[cfg(unix)]
fn try_grab_existing(path: &std::path::Path) -> Option<std::fs::File> {
    let file = std::fs::OpenOptions::new().write(true).open(path).ok()?;
    try_grab(file)
}

#[cfg(unix)]
fn try_grab(file: std::fs::File) -> Option<std::fs::File> {
    use std::os::unix::io::AsRawFd;

    // 用 flock 而不是 fcntl 记录锁：flock 按打开的文件描述计，同一进程里换个 fd
    // 打开同一文件也抢不到——POSIX 记录锁是按进程算的，会直接给我们放行，那样
    // 自测和同进程多实例都会把对方误判成死的。
    //
    // 另一个好处是不用往文件里写 pid：进程被 SIGKILL 掉，内核自动放锁，不会留
    // 下一把永远解不开的锁。
    if unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) } == 0 {
        return Some(file);
    }
    None
}

#[cfg(unix)]
const LOCK_EX: i32 = 2;
#[cfg(unix)]
const LOCK_NB: i32 = 4;

#[cfg(unix)]
unsafe extern "C" {
    fn flock(fd: i32, operation: i32) -> i32;
}

#[cfg(unix)]
fn current_uid() -> u32 {
    unsafe extern "C" {
        fn getuid() -> u32;
    }
    unsafe { getuid() }
}

#[cfg(test)]
#[path = "server_test.rs"]
mod tests;
