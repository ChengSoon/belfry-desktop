use super::{contracts::HookMessage, registry::Registry};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

pub(super) const MAX_MESSAGE_BYTES: u64 = 64 * 1024;
pub(super) const IO_TIMEOUT: Duration = Duration::from_millis(400);
const MAX_CONNECTIONS: usize = 8;
const ACCEPT_INTERVAL: Duration = Duration::from_millis(10);

pub(super) struct Server {
    port: u16,
    running: Arc<AtomicBool>,
}

impl Server {
    pub fn start(registry: Arc<Registry>) -> Option<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
        let port = listener.local_addr().ok()?.port();
        listener.set_nonblocking(true).ok()?;
        let running = Arc::new(AtomicBool::new(true));
        let alive = running.clone();
        thread::spawn(move || serve(listener, registry, alive));
        Some(Self { port, running })
    }
    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
    }
}

fn serve(listener: TcpListener, registry: Arc<Registry>, running: Arc<AtomicBool>) {
    let connections = Arc::new(AtomicUsize::new(0));
    while running.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((stream, address)) => {
                if !address.ip().is_loopback()
                    || connections.load(Ordering::Acquire) >= MAX_CONNECTIONS
                {
                    continue;
                }
                connections.fetch_add(1, Ordering::AcqRel);
                let connections = connections.clone();
                let registry = registry.clone();
                thread::spawn(move || {
                    handle(stream, &registry);
                    connections.fetch_sub(1, Ordering::AcqRel);
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(ACCEPT_INTERVAL)
            }
            Err(_) => break,
        }
    }
}

fn handle(mut stream: TcpStream, registry: &Registry) {
    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    let mut bytes = Vec::new();
    let read = BufReader::new((&stream).take(MAX_MESSAGE_BYTES + 1)).read_until(b'\n', &mut bytes);
    let accepted = read.is_ok()
        && bytes.len() <= MAX_MESSAGE_BYTES as usize
        && bytes.last() == Some(&b'\n')
        && serde_json::from_slice::<HookMessage>(&bytes)
            .is_ok_and(|message| registry.accept(message));
    let reply = if accepted {
        b"{\"ok\":true}\n".as_slice()
    } else {
        b"{\"ok\":false}\n".as_slice()
    };
    let _ = stream.write_all(reply);
}
