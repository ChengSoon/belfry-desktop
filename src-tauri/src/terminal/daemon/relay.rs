use super::super::{AppError, CreateTerminalRequest};
use super::server::same_secret;
use std::{
    collections::HashMap,
    net::{TcpListener, TcpStream},
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

pub const PLUGIN_URL: &str = "BELFRY_PLUGIN_MCP_URL";
pub const PLUGIN_TOKEN: &str = "BELFRY_PLUGIN_MCP_TOKEN";
const MAX_CONNECTIONS: usize = 128;

#[derive(Clone)]
pub struct Route {
    pub tab_id: String,
    pub collab_token: String,
    pub plugin_token: String,
    pub collab_target: Option<(String, String)>,
    pub plugin_target: Option<(u16, String)>,
}

pub struct Relay {
    collab_port: u16,
    plugin_port: u16,
    routes: Mutex<HashMap<String, Route>>,
    running: AtomicBool,
}

impl Relay {
    pub fn start() -> Result<Arc<Self>, AppError> {
        let collab = listener()?;
        let plugin = listener()?;
        let relay = Arc::new(Self {
            collab_port: collab.local_addr().map_err(io)?.port(),
            plugin_port: plugin.local_addr().map_err(io)?.port(),
            routes: Mutex::new(HashMap::new()),
            running: AtomicBool::new(true),
        });
        serve(collab, Arc::downgrade(&relay), super::relay_collab::handle);
        serve(plugin, Arc::downgrade(&relay), super::relay_http::handle);
        Ok(relay)
    }

    pub fn bind(&self, key: &str, request: &mut CreateTerminalRequest) -> Result<(), AppError> {
        let Some(tab_id) = request.tab_id.as_ref() else {
            return Ok(());
        };
        if !request.profile_id.starts_with("agent:") {
            return Ok(());
        }
        let collab_target = pair(
            &request.env,
            belfry_protocol::ENV_ENDPOINT,
            belfry_protocol::ENV_TOKEN,
        );
        let plugin_target = pair(&request.env, PLUGIN_URL, PLUGIN_TOKEN)
            .and_then(|(url, token)| plugin_port(&url).map(|port| (port, token)));
        let mut routes = self.routes.lock().unwrap();
        if !routes.contains_key(key) && routes.len() >= super::protocol::MAX_SESSIONS {
            return Err(AppError::invalid_argument("后台代理会话已达上限"));
        }
        let route = routes.entry(key.into()).or_insert_with(|| Route {
            tab_id: tab_id.clone(),
            collab_token: secret(),
            plugin_token: secret(),
            collab_target: None,
            plugin_target: None,
        });
        route.collab_target = collab_target;
        route.plugin_target = plugin_target;
        request.env.insert(
            belfry_protocol::ENV_ENDPOINT.into(),
            format!("tcp:127.0.0.1:{}", self.collab_port),
        );
        request.env.insert(
            belfry_protocol::ENV_TOKEN.into(),
            route.collab_token.clone(),
        );
        // 节点桥只有实际准备成功才注入，普通终端不会获得插件凭据。
        if route.plugin_target.is_some() {
            request.env.insert(
                PLUGIN_URL.into(),
                format!("http://127.0.0.1:{}/mcp", self.plugin_port),
            );
            request
                .env
                .insert(PLUGIN_TOKEN.into(), route.plugin_token.clone());
        }
        Ok(())
    }

    pub fn collab(&self, tab: &str, token: &str) -> Option<Route> {
        self.routes
            .lock()
            .unwrap()
            .values()
            .find(|route| route.tab_id == tab && same_secret(&route.collab_token, token))
            .cloned()
    }

    pub fn plugin(&self, token: &str) -> Option<Route> {
        self.routes
            .lock()
            .unwrap()
            .values()
            .find(|route| same_secret(&route.plugin_token, token))
            .cloned()
    }

    pub fn remove(&self, key: &str) {
        self.routes.lock().unwrap().remove(key);
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
    }
}

pub fn plugin_port(url: &str) -> Option<u16> {
    let port = url
        .strip_prefix("http://127.0.0.1:")?
        .strip_suffix("/mcp")?
        .parse()
        .ok()?;
    (port != 0).then_some(port)
}

fn pair(env: &HashMap<String, String>, first: &str, second: &str) -> Option<(String, String)> {
    Some((env.get(first)?.clone(), env.get(second)?.clone()))
}
fn secret() -> String {
    format!("{}{}", ulid::Ulid::generate(), ulid::Ulid::generate())
}
fn io(error: impl std::fmt::Display) -> AppError {
    AppError::io(format!("后台代理不可用：{error}"))
}
fn listener() -> Result<TcpListener, AppError> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(io)?;
    listener.set_nonblocking(true).map_err(io)?;
    Ok(listener)
}

fn serve(listener: TcpListener, relay: Weak<Relay>, handler: fn(TcpStream, &Relay)) {
    thread::spawn(move || {
        let connections = Arc::new(AtomicUsize::new(0));
        loop {
            let Some(current) = relay.upgrade() else {
                break;
            };
            if !current.running.load(Ordering::Acquire) {
                break;
            }
            let stream = match listener.accept() {
                Ok((stream, _)) => stream,
                Err(_) => {
                    drop(current);
                    thread::sleep(Duration::from_millis(25));
                    continue;
                }
            };
            if connections.load(Ordering::Acquire) >= MAX_CONNECTIONS {
                continue;
            }
            connections.fetch_add(1, Ordering::AcqRel);
            let count = connections.clone();
            thread::spawn(move || {
                handler(stream, &current);
                count.fetch_sub(1, Ordering::AcqRel);
            });
        }
    });
}
