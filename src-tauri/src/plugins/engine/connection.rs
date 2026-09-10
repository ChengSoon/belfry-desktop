use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

pub const MAX_MESSAGE: usize = 1024 * 1024;
type Reply = Result<Value, String>;
type Pending = HashMap<u64, mpsc::SyncSender<Reply>>;
pub type HostHandler = Arc<dyn Fn(Value) -> Reply + Send + Sync>;
pub type EventHandler = Arc<dyn Fn(Value) + Send + Sync>;

pub struct Connection {
    input: Mutex<ChildStdin>,
    process: Mutex<Child>,
    pending: Mutex<Pending>,
    next_id: AtomicU64,
    pub alive: AtomicBool,
}
impl Connection {
    pub fn launch(
        paths: (&Path, &Path, &Path),
        handlers: (HostHandler, EventHandler),
    ) -> Result<Arc<Self>, String> {
        let mut process = spawn(paths)?;
        let input = process.stdin.take().ok_or("插件宿主 stdin 不可用")?;
        let output = process.stdout.take().ok_or("插件宿主 stdout 不可用")?;
        let errors = process.stderr.take().ok_or("插件宿主 stderr 不可用")?;
        let connection = Arc::new(Self {
            input: Mutex::new(input),
            process: Mutex::new(process),
            pending: Mutex::default(),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
        });
        Self::read_output(&connection, output, handlers.clone());
        thread::spawn(move || {
            let mut reader = BufReader::new(errors);
            let mut budget: usize = 64 * 1024;
            while let Ok(Some(message)) = read_message(&mut reader) {
                if budget == 0 {
                    continue;
                }
                budget = budget.saturating_sub(message.len());
                handlers.1(json!({"name":"hostLog", "message":String::from_utf8_lossy(&message)}));
            }
        });
        Ok(connection)
    }
    fn read_output(
        connection: &Arc<Self>,
        output: std::process::ChildStdout,
        handlers: (HostHandler, EventHandler),
    ) {
        let weak = Arc::downgrade(connection);
        thread::spawn(move || {
            let mut reader = BufReader::new(output);
            while let Ok(Some(bytes)) = read_message(&mut reader) {
                let Some(connection) = weak.upgrade() else {
                    break;
                };
                let Ok(message) = serde_json::from_slice::<Value>(&bytes) else {
                    break;
                };
                connection.receive(message, &handlers);
            }
            if let Some(connection) = weak.upgrade() {
                connection.fail("插件宿主已退出或消息格式无效");
                handlers.1(
                    json!({"name":"hostExited", "message":"插件宿主已退出，请重新读取以恢复"}),
                );
            }
        });
    }
    fn receive(self: &Arc<Self>, message: Value, handlers: &(HostHandler, EventHandler)) {
        match message["type"].as_str() {
            Some("event") => handlers.1(message),
            Some("host") => {
                let connection = self.clone();
                let handler = handlers.0.clone();
                thread::spawn(move || {
                    let id = message["id"].clone();
                    let reply = match handler(message) {
                        Ok(value) => json!({"type":"hostReply", "id":id, "value":value}),
                        Err(error) => {
                            json!({"type":"hostReply", "id":id, "error":{"code":"HOST_ERROR", "message":error}})
                        }
                    };
                    let _ = connection.send(&reply);
                });
            }
            _ => {
                let Some(id) = message["id"].as_u64() else {
                    return;
                };
                let sender = self
                    .pending
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.remove(&id));
                if let Some(sender) = sender {
                    let result = if message["ok"] == true {
                        Ok(message["value"].clone())
                    } else {
                        Err(message["error"]["message"]
                            .as_str()
                            .unwrap_or("插件请求失败")
                            .into())
                    };
                    let _ = sender.send(result);
                }
            }
        }
    }
    fn send(&self, message: &Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(message).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_MESSAGE {
            return Err("插件请求大小超额".into());
        }
        bytes.push(b'\n');
        self.input
            .lock()
            .map_err(|_| "插件输入锁不可用")?
            .write_all(&bytes)
            .map_err(|e| e.to_string())
    }
    pub fn call(&self, method: &str, params: Value) -> Reply {
        self.call_timeout(method, params, Duration::from_secs(120))
    }
    pub fn call_timeout(&self, method: &str, params: Value, timeout: Duration) -> Reply {
        if !self.alive.load(Ordering::Acquire) {
            return Err("插件宿主未运行".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::sync_channel(1);
        {
            let mut pending = self.pending.lock().map_err(|_| "插件请求锁不可用")?;
            if pending.len() >= 128 {
                return Err("插件请求过多".into());
            }
            pending.insert(id, sender);
        }
        let result = self
            .send(&json!({"id":id, "method":method, "params":params}))
            .and_then(|_| {
                receiver
                    .recv_timeout(timeout)
                    .map_err(|_| format!("插件请求超时：{method}"))
            })
            .and_then(|value| value);
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
        result
    }
    fn fail(&self, reason: &str) {
        self.alive.store(false, Ordering::Release);
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err(reason.into()));
            }
        }
    }
    pub fn stop(&self) {
        let _ = self.call_timeout("shutdown", json!({}), Duration::from_secs(6));
        self.fail("插件宿主已停止");
        if let Ok(mut process) = self.process.lock() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}
fn spawn((node, root, base): (&Path, &Path, &Path)) -> Result<Child, String> {
    let mut command = Command::new(node);
    command
        .arg(root.join("host.mjs"))
        .arg(base)
        .current_dir(root)
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in [
        "PATH",
        "SystemRoot",
        "windir",
        "TEMP",
        "TMP",
        "TMPDIR",
        "LANG",
        "HOME",
        "USERPROFILE",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "LOCALAPPDATA",
        "BELFRY_BROWSER_EXECUTABLE",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "XDG_RUNTIME_DIR",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    if let Some(path) = crate::agent::user_command_path() {
        command.env("PATH", path);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map_err(|e| format!("无法启动 Node 插件宿主：{e}"))
}
impl Drop for Connection {
    fn drop(&mut self) {
        if let Ok(process) = self.process.get_mut() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}
fn read_message(reader: &mut impl BufRead) -> Result<Option<Vec<u8>>, String> {
    let mut bytes = Vec::new();
    (&mut *reader)
        .take((MAX_MESSAGE + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_MESSAGE {
        return Err("插件响应大小超额".into());
    }
    Ok((!bytes.is_empty()).then_some(bytes))
}

#[cfg(test)]
mod tests {
    #[test]
    fn refuses_unterminated_oversized_messages() {
        let bytes = vec![b'x'; super::MAX_MESSAGE + 1];
        assert!(super::read_message(&mut std::io::Cursor::new(bytes)).is_err());
    }
}
