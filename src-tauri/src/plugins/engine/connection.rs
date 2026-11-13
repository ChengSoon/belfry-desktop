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
    time::{Duration, Instant},
};

pub const MAX_MESSAGE: usize = 1024 * 1024;
type Reply = Result<Value, String>;
type Pending = HashMap<u64, mpsc::SyncSender<Reply>>;
pub type HostHandler = Arc<dyn Fn(Value) -> Reply + Send + Sync>;
pub type EventHandler = Arc<dyn Fn(Value) + Send + Sync>;

pub struct Connection {
    input: mpsc::SyncSender<WriteRequest>,
    process: Arc<Mutex<Child>>,
    pending: Mutex<Pending>,
    next_id: AtomicU64,
    pub alive: AtomicBool,
    stopping: AtomicBool,
    reaper: Mutex<Option<thread::JoinHandle<()>>>,
}
struct WriteRequest { bytes: Vec<u8>, deadline: Instant, done: mpsc::SyncSender<Result<(), String>> }
impl Connection {
    pub fn launch(
        paths: (&Path, &Path, &Path),
        handlers: (HostHandler, EventHandler),
    ) -> Result<Arc<Self>, String> {
        let mut process = spawn(paths)?;
        let input = process.stdin.take().ok_or("插件宿主 stdin 不可用")?;
        let output = process.stdout.take().ok_or("插件宿主 stdout 不可用")?;
        let errors = process.stderr.take().ok_or("插件宿主 stderr 不可用")?;
        let (outbound, writes) = mpsc::sync_channel(128);
        let connection = Arc::new(Self {
            input: outbound,
            process: Arc::new(Mutex::new(process)),
            pending: Mutex::default(),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            stopping: AtomicBool::new(false),
            reaper: Mutex::new(None),
        });
        Self::write_input(&connection, input, writes);
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
    fn write_input(connection: &Arc<Self>, mut input: ChildStdin, writes: mpsc::Receiver<WriteRequest>) {
        let weak = Arc::downgrade(connection);
        thread::spawn(move || {
            while let Ok(request) = writes.recv() {
                if Instant::now() >= request.deadline {
                    let _ = request.done.send(Err("插件请求在写入前已超时".into()));
                    continue;
                }
                let result = input.write_all(&request.bytes).map_err(|error| error.to_string());
                let failed = result.is_err();
                let _ = request.done.send(result);
                if failed {
                    if let Some(connection) = weak.upgrade() { connection.terminate("插件宿主输入不可用"); }
                    break;
                }
            }
        });
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
                connection.terminate("插件宿主已退出或消息格式无效");
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
        self.send_until(message, Instant::now() + Duration::from_secs(5))
    }
    fn send_until(&self, message: &Value, deadline: Instant) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(message).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_MESSAGE {
            return Err("插件请求大小超额".into());
        }
        bytes.push(b'\n');
        let (done, written) = mpsc::sync_channel(1);
        self.input.try_send(WriteRequest { bytes, deadline, done })
            .map_err(|_| "插件写入队列已满或宿主已退出".to_string())?;
        written.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| { self.terminate("插件宿主写入超时"); "插件宿主写入超时".to_string() })?
    }
    pub fn call(&self, method: &str, params: Value) -> Reply {
        self.call_timeout(method, params, Duration::from_secs(120))
    }
    pub fn call_timeout(&self, method: &str, params: Value, timeout: Duration) -> Reply {
        let deadline = Instant::now().checked_add(timeout).ok_or("插件截止时间无效")?;
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
            .send_until(&json!({"id":id, "method":method, "params":params}), deadline)
            .and_then(|_| {
                receiver
                    .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    .map_err(|_| { self.terminate("插件宿主响应超时"); format!("插件请求超时：{method}") })
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
        self.terminate("插件宿主已停止");
        self.join_reaper();
    }
    fn terminate(&self, reason: &str) {
        self.fail(reason);
        let Ok(mut reaper) = self.reaper.lock() else { return; };
        if self.stopping.swap(true, Ordering::AcqRel) { return; }
        let process = self.process.clone();
        // 回收不占用调用方的 deadline；唯一 writer 会随管道关闭被唤醒。
        *reaper = Some(thread::spawn(move || {
            if let Ok(mut process) = process.lock() {
                signal_tree(&mut process, false);
                thread::sleep(Duration::from_millis(300));
                signal_tree(&mut process, true);
                let _ = process.wait();
            }
        }));
    }
    fn join_reaper(&self) {
        let worker = self.reaper.lock().ok().and_then(|mut reaper| reaper.take());
        if let Some(worker) = worker { let _ = worker.join(); }
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
    #[cfg(unix)] {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
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
        self.terminate("插件宿主已释放");
        self.join_reaper();
    }
}

fn signal_tree(process: &mut Child, force: bool) {
    #[cfg(unix)] {
        unsafe extern "C" { fn kill(pid: i32, signal: i32) -> i32; }
        unsafe { kill(-(process.id() as i32), if force { 9 } else { 15 }); }
    }
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("taskkill.exe");
        command.args(["/PID", &process.id().to_string(), "/T"]);
        if force { command.arg("/F"); }
        let _ = command.creation_flags(0x08000000).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    if force { let _ = process.kill(); }
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
    use super::*;

    #[test]
    fn deadline_includes_a_full_stdin_pipe_and_queued_writers() {
        let root = std::env::temp_dir().join(format!("belfry-pipe-deadline-{}", ulid::Ulid::generate()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("host.mjs"), "process.stdin.pause(); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);").unwrap();
        let node = crate::agent::find_in_path("node").expect("Node.js required");
        let connection = Connection::launch((&node, &root, &root), (Arc::new(|_| Ok(Value::Null)), Arc::new(|_| {}))).unwrap();
        let (sender, receiver) = mpsc::channel();
        let mut workers = Vec::new();
        for _ in 0..2 {
            let (connection, sender) = (connection.clone(), sender.clone());
            workers.push(thread::spawn(move || {
                let params = json!({"text":"x".repeat(700 * 1024)});
                let started = std::time::Instant::now();
                let reply = connection.call_timeout("blocked", params, Duration::from_millis(100));
                sender.send((started.elapsed(), reply)).unwrap();
            }));
        }
        let first = receiver.recv_timeout(Duration::from_secs(2));
        let second = receiver.recv_timeout(Duration::from_secs(2));
        // 回归在旧实现也必须收尾，不能把 CI 挂死在被锁住的 stdin。
        {
            let mut process = connection.process.lock().unwrap();
            let _ = process.kill();
            let _ = process.wait();
        }
        for worker in workers { worker.join().unwrap(); }
        drop(connection);
        let _ = std::fs::remove_dir_all(root);
        for result in [first, second] {
            let (elapsed, reply) = result.expect("插件 deadline 必须包含队列及阻塞 stdin 写入");
            // Keep the 100-ms request deadline, with scheduling headroom for a shared
            // runner. A writer blocked on stdin must not wait for the usual 5-s limit.
            assert!(elapsed < Duration::from_secs(1), "{elapsed:?}");
            assert!(reply.is_err());
        }
    }

    #[test]
    fn refuses_unterminated_oversized_messages() {
        let bytes = vec![b'x'; super::MAX_MESSAGE + 1];
        assert!(super::read_message(&mut std::io::Cursor::new(bytes)).is_err());
    }
}
