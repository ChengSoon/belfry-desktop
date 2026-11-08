//! 固定在房间重写前的中继模型。不能用当前协议类型，否则会把版本混跑测成同版互通。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    version: u32,
    tab_id: String,
    token: String,
    command: Command,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Command {
    Peers,
    #[serde(rename_all = "camelCase")]
    Send {
        to: String,
        instruction: String,
        parent_task: Option<String>,
    },
    Done {
        task: String,
        result: Option<String>,
    },
    Fail {
        task: String,
        reason: String,
    },
    Inbox,
    TaskState {
        task: String,
    },
    #[serde(rename_all = "camelCase")]
    RoomSay {
        room: Option<String>,
        text: String,
        reply_to: Option<String>,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum Response {
    Ok { data: Data },
    Error { message: String },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Data {
    Peers {
        peers: Vec<Value>,
    },
    #[serde(rename_all = "camelCase")]
    Sent {
        task: String,
        to: String,
        pending_approval: bool,
    },
    Settled {
        task: String,
    },
    Inbox {
        tasks: Vec<Value>,
    },
    TaskState {
        task: String,
        state: String,
        settled: bool,
        result: Option<String>,
    },
    RoomSaid {
        room: String,
        recipients: Vec<String>,
        skipped: Vec<String>,
    },
}

pub struct LegacyRelay {
    endpoint: String,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl LegacyRelay {
    pub fn start(target: &str) -> Self {
        let target = target.strip_prefix("tcp:").unwrap().to_string();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("tcp:{}", listener.local_addr().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let worker = thread::spawn(move || {
            while !stopped.load(Ordering::Acquire) {
                let (mut stream, _) = match listener.accept() {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("{error}"),
                };
                stream.set_nonblocking(false).unwrap();
                prepare(&stream);
                let response = forward(&mut stream, &target)
                    .unwrap_or_else(|message| Response::Error { message });
                writeln!(stream, "{}", serde_json::to_string(&response).unwrap()).unwrap();
            }
        });
        Self {
            endpoint,
            stop,
            worker: Some(worker),
        }
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
}

impl Drop for LegacyRelay {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.worker.take().unwrap().join().unwrap();
    }
}

fn prepare(stream: &TcpStream) {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .unwrap();
}

fn forward(stream: &mut TcpStream, target: &str) -> Result<Response, String> {
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).unwrap();
    let request: Request = serde_json::from_str(&line).map_err(|_| "协作请求格式无效")?;
    let mut upstream = TcpStream::connect(target).unwrap();
    prepare(&upstream);
    writeln!(upstream, "{}", serde_json::to_string(&request).unwrap()).unwrap();
    line.clear();
    BufReader::new(upstream).read_line(&mut line).unwrap();
    serde_json::from_str(&line).map_err(|_| "应用协作响应无效".into())
}
