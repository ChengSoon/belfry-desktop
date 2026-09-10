use super::{process, types::*, validation};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const TOMBSTONE_LIMIT: usize = 256;

struct Registry {
    active: HashMap<String, Arc<WorkerProcess>>,
    stopped_order: VecDeque<String>,
    stopped: HashSet<String>,
}

impl Registry {
    fn new() -> Self {
        Self {
            active: HashMap::new(),
            stopped_order: VecDeque::new(),
            stopped: HashSet::new(),
        }
    }
    fn finish(&mut self, id: &str) {
        self.active.remove(id);
        if self.stopped.insert(id.into()) {
            self.stopped_order.push_back(id.into());
        }
        while self.stopped_order.len() > TOMBSTONE_LIMIT {
            if let Some(expired) = self.stopped_order.pop_front() {
                self.stopped.remove(&expired);
            }
        }
    }
}

pub struct WorkerManager {
    registry: Arc<Mutex<Registry>>,
    allowed_script: PathBuf,
    sink: EventSink,
}

impl WorkerManager {
    pub fn new(
        allowed_script: PathBuf,
        sink: impl Fn(WorkerEvent) + Send + Sync + 'static,
    ) -> Self {
        Self {
            registry: Arc::new(Mutex::new(Registry::new())),
            allowed_script,
            sink: Arc::new(sink),
        }
    }

    pub fn start(&self, entry: &str, args: &[String]) -> Result<String, String> {
        self.start_with_id(entry, args, None)
    }

    pub(crate) fn start_registered(
        &self,
        id: String,
        entry: &str,
        args: &[String],
    ) -> Result<String, String> {
        self.start_with_id(entry, args, Some(id))
    }

    fn start_with_id(
        &self,
        entry: &str,
        args: &[String],
        id: Option<String>,
    ) -> Result<String, String> {
        let registered = id.is_some();
        let id = id.unwrap_or_else(|| ulid::Ulid::generate().to_string().to_lowercase());
        let mut registry = self.registry.lock().unwrap();
        if registry.active.contains_key(&id) || registry.stopped.contains(&id) {
            return Err("worker ID is already used".into());
        }
        let executable = if registered {
            validation::resolve_node()?
        } else {
            validation::validate_command(entry, args, &self.allowed_script)?
        };
        let mut child = Command::new(executable)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_clear()
            .spawn()
            .map_err(|error| format!("worker spawn failed: {error}"))?;
        let stdin = child.stdin.take().ok_or("worker stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("worker stdout unavailable")?;
        let stderr = child.stderr.take().ok_or("worker stderr unavailable")?;
        let worker = Arc::new(WorkerProcess {
            child: Mutex::new(child),
            stdin: Mutex::new(Some(stdin)),
            lifecycle: Mutex::new(Lifecycle::Running),
            exit_intent: Mutex::new(ExitIntent::None),
        });
        registry.active.insert(id.clone(), worker.clone());
        drop(registry);
        (self.sink)(lifecycle_event(&id, Lifecycle::Running, None));
        process::watch(
            id.clone(),
            stdout,
            stderr,
            worker,
            self.sink.clone(),
            self.cleanup(),
        );
        Ok(id)
    }

    pub fn send(&self, id: &str, request: &Value) -> Result<(), String> {
        validation::validate_request(request)?;
        let worker = self.active_worker(id)?;
        match request.get("method").and_then(Value::as_str) {
            Some("cancel") => *worker.exit_intent.lock().unwrap() = ExitIntent::Cancel,
            Some("shutdown") => *worker.exit_intent.lock().unwrap() = ExitIntent::Shutdown,
            _ => {}
        }
        let mut bytes = serde_json::to_vec(request).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        worker
            .stdin
            .lock()
            .unwrap()
            .as_mut()
            .ok_or("worker stdin closed")?
            .write_all(&bytes)
            .map_err(|error| error.to_string())
    }

    pub fn stop(&self, id: &str) -> Result<(), String> {
        let worker = match self.lookup(id)? {
            Some(worker) => worker,
            None => return Ok(()),
        };
        let shutdown =
            serde_json::json!({"jsonrpc":"2.0","id":format!("shutdown-{id}"),"method":"shutdown"});
        let _ = self.send(id, &shutdown);
        if wait_for_exit(&worker, SHUTDOWN_TIMEOUT)? {
            process::finish(
                id,
                &worker,
                &self.sink,
                &self.cleanup(),
                Lifecycle::Shutdown,
                None,
            );
            return Ok(());
        }
        *worker.exit_intent.lock().unwrap() = ExitIntent::Force;
        worker
            .child
            .lock()
            .unwrap()
            .kill()
            .map_err(|error| error.to_string())?;
        worker
            .child
            .lock()
            .unwrap()
            .wait()
            .map_err(|error| error.to_string())?;
        process::finish(
            id,
            &worker,
            &self.sink,
            &self.cleanup(),
            Lifecycle::ForceTerminated,
            None,
        );
        Ok(())
    }

    pub fn stop_all(&self) {
        let ids: Vec<String> = self
            .registry
            .lock()
            .unwrap()
            .active
            .keys()
            .cloned()
            .collect();
        for id in ids {
            let _ = self.stop(&id);
        }
    }

    fn active_worker(&self, id: &str) -> Result<Arc<WorkerProcess>, String> {
        self.lookup(id)?
            .ok_or_else(|| "worker is not running".into())
    }

    fn lookup(&self, id: &str) -> Result<Option<Arc<WorkerProcess>>, String> {
        let registry = self.registry.lock().unwrap();
        if let Some(worker) = registry.active.get(id) {
            return Ok(Some(worker.clone()));
        }
        if registry.stopped.contains(id) {
            return Ok(None);
        }
        Err("unknown worker".into())
    }

    fn cleanup(&self) -> Cleanup {
        let registry = self.registry.clone();
        Arc::new(move |id| registry.lock().unwrap().finish(id))
    }

    #[cfg(test)]
    pub(super) fn registry_counts_for_test(&self) -> (usize, usize) {
        let registry = self.registry.lock().unwrap();
        (registry.active.len(), registry.stopped.len())
    }

    #[cfg(test)]
    pub(super) fn record_stopped_for_test(&self, id: String) {
        self.registry.lock().unwrap().finish(&id);
    }
}

fn wait_for_exit(worker: &WorkerProcess, timeout: Duration) -> Result<bool, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if worker
            .child
            .lock()
            .unwrap()
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Ok(true);
        }
        thread::sleep(Duration::from_millis(20));
    }
    Ok(false)
}

pub use super::types::{Lifecycle, WorkerEvent};
