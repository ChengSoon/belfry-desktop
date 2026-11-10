//! Durable collaboration inbox. Sources own content; only this service owns delivery after activation.
mod agent;
pub mod commands;
mod model;
mod read;
mod scheduler;
mod source;
mod store;
pub(crate) use source::normalize_root;
#[cfg(test)]
mod tests;

use crate::{
    collab::{SessionRegistry, TaskBoard},
    rooms::RoomStore,
    terminal::{AppError, input_gate::InputGate},
};
use belfry_protocol::inbox::*;
use model::*;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub(crate) struct InboxService {
    store: store::Store,
    rooms: Arc<RoomStore>,
    board: Arc<TaskBoard>,
    registry: Arc<SessionRegistry>,
    gate: Arc<InputGate>,
    sync_error: Mutex<Option<String>>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Capabilities {
    schema_version: u32,
    capabilities: Vec<String>,
    enabled: bool,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Pending {
    revision: u64,
    recipients: Vec<PendingRecipient>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingRecipient {
    session_key: String,
    tab_id: String,
    project_root: String,
    pending_count: usize,
}

impl InboxService {
    pub(crate) fn load(
        root: Option<PathBuf>,
        rooms: Arc<RoomStore>,
        board: Arc<TaskBoard>,
        registry: Arc<SessionRegistry>,
        gate: Arc<InputGate>,
    ) -> Self {
        Self { store: store::Store::load(root), rooms, board, registry, gate, sync_error: Mutex::new(None) }
    }
    pub(crate) fn start(service: &Arc<Self>) {
        let weak = Arc::downgrade(service);
        std::thread::spawn(move || {
            while let Some(service) = weak.upgrade() {
                let result = service.sync().and_then(|_| service.flush_mirrors());
                *service.sync_error.lock().unwrap() = result.err().map(|e| e.message);
                drop(service);
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        });
    }
    fn with_sources<T>(&self, action: impl FnOnce(&source::Snapshot) -> Result<T, AppError>) -> Result<T, AppError> {
        let roots = self
            .registry
            .all()
            .into_iter()
            .filter_map(|session| {
                session
                    .project_root
                    .filter(|root| !root.is_empty())
                    .map(|root| (session.tab_id, source::normalize_root(&root)))
            })
            .collect();
        self.board.pin_inbox_projects(&roots).map_err(AppError::io)?;
        self.rooms.with_inbox_sources(|rooms, room_revision| {
            self.board.with_inbox_sources(|tasks, task_revision| {
                let mut snapshot = source::snapshot(
                    rooms,
                    tasks,
                    &self.registry,
                    room_revision
                        .saturating_add(task_revision)
                        .saturating_add(self.registry.revision())
                        .saturating_add(self.gate.revision()),
                );
                snapshot.native_unready = self
                    .registry
                    .all()
                    .iter()
                    .filter(|s| !self.gate.ready_tab(&s.tab_id))
                    .map(|s| s.tab_id.clone())
                    .collect();
                action(&snapshot)
            })
        })
    }
    pub(crate) fn capabilities(&self) -> Capabilities {
        Capabilities {
            schema_version: SCHEMA_VERSION,
            capabilities: vec![CAPABILITY.into()],
            enabled: self.board.inbox_enabled() && self.store.snapshot().is_ok_and(|data| data.enabled),
        }
    }
    pub(crate) fn activate(&self, operation_id: String, legacy_queue_drained: bool) -> Result<Capabilities, AppError> {
        if !legacy_queue_drained || operation_id.is_empty() || operation_id.len() > 128 {
            return Err(AppError::invalid_argument(
                "Stop the legacy dispatcher and drain its unwritten queue before activation",
            ));
        }
        self.store.snapshot()?;
        self.board.enable_inbox().map_err(AppError::io)?;
        self.store.edit(|data| {
            data.enabled = true;
            Ok(())
        })?;
        self.sync()?;
        Ok(self.capabilities())
    }
    pub(crate) fn sync(&self) -> Result<(), AppError> {
        if !self.board.inbox_enabled() {
            return Ok(());
        }
        self.with_sources(|sources| {
            self.store.edit(|data| {
                source::merge(data, sources);
                let at = now();
                let expired: Vec<_> = data
                    .batches
                    .values()
                    .filter(|batch| batch.view.phase == "prepared" && batch.view.lease_expires_at <= at)
                    .map(|batch| batch.view.id.clone())
                    .collect();
                for id in expired {
                    abort(data, &id);
                }
                let lost: Vec<_> = data
                    .batches
                    .values()
                    .filter(|batch| {
                        batch.view.phase == "submitting"
                            && (at > batch.view.lease_expires_at + 30_000
                                || at > batch.view.prepared_at + 2_000
                                    && !self.gate.valid_attempt(
                                        &batch.view.terminal_session_id,
                                        &batch.view.id,
                                        &batch.view.target_epoch,
                                    ))
                    })
                    .map(|batch| (batch.view.id.clone(), batch.view.terminal_session_id.clone()))
                    .collect();
                for (id, _) in &lost {
                    set_phase(data, id, "uncertain");
                }
                Ok(lost)
            })
        })
        .map(|lost| {
            for (id, session) in lost {
                self.gate.finish(&session, &id);
            }
        })
    }
    fn flush_mirrors(&self) -> Result<(), AppError> {
        let mirrors: Vec<_> = self.store.snapshot()?.mirrors.into_values().collect();
        for mirror in mirrors {
            if let (Some(room), Some(member)) = (&mirror.source.room_id, &mirror.recipient.member_id) {
                if let Some(actor) = &mirror.withdrawn_by {
                    self.rooms.inbox_withdraw(room, &mirror.source.message_id, member, actor)?;
                } else {
                    self.rooms.inbox_delivery(room, &mirror.source.message_id, member, mirror.submitted)?;
                }
            } else {
                self.board
                    .inbox_delivery(&mirror.source.message_id, &mirror.batch_id, mirror.submitted)
                    .map_err(AppError::io)?;
            }
            self.store.edit(|data| {
                if data
                    .mirrors
                    .get(&mirror.entry_id)
                    .is_some_and(|current| current.batch_id == mirror.batch_id && current.submitted == mirror.submitted)
                {
                    data.mirrors.remove(&mirror.entry_id);
                }
                Ok(())
            })?;
        }
        Ok(())
    }
    fn read_context(&self) -> Result<(Data, source::Snapshot, Option<String>), AppError> {
        let (rooms, room_revision, room_error) = self.rooms.inbox_snapshot()?;
        let (tasks, task_revision, task_error) = self.board.inbox_snapshot();
        let mut error = self
            .store
            .error()
            .or(room_error)
            .or(task_error)
            .or_else(|| self.sync_error.lock().ok().and_then(|e| e.clone()));
        let data = self.store.snapshot().unwrap_or_else(|e| {
            error = Some(e.message);
            Data::default()
        });
        let tasks = tasks.into_iter().map(|task| (task.id.clone(), task)).collect();
        let mut snapshot = source::snapshot(
            &rooms,
            &tasks,
            &self.registry,
            room_revision
                .saturating_add(task_revision)
                .saturating_add(self.registry.revision())
                .saturating_add(self.gate.revision()),
        );
        snapshot.native_unready =
            self.registry.all().iter().filter(|s| !self.gate.ready_tab(&s.tab_id)).map(|s| s.tab_id.clone()).collect();
        Ok((data, snapshot, error))
    }
    pub(crate) fn sessions(&self, project_root: &str, room_id: Option<&str>) -> Result<SessionsView, AppError> {
        let (data, sources, error) = self.read_context()?;
        Ok(read::sessions(project_root, room_id, &data, &sources, &self.registry, error))
    }
    pub(crate) fn messages(
        &self,
        key: &str,
        room: Option<&str>,
        cursor: Option<&str>,
        limit: Option<usize>,
        message: Option<&str>,
    ) -> Result<MessagesView, AppError> {
        let (data, sources, error) = self.read_context()?;
        read::messages(key, room, cursor, limit, message, &data, &sources, &self.registry, error)
    }
    pub(crate) fn pending(&self) -> Result<Pending, AppError> {
        let (mut data, sources, error) = self.read_context()?;
        if let Some(error) = error {
            return Err(AppError::io(error));
        }
        let revision = data.revision.saturating_add(sources.revision);
        source::merge(&mut data, &sources);
        let mut recipients: std::collections::BTreeMap<String, PendingRecipient> = Default::default();
        for entry in
            data.entries.values().filter(|e| e.view.class != MessageClass::Fyi && pending(&e.view.delivery_phase))
        {
            let r = &entry.view.recipient;
            recipients
                .entry(r.session_key.clone())
                .or_insert_with(|| PendingRecipient {
                    session_key: r.session_key.clone(),
                    tab_id: r.tab_id.clone(),
                    project_root: r.project_root.clone(),
                    pending_count: 0,
                })
                .pending_count += 1;
        }
        Ok(Pending { revision, recipients: recipients.into_values().collect() })
    }
    fn target_root(&self, tab: &str) -> Result<String, AppError> {
        self.registry
            .find(tab)
            .and_then(|s| s.project_root)
            .filter(|root| !root.is_empty())
            .map(|root| source::normalize_root(&root))
            .ok_or_else(|| AppError::conflict("Target project is unavailable"))
    }
    pub(crate) fn bind(&self, request: &BindRequest) -> Result<Binding, AppError> {
        let root = self.target_root(&request.tab_id)?;
        self.gate.bind(request, std::path::Path::new(&root))
    }
    pub(crate) fn offer(&self, request: &OfferRequest) -> Result<Offer, AppError> {
        self.gate.offer(request, now())
    }
    pub(crate) fn revoke(&self, offer: &Offer) {
        self.gate.revoke(offer);
    }
    pub(crate) fn prepare(&self, request: &PrepareRequest) -> Result<PrepareResult, AppError> {
        let root = self.target_root(&request.offer.binding.tab_id)?;
        if source::session_key(&root, &request.offer.binding.tab_id) != request.session_key
            || !self.gate.owns_project(&request.offer.binding, std::path::Path::new(&root))
        {
            return Err(AppError::conflict("Input offer belongs to another project"));
        }
        self.with_sources(|sources| {
            self.store.edit(|data| {
                source::merge(data, sources);
                let operation = format!("prepare:{}:{}", request.session_key, request.operation_id);
                if !data.batches.values().any(|batch| batch.operation_id == operation)
                    && !self.gate.check(&request.offer, now())
                {
                    return Ok(PrepareResult { batch: None, blocker: Some(Status::new("target_changed")) });
                }
                scheduler::prepare(data, sources, &self.registry, request, now())
            })
        })
    }
    pub(crate) fn begin(&self, request: &BeginRequest) -> Result<BeginResult, AppError> {
        self.with_sources(|sources| {
            self.store.edit_after(
                |data| {
                    source::merge(data, sources);
                    Ok(scheduler::begin(
                        data,
                        sources,
                        &self.registry,
                        request,
                        now(),
                        self.gate.check(&request.offer, now()),
                    ))
                },
                |result| {
                    let batch = result?;
                    let guard =
                        self.gate.authorize(&request.offer, &batch.id, &batch.attempt_id, &batch.payload, now())?;
                    Ok(BeginResult { batch, write_guard: guard })
                },
            )
        })
    }
    pub(crate) fn receipt(&self, request: &ReceiptRequest) -> Result<BatchView, AppError> {
        let batch = self.store.edit_after(
            |data| {
                let evidence = data.batches.get(&request.batch_id).is_some_and(|batch| {
                    self.gate.valid_attempt(&batch.view.terminal_session_id, &batch.view.id, &batch.view.target_epoch)
                        && self.gate.has_written(&batch.view.terminal_session_id, &batch.view.id)
                });
                scheduler::receipt(data, request, evidence)
            },
            |batch| {
                self.gate.finish(&batch.terminal_session_id, &batch.id);
                Ok(batch)
            },
        )?;
        if let Err(error) = self.flush_mirrors() {
            *self.sync_error.lock().unwrap() = Some(error.message);
        }
        Ok(batch)
    }
    pub(crate) fn abort_prepared(&self, request: &BatchRequest) -> Result<BatchView, AppError> {
        self.store.edit(|data| {
            let current =
                data.batches.get(&request.batch_id).ok_or_else(|| AppError::not_found("Batch was not found"))?;
            if current.view.phase == "aborted" && current.view.attempt_id == request.attempt_id {
                return Ok(current.view.clone());
            }
            scheduler::cas(&current.view, request)?;
            if current.view.phase != "prepared" {
                return Err(AppError::conflict("Submission intent exists; report uncertainty instead of requeueing"));
            }
            abort(data, &request.batch_id);
            Ok(data.batches[&request.batch_id].view.clone())
        })
    }
    pub(crate) fn batch(&self, id: &str) -> Result<BatchView, AppError> {
        self.store
            .snapshot()?
            .batches
            .get(id)
            .map(|batch| batch.view.clone())
            .ok_or_else(|| AppError::not_found("Batch was not found"))
    }
    pub(crate) fn resolve(&self, request: &ResolveRequest) -> Result<BatchView, AppError> {
        let batch = self.store.edit_after(
            |data| scheduler::resolve(data, request),
            |batch| {
                self.gate.finish(&batch.terminal_session_id, &batch.id);
                Ok(batch)
            },
        )?;
        if let Err(error) = self.flush_mirrors() {
            *self.sync_error.lock().unwrap() = Some(error.message);
        }
        Ok(batch)
    }
}
