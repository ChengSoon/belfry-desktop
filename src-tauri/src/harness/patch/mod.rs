mod audit;
pub mod commands;
mod diff;
mod io;
mod types;
pub use types::*;

use crate::harness::broker::{BrokerError, ReadBroker};
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const PREVIEW_LIMIT: usize = 100;
const TTL_MS: u64 = 10 * 60 * 1000;
pub(super) type AuditSink = Arc<dyn Fn(PatchAudit) + Send + Sync>;
type Clock = Arc<dyn Fn() -> u64 + Send + Sync>;

struct StoredPreview {
    preview: PatchPreview,
    path: PathBuf,
    session_id: String,
    worker_id: String,
    replacement: String,
    token: Option<String>,
}
struct Store {
    previews: HashMap<String, StoredPreview>,
    order: VecDeque<String>,
    generation: u64,
}

pub struct PatchBroker {
    store: Mutex<Store>,
    locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
    audit: AuditSink,
    clock: Clock,
}

impl PatchBroker {
    pub fn new(audit: impl Fn(PatchAudit) + Send + Sync + 'static) -> Self {
        Self::with_clock(audit, now_ms)
    }

    fn with_clock(
        audit: impl Fn(PatchAudit) + Send + Sync + 'static,
        clock: impl Fn() -> u64 + Send + Sync + 'static,
    ) -> Self {
        Self {
            store: Mutex::new(Store {
                previews: HashMap::new(),
                order: VecDeque::new(),
                generation: 0,
            }),
            locks: Mutex::new(HashMap::new()),
            audit: Arc::new(audit),
            clock: Arc::new(clock),
        }
    }

    pub fn propose(
        &self,
        sessions: &ReadBroker,
        request: ProposeRequest,
    ) -> PatchResult<PatchPreview> {
        let started = self.now();
        let result = self.propose_inner(sessions, &request);
        audit::proposed(
            &self.audit,
            &request,
            &result,
            self.now().saturating_sub(started),
        );
        result
    }

    fn propose_inner(
        &self,
        sessions: &ReadBroker,
        request: &ProposeRequest,
    ) -> PatchResult<PatchPreview> {
        let context = sessions.write_context(
            &request.worker_id,
            &request.session_id,
            "project.patch.propose",
        )?;
        let (path, original) = io::read_text(&context.root, &request.relative_path)?;
        if digest(&original) != request.expected_digest {
            return Err(BrokerError::new("WRITE_CONFLICT", "file content changed"));
        }
        if original == request.replacement {
            return Err(BrokerError::new("NO_CHANGES", "replacement has no changes"));
        }
        if request.replacement.len() > 512 * 1024 {
            return Err(BrokerError::new("TOO_LARGE", "replacement exceeds limit"));
        }
        let mut store = self.store.lock().unwrap();
        purge(&mut store, self.now());
        store.generation += 1;
        let preview = PatchPreview {
            preview_id: ulid::Ulid::generate().to_string().to_lowercase(),
            generation: store.generation,
            relative_path: request.relative_path.clone(),
            original_digest: digest(&original),
            replacement_digest: digest(&request.replacement),
            old_lines: original.lines().count(),
            new_lines: request.replacement.lines().count(),
            final_bytes: request.replacement.len(),
            diff: diff::build(&original, &request.replacement),
            expires_at: self.now() + TTL_MS,
        };
        insert_preview(
            &mut store,
            StoredPreview {
                preview: preview.clone(),
                path,
                session_id: request.session_id.clone(),
                worker_id: request.worker_id.clone(),
                replacement: request.replacement.clone(),
                token: None,
            },
        );
        Ok(preview)
    }

    pub fn approve(&self, preview_id: &str) -> PatchResult<String> {
        let mut store = self.store.lock().unwrap();
        purge(&mut store, self.now());
        let stored = store
            .previews
            .get_mut(preview_id)
            .ok_or_else(|| BrokerError::new("PREVIEW_EXPIRED", "patch preview is unavailable"))?;
        let token = ulid::Ulid::generate().to_string().to_lowercase();
        stored.token = Some(token.clone());
        Ok(token)
    }

