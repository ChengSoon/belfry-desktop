use super::super::protocol::{Reply, Request};
use super::*;
use std::{
    net::TcpListener,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

struct Peer {
    endpoint: Endpoint,
    calls: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Peer {
    fn new(root: &Path, version: Option<&str>, capabilities: &[&str]) -> Self {
        endpoint::private_directory(root).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = Endpoint {
            version: 1,
            port: listener.local_addr().unwrap().port(),
            token: "a".repeat(52),
            instance: ulid::Ulid::generate().to_string(),
            pid: std::process::id(),
        };
        endpoint::save(root, &endpoint).unwrap();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (seen, stopping) = (calls.clone(), stop.clone());
        let reply = serde_json::json!({"appVersion": version, "capabilities": capabilities});
        let worker = thread::spawn(move || {
            while !stopping.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        transport::prepare_peer(&stream).unwrap();
                        let request: Request = transport::read(&mut stream).unwrap();
                        let kind = serde_json::to_value(&request.command).unwrap()["kind"]
                            .as_str()
                            .unwrap()
                            .to_string();
                        seen.lock().unwrap().push(kind.clone());
                        assert_eq!(
                            kind, "ping",
                            "upgrade discovery must never stop an old daemon"
                        );
                        transport::write(&mut stream, &Reply::ok(&reply)).unwrap();
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2))
                    }
                    Err(error) => panic!("test listener: {error}"),
                }
            }
        });
        Self {
            endpoint,
            calls,
            stop,
            worker: Some(worker),
        }
    }
}

impl Drop for Peer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.worker.take().unwrap().join().unwrap();
    }
}

struct Root(PathBuf);
impl Root {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("belfry-upgrade-{}", ulid::Ulid::generate())))
    }
}
impl Drop for Root {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_live_older_or_unversioned_daemon_never_prevents_starting_the_new_release() {
    for version in [None, Some("1.0.2")] {
        let root = Root::new();
        let old = Peer::new(&root.0, version, &[]);
        let current = connect(&root.0, "1.0.7", |path| {
            assert_eq!(path, root.0.join("versions/1.0.7"));
            let mut fresh = old.endpoint.clone();
            fresh.instance = "fresh".into();
            Ok(fresh)
        })
        .unwrap();
        assert_eq!(current.instance, "fresh");
        assert_eq!(
            endpoint::read(&root.0).unwrap().instance,
            old.endpoint.instance
        );
        assert_eq!(*old.calls.lock().unwrap(), vec!["ping"]);
    }
}

#[test]
fn matching_versions_must_also_offer_required_status_capabilities() {
    let root = Root::new();
    let _old = Peer::new(&root.0, Some("1.0.7"), &[]);
    let result = connect(&root.0, "1.0.7", |_| Err("launch failed".into()));
    assert_eq!(result.err().unwrap(), "launch failed");
    assert!(
        transport::call::<serde_json::Value>(&endpoint::read(&root.0).unwrap(), Command::Ping)
            .is_ok()
    );
}

#[test]
fn a_matching_daemon_is_reused_and_the_release_directory_takes_precedence() {
    let root = Root::new();
    let old = Peer::new(
        &root.0,
        Some("1.0.7"),
        &["terminal_program_status_v1", "rolling_upgrade_v1"],
    );
    assert_eq!(
        connect(&root.0, "1.0.7", |_| panic!("must reuse"))
            .unwrap()
            .instance,
        old.endpoint.instance
    );
    let current = Peer::new(
        &root.0.join("versions/1.0.7"),
        Some("1.0.7"),
        &["terminal_program_status_v1", "rolling_upgrade_v1"],
    );
    assert_eq!(
        connect(&root.0, "1.0.7", |_| panic!("must reuse"))
            .unwrap()
            .instance,
        current.endpoint.instance
    );
}

#[test]
fn discovery_retains_multiple_generations_but_never_follows_directory_symlinks() {
    let root = Root::new();
    let old = Peer::new(&root.0, Some("1.0.2"), &[]);
    let current = Peer::new(
        &root.0.join("versions/1.0.7"),
        Some("1.0.7"),
        &["terminal_program_status_v1", "rolling_upgrade_v1"],
    );
    #[cfg(unix)]
    std::os::unix::fs::symlink(&root.0, root.0.join("versions/loop")).unwrap();
    let online = online(&root.0);
    assert_eq!(online.len(), 2);
    assert!(
        online
            .iter()
            .any(|(endpoint, _)| endpoint.instance == old.endpoint.instance)
    );
    assert!(
        online
            .iter()
            .any(|(endpoint, _)| endpoint.instance == current.endpoint.instance)
    );
}

#[test]
fn older_apps_never_retire_a_newer_or_unrecognized_build() {
    for old in ["1.0.7", "2.0.0", "custom", "1.0.6-beta.1"] {
        assert!(!supersedes(&serde_json::json!({"appVersion":old}), "1.0.6"));
    }
    assert!(supersedes(
        &serde_json::json!({"appVersion":"1.0.2"}),
        "1.0.6"
    ));
    assert!(!supersedes(
        &serde_json::json!({"appVersion":"1.0.6"}),
        "1.0.6"
    ));
    assert!(!compatible(
        &serde_json::json!({"appVersion":"1.0.6", "retiring":true,
        "capabilities":["terminal_program_status_v1", "rolling_upgrade_v1"]}),
        "1.0.6"
    ));
}

#[test]
fn an_incompatible_same_version_process_does_not_block_its_replacement_or_lose_its_endpoint() {
    let root = Root::new();
    let old = Peer::new(&root.0.join("versions/1.0.7"), Some("1.0.7"), &[]);
    connect(&root.0, "1.0.7", |path| {
        assert_ne!(path, root.0.join("versions/1.0.7"));
        assert!(path.starts_with(root.0.join("versions")));
        Ok(old.endpoint.clone())
    })
    .unwrap();
    assert_eq!(
        endpoint::read(&root.0.join("versions/1.0.7"))
            .unwrap()
            .instance,
        old.endpoint.instance
    );
}
