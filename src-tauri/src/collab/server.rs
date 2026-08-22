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
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;

use belfry_protocol::{Command, ContextEntry, PROTOCOL_VERSION, Request, Response, ResponseData};

use super::contracts::{ContextKind, ContextSource, ContextWrite};
use super::identity::SessionIdentities;
use super::registry::SessionRegistry;
use super::store;

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
    pub fn start(identities: Arc<SessionIdentities>, registry: Arc<SessionRegistry>) -> Option<Self> {
        let listener = Listener::bind()?;
        let endpoint = listener.endpoint();
        thread::spawn(move || listener.serve(identities, registry));
        Some(Self { endpoint })
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
}

enum Listener {
    #[cfg(unix)]
    Unix(std::os::unix::net::UnixListener, std::path::PathBuf),
    Tcp(TcpListener),
}

impl Listener {
    #[cfg(unix)]
    fn bind() -> Option<Self> {
        use std::os::unix::fs::PermissionsExt;

        let path = socket_path()?;
        // 上一次进程没退干净会留下 socket 文件，bind 会因为「地址已占用」失败。
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
            Self::Tcp(listener) => listener
                .local_addr()
                .map(|addr| format!("tcp:{addr}"))
                .unwrap_or_default(),
        }
    }

    fn serve(self, identities: Arc<SessionIdentities>, registry: Arc<SessionRegistry>) {
        match self {
            #[cfg(unix)]
            Self::Unix(listener, _) => {
                for stream in listener.incoming().flatten() {
                    let (identities, registry) = (identities.clone(), registry.clone());
                    // 每个连接一个短线程：一次请求处理里有文件 IO，
                    // 卡在一个客户端上会让其他 Agent 一起等。
                    thread::spawn(move || serve_connection(stream, &identities, &registry));
                }
            }
            Self::Tcp(listener) => {
                for stream in listener.incoming().flatten() {
                    let (identities, registry) = (identities.clone(), registry.clone());
                    thread::spawn(move || serve_connection(stream, &identities, &registry));
                }
            }
        }
    }
}

/// 读写要分别持有：BufReader 会把 stream 吃掉，所以每种传输自己给一份写端。
trait Connection: std::io::Read + Send + 'static {
    fn write_half(&self) -> Option<Box<dyn Write + Send>>;
}

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
) {
    let Some(mut writer) = stream.write_half() else {
        return;
    };
    let mut line = String::new();
    let mut reader = BufReader::new(stream).take(MAX_REQUEST_BYTES);
    if reader.read_line(&mut line).is_err() {
        return;
    }

    let response = handle_line(&line, identities, registry);
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
    dispatch(&request, identities, registry)
}

fn dispatch(
    request: &Request,
    identities: &SessionIdentities,
    registry: &SessionRegistry,
) -> Response {
    match &request.command {
        Command::Peers => Response::Ok {
            data: ResponseData::Peers {
                peers: registry.peers_for(&request.tab_id),
            },
        },
        Command::ContextList => with_project(identities, &request.tab_id, |root| {
            store::list(root).map(|items| ResponseData::ContextList {
                items: items
                    .into_iter()
                    .map(|item| ContextEntry {
                        id: item.id,
                        title: item.title,
                        kind: format!("{:?}", item.kind).to_lowercase(),
                        path: item.path,
                        pinned: item.pinned,
                        tags: item.tags,
                    })
                    .collect(),
            })
        }),
        Command::ContextGet { id } => with_project(identities, &request.tab_id, |root| {
            store::get(root, id).map(|body| ResponseData::ContextBody { body })
        }),
        Command::ContextPut { title, body, tags } => {
            // 来路里的 agent 从名册查真实值，不在这里硬编码任何 agent 名字。
            let agent = registry
                .find(&request.tab_id)
                .map(|session| session.agent)
                .unwrap_or_default();
            with_project(identities, &request.tab_id, |root| {
                let id = ulid::Ulid::generate().to_string().to_lowercase();
                let now = now_millis();
                let write = ContextWrite {
                    id: id.clone(),
                    // Agent 写进来的一律记为产物：它不是用户手敲的约定，
                    // 来路不同，可信度也不同，列表里要看得出来。
                    kind: ContextKind::Artifact,
                    title: title.clone(),
                    body: body.clone(),
                    source: ContextSource::Agent {
                        tab_id: request.tab_id.clone(),
                        agent,
                    },
                    tags: tags.clone(),
                    pinned: false,
                    created_at: now,
                    updated_at: now,
                };
                store::put(root, write).map(|item| ResponseData::ContextPut {
                    reference: item
                        .path
                        .clone()
                        .map(|path| format!("@{path}"))
                        .unwrap_or_else(|| format!("【{}】", item.title)),
                    id: item.id,
                })
            })
        }
    }
}

/// 共享上下文读写都落在这条会话自己的项目里。
///
/// 没打开项目就直说，别让 Agent 对着一个静默失败反复重试。
fn with_project(
    identities: &SessionIdentities,
    tab_id: &str,
    work: impl FnOnce(&str) -> Result<ResponseData, crate::terminal::AppError>,
) -> Response {
    let Some(root) = identities.project_root(tab_id) else {
        return Response::error("这条会话还没打开项目，共享上下文无处可存");
    };
    match work(&root) {
        Ok(data) => Response::Ok { data },
        Err(error) => Response::error(error.message),
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
    Some(dir.join(format!("belfry-{}.sock", current_uid())))
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