    pub fn reject(&self, preview_id: &str) -> PatchResult<()> {
        let removed = self.store.lock().unwrap().previews.remove(preview_id);
        if removed.is_some() {
            Ok(())
        } else {
            Err(BrokerError::new(
                "PREVIEW_EXPIRED",
                "patch preview is unavailable",
            ))
        }
    }

    pub fn apply(&self, sessions: &ReadBroker, request: ApplyRequest) -> PatchResult<()> {
        let started = self.now();
        audit::apply_started(&self.audit, &request);
        let result = self.apply_inner(sessions, &request);
        audit::applied(
            &self.audit,
            &request,
            &result,
            self.now().saturating_sub(started),
        );
        result
    }

    fn apply_inner(&self, sessions: &ReadBroker, request: &ApplyRequest) -> PatchResult<()> {
        let stored = self.consume(request)?;
        let context = sessions.write_context(
            &request.worker_id,
            &request.session_id,
            "project.patch.apply",
        )?;
        let (path, _) = io::read_text(&context.root, &stored.preview.relative_path)?;
        if path != stored.path {
            return Err(BrokerError::new(
                "PATH_OUTSIDE_ROOT",
                "patch target identity changed",
            ));
        }
        let lock = self.path_lock(path.clone());
        let result = {
            let _guard = lock.lock().unwrap();
            self.apply_locked(sessions, request, &stored, &context.root, &path)
        };
        self.locks.lock().unwrap().remove(&path);
        result
    }

    fn apply_locked(
        &self,
        sessions: &ReadBroker,
        request: &ApplyRequest,
        stored: &StoredPreview,
        root: &std::path::Path,
        path: &std::path::Path,
    ) -> PatchResult<()> {
        let (current_path, current) = io::read_text(root, &stored.preview.relative_path)?;
        if current_path != path || digest(&current) != stored.preview.original_digest {
            return Err(BrokerError::new("WRITE_CONFLICT", "file content changed"));
        }
        sessions.write_context(
            &request.worker_id,
            &request.session_id,
            "project.patch.apply",
        )?;
        io::atomic_replace(root, path, &stored.replacement)
    }

    fn consume(&self, request: &ApplyRequest) -> PatchResult<StoredPreview> {
        let mut store = self.store.lock().unwrap();
        purge(&mut store, self.now());
        let stored = store
            .previews
            .remove(&request.preview_id)
            .ok_or_else(|| BrokerError::new("PREVIEW_EXPIRED", "patch preview is unavailable"))?;
        if stored.session_id != request.session_id
            || stored.worker_id != request.worker_id
            || stored.token.as_deref() != Some(&request.approval_token)
        {
            return Err(BrokerError::new(
                "APPROVAL_DENIED",
                "approval token is invalid",
            ));
        }
        Ok(stored)
    }

    fn path_lock(&self, path: PathBuf) -> Arc<Mutex<()>> {
        self.locks
            .lock()
            .unwrap()
            .entry(path)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
    fn now(&self) -> u64 {
        (self.clock)()
    }
    #[cfg(test)]
    fn preview_count(&self) -> usize {
        self.store.lock().unwrap().previews.len()
    }
}

fn insert_preview(store: &mut Store, preview: StoredPreview) {
    let id = preview.preview.preview_id.clone();
    store.order.push_back(id.clone());
    store.previews.insert(id, preview);
    while store.previews.len() > PREVIEW_LIMIT {
        if let Some(old) = store.order.pop_front() {
            store.previews.remove(&old);
        }
    }
}
fn purge(store: &mut Store, now: u64) {
    store
        .previews
        .retain(|_, value| value.preview.expires_at > now);
    store.order.retain(|id| store.previews.contains_key(id));
}
pub fn digest(content: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod race_tests;
#[cfg(test)]
mod tests;
