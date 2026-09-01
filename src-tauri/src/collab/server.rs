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

use belfry_protocol::{Command, InboxTask, PROTOCOL_VERSION, Request, Response, ResponseData};

use super::identity::SessionIdentities;
use super::registry::SessionRegistry;
use super::task::{self, ApprovalMode, TargetInfo, TaskBoard, TaskRequest, TaskState, Verdict};

/// 单行请求的上限。够放一条派活指令，又不至于让一个坏客户端把内存吃光。
const MAX_REQUEST_BYTES: u64 = 1024 * 1024;

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
    ) -> Option<Self> {
        let listener = Listener::bind()?;
        let endpoint = listener.endpoint();
        thread::spawn(move || listener.serve(identities, registry, board));
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
        // 先扫掉自己那些没退干净的旧 socket，别让临时目录慢慢攒满。
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
    ) {
        match self {
            #[cfg(unix)]
            Self::Unix(listener, _) => {
                for stream in listener.incoming().flatten() {
                    let (identities, registry, board) =
                        (identities.clone(), registry.clone(), board.clone());
                    // 每个连接一个短线程：一次请求处理里有文件 IO，
                    // 卡在一个客户端上会让其他 Agent 一起等。
                    thread::spawn(move || serve_connection(stream, &identities, &registry, &board));
                }
            }
            #[cfg(not(unix))]
            Self::Tcp(listener) => {
                for stream in listener.incoming().flatten() {
                    let (identities, registry, board) =
                        (identities.clone(), registry.clone(), board.clone());
                    thread::spawn(move || serve_connection(stream, &identities, &registry, &board));
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
) {
    let Some(mut writer) = stream.write_half() else {
        return;
    };
    let mut line = String::new();
    let mut reader = BufReader::new(stream).take(MAX_REQUEST_BYTES);
    if reader.read_line(&mut line).is_err() {
        return;
    }

    let response = handle_line(&line, identities, registry, board);
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
    dispatch(&request, registry, board)
}

fn dispatch(request: &Request, registry: &SessionRegistry, board: &TaskBoard) -> Response {
    match &request.command {
        Command::Peers => Response::Ok {
            data: ResponseData::Peers {
                peers: registry.peers_for(&request.tab_id),
            },
        },
        Command::Send {
            to,
            instruction,
            parent_task,
        } => dispatch_send(
            request,
            registry,
            board,
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
                            && matches!(entry.state, TaskState::Queued | TaskState::Dispatched)
                    })
                    .map(|entry| InboxTask {
                        task: task::short_id(&entry.id).to_string(),
                        from: entry.from,
                        instruction: entry.instruction,
                        state: format!("{:?}", entry.state).to_lowercase(),
                    })
                    .collect(),
            },
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
            board.insert(created);
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
/// 带 pid 命名之后残留文件不会撞车，但会一个个攒在临时目录里。判活不用信号
/// （pid 会被复用），而是试着连一下：连得上说明有实例在服务，不能动。
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
        if !name.starts_with(prefix) || !name.ends_with(".sock") || path == current {
            continue;
        }
        if std::os::unix::net::UnixStream::connect(&path).is_err() {
            let _ = std::fs::remove_file(&path);
        }
    }
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
