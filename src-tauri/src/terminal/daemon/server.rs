use super::{
    endpoint::{self, Owner},
    protocol::{Endpoint, FLAG, Reply, Request, VERSION},
    service::Service,
    transport,
};
use std::{
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

const MAX_CONNECTIONS: usize = 96;

pub fn run_if_requested() -> bool {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new(FLAG)) {
        return false;
    }
    let result = args
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| "后台目录缺失".to_string())
        .and_then(|root| run(&root));
    if let Err(error) = result {
        eprintln!("Belfry 后台：{error}");
    }
    true
}

pub fn run(root: &Path) -> Result<(), String> {
    let _owner = Owner::acquire(root)?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(io)?;
    listener.set_nonblocking(true).map_err(io)?;
    let endpoint = Endpoint {
        version: VERSION,
        port: listener.local_addr().map_err(io)?.port(),
        token: format!("{}{}", ulid::Ulid::generate(), ulid::Ulid::generate()),
        instance: ulid::Ulid::generate().to_string(),
        pid: std::process::id(),
    };
    let service = Service::new(root.to_owned()).map_err(|error| error.message)?;
    endpoint::save(root, &endpoint)?;
    accept(listener, service, endpoint.token);
    // 只清理持锁期间由本实例发布的端点，不触碰任何其他应用实例。
    let _ = std::fs::remove_file(root.join("endpoint.json"));
    Ok(())
}

fn accept(listener: TcpListener, service: Arc<Service>, token: String) {
    let connections = Arc::new(AtomicUsize::new(0));
    while service.running.load(Ordering::Acquire) {
        let stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(_) => {
                thread::sleep(Duration::from_millis(15));
                continue;
            }
        };
        if connections.load(Ordering::Acquire) >= MAX_CONNECTIONS {
            continue;
        }
        connections.fetch_add(1, Ordering::AcqRel);
        let (service, token, connections) = (service.clone(), token.clone(), connections.clone());
        thread::spawn(move || {
            serve(stream, &service, &token);
            connections.fetch_sub(1, Ordering::AcqRel);
        });
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while connections.load(Ordering::Acquire) > 0 && std::time::Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
}

fn serve(mut stream: TcpStream, service: &Service, token: &str) {
    if transport::prepare_peer(&stream).is_err() {
        return;
    }
    let reply = match transport::read::<Request>(&mut stream) {
        Ok(request) if request.version != VERSION => Reply::error("后台协议版本不匹配"),
        Ok(request) if !same_secret(&request.token, token) => Reply::error("后台身份校验失败"),
        Ok(request) => service.handle(request.command),
        Err(error) => Reply::error(error),
    };
    let _ = transport::write(&mut stream, &reply);
}

pub(super) fn same_secret(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.bytes()
        .zip(right.bytes())
        .fold(0, |different, (a, b)| different | (a ^ b))
        == 0
}

fn io(error: impl std::fmt::Display) -> String {
    format!("后台服务不可用：{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepted_connections_wait_for_fragmented_requests() {
        use std::{io::Write, sync::mpsc};
        let root = std::env::temp_dir().join(format!(
            "belfry-daemon-fragments-{}",
            ulid::Ulid::generate()
        ));
        let service = Service::new(root).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut client = transport::connect(listener.local_addr().unwrap().port()).unwrap();
        let mut request = vec![];
        transport::write(
            &mut request,
            &Request {
                version: VERSION,
                token: "test-secret".into(),
                command: super::super::protocol::Command::Ping,
            },
        )
        .unwrap();
        client.write_all(&request[..2]).unwrap();
        let (ready, started) = mpsc::channel();
        let (finish, done) = mpsc::channel();
        let worker = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            // macOS 的 accept 会继承 listener 的 O_NONBLOCK；各平台都显式复现这个条件。
            stream.set_nonblocking(true).unwrap();
            ready.send(()).unwrap();
            serve(stream, &service, "test-secret");
            let _ = finish.send(());
        });
        started.recv().unwrap();
        assert!(
            done.recv_timeout(Duration::from_millis(40)).is_err(),
            "fragmented header was rejected before its body arrived"
        );
        client.write_all(&request[2..]).unwrap();
        let reply: Reply = transport::read(&mut client).unwrap();
        assert!(reply.error.is_none(), "{:?}", reply.error);
        worker.join().unwrap();
    }

    #[test]
    fn invalid_authentication_and_protocol_cannot_reach_the_service() {
        let root =
            std::env::temp_dir().join(format!("belfry-daemon-auth-{}", ulid::Ulid::generate()));
        let service = Service::new(root).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let worker = thread::spawn(move || {
            for _ in 0..3 {
                let (stream, _) = listener.accept().unwrap();
                serve(stream, &service, "test-secret");
            }
        });
        for (version, token, success) in [
            (VERSION, "wrong", false),
            (VERSION + 1, "test-secret", false),
            (VERSION, "test-secret", true),
        ] {
            let mut stream = transport::connect(port).unwrap();
            transport::write(
                &mut stream,
                &Request {
                    version,
                    token: token.into(),
                    command: super::super::protocol::Command::Ping,
                },
            )
            .unwrap();
            let reply: Reply = transport::read(&mut stream).unwrap();
            assert_eq!(success, reply.error.is_none());
        }
        worker.join().unwrap();
    }
}
