use super::super::{AgentAccess, Service, connections::ScopedConnections, tools};
use crate::a2a::{
    A2aRuntime, connections::ConnectionSource, platform, requests::Owner, store::Store,
};
use crate::{
    agent::AgentKind,
    collab::{SessionRegistry, SessionSnapshot, TaskBoard, inbox::InboxService},
    plugins::agent_connection::AuthorizedAgent,
    provider::store::secrets::{KeyStore, MasterKey},
    rooms::{RoomStore, ops},
    terminal::{AppError, input_gate::InputGate},
};
use belfry_protocol::inbox::*;
use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::async_runtime::block_on;

#[derive(Default)]
pub(super) struct Access(
    pub Mutex<Vec<AuthorizedAgent>>,
    pub std::sync::atomic::AtomicBool,
);
impl AgentAccess for Access {
    fn snapshot(&self) -> Result<Vec<AuthorizedAgent>, AppError> {
        if self.1.load(std::sync::atomic::Ordering::Acquire) {
            return Err(AppError::io("synthetic authorization snapshot failure"));
        }
        Ok(self.0.lock().unwrap().clone())
    }
}
#[derive(Default)]
struct Keys(Mutex<Option<MasterKey>>);
impl KeyStore for Keys {
    fn read(&self) -> Result<Option<MasterKey>, AppError> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn create(&self, key: &MasterKey) -> Result<(), AppError> {
        *self.0.lock().unwrap() = Some(key.clone());
        Ok(())
    }
}
pub(super) struct Rig {
    pub root: PathBuf,
    pub project: String,
    pub ready: PathBuf,
    pub links: PathBuf,
    pub service: Arc<Service>,
    pub access: Arc<Access>,
    pub a: AuthorizedAgent,
    pub b: AuthorizedAgent,
    pub c: AuthorizedAgent,
    pub runtime: Arc<A2aRuntime>,
    pub store: Store,
    pub gate: Arc<InputGate>,
    pub client: reqwest::Client,
}
impl Rig {
    pub fn new() -> Self {
        Self::with_inbox(true)
    }
    pub fn with_inbox(active: bool) -> Self {
        let root =
            std::env::temp_dir().join(format!("belfry-local-a2a-{}", ulid::Ulid::generate()));
        fs::create_dir_all(root.join("project")).unwrap();
        let project = crate::resource::canonicalize(&root.join("project"))
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let owner = |tab: &str, agent| AuthorizedAgent {
            root: project.clone(),
            ticket: format!("synthetic-ticket-{tab}"),
            terminal_id: format!("synthetic-pty-{tab}"),
            tab_id: tab.into(),
            agent,
        };
        let a = owner("a", AgentKind::Codex);
        let b = owner("b", AgentKind::Claude);
        let c = owner("c", AgentKind::Codex);
        let access = Arc::new(Access(
            Mutex::new(vec![a.clone(), b.clone(), c.clone()]),
            std::sync::atomic::AtomicBool::new(false),
        ));
        let registry = Arc::new(SessionRegistry::default());
        registry.replace([&a, &b, &c].into_iter().map(session).collect());
        let board = Arc::new(TaskBoard::load(Some(root.join("board"))));
        let rooms = Arc::new(RoomStore::load(Some(root.join("rooms"))));
        let gate = Arc::new(InputGate::default());
        for owner in [&a, &b, &c] {
            gate.register(
                &owner.terminal_id,
                Some(owner.tab_id.clone()),
                PathBuf::from(&project),
            );
            gate.observe_output(&owner.terminal_id, 1, b"\x1b[?2004h");
        }
        let inbox = Arc::new(InboxService::load(
            Some(root.join("inbox")),
            rooms.clone(),
            board.clone(),
            registry.clone(),
            gate.clone(),
        ));
        if active {
            inbox.activate("synthetic-activation".into(), true).unwrap();
        }
        let ready = root.join("local-ready.json");
        let links = root.join("local-links.json");
        let service = Service::start(
            access.clone(),
            registry,
            board,
            rooms,
            inbox,
            super::super::ReadyMarks::load(Some(ready.clone())),
            super::super::LinkPreviews::load(Some(links.clone())),
        )
        .unwrap();
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let store = Store::synthetic(root.join("client-store"), Arc::new(Keys::default()));
        Self {
            root,
            project,
            ready,
            links,
            service,
            access,
            a,
            b,
            c,
            runtime: Arc::new(A2aRuntime::with_timeout(Duration::from_secs(5))),
            store,
            gate,
            client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap(),
        }
    }
    pub fn connections<'a>(&'a self, owner: &'a AuthorizedAgent) -> ScopedConnections<'a> {
        ScopedConnections {
            store: &self.store,
            service: Some(self.service.clone()),
            owner,
        }
    }
    pub fn local(
        &self,
        owner: &AuthorizedAgent,
        api: &str,
        args: Value,
    ) -> Result<Value, AppError> {
        tools::dispatch(
            &self.service,
            &self.runtime,
            &self.connections(owner),
            owner,
            &args,
            api,
        )
    }
    pub fn api(&self, owner: &AuthorizedAgent, api: &str, args: Value) -> Result<Value, AppError> {
        platform::dispatch_source(
            &self.runtime,
            &self.connections(owner),
            &Owner::agent(owner.root.clone(), owner.ticket.clone()),
            &json!({"args":[args]}),
            api,
        )
    }
    pub fn ready(&self, owner: &AuthorizedAgent) {
        assert_eq!(
            self.local(owner, "a2a.localReady", json!({})).unwrap()["ready"],
            true
        );
    }
    pub fn ready_pair(&self) {
        self.ready(&self.a);
        self.ready(&self.b);
    }
    pub fn connection(&self, sender: &AuthorizedAgent, target: &AuthorizedAgent) -> String {
        self.service
            .connections(sender)
            .unwrap()
            .into_iter()
            .find(|info| {
                info.local
                    .as_ref()
                    .is_some_and(|local| local.tab_id == target.tab_id)
            })
            .unwrap()
            .id
    }
    pub fn send(
        &self,
        sender: &AuthorizedAgent,
        target: &AuthorizedAgent,
        text: &str,
    ) -> Result<Value, AppError> {
        self.api(
            sender,
            "a2a.sendMessage",
            json!({"connectionId":self.connection(sender,target),"requestId":op(),"text":text}),
        )
    }
    pub fn assigned(&self, owner: &AuthorizedAgent) -> Value {
        self.local(owner, "a2a.localTasks", json!({})).unwrap()["tasks"][0].clone()
    }
    pub fn report(
        &self,
        owner: &AuthorizedAgent,
        task: &Value,
        state: &str,
        text: &str,
    ) -> Result<Value, AppError> {
        self.local(owner,"a2a.localReport",json!({"reportHandle":task["reportHandle"],"generation":task["generation"],"state":state,"text":text,"operationId":op()}))
    }
    pub fn rpc(
        &self,
        sender: &AuthorizedAgent,
        target: &AuthorizedAgent,
        method: &str,
        params: Value,
    ) -> Value {
        let connection = self
            .connections(sender)
            .resolve(&sender.root, &self.connection(sender, target))
            .unwrap();
        let url = connection.info.interface_url.unwrap();
        block_on(async {
            let reply = self
                .client
                .post(url)
                .bearer_auth(connection.secret.as_ref().unwrap().as_str())
                .header("A2A-Version", "1.0")
                .header("Content-Type", "application/json")
                .body(
                    json!({"jsonrpc":"2.0","id":"local-test","method":method,"params":params})
                        .to_string(),
                )
                .send()
                .await
                .unwrap();
            assert!(reply.status().is_success());
            serde_json::from_slice(&reply.bytes().await.unwrap()).unwrap()
        })
    }
    pub fn room(&self, name: &str) -> String {
        let room = self
            .service
            .rooms
            .create(name, &self.project, "Synthetic local collaboration")
            .unwrap();
        self.service
            .rooms
            .mutate(&room.id, |room| {
                ops::add_member(
                    room,
                    &self.a.tab_id,
                    self.a.agent.id(),
                    "lead",
                    "coordinate",
                    false,
                    0,
                )?;
                ops::add_member(
                    room,
                    &self.b.tab_id,
                    self.b.agent.id(),
                    "worker",
                    "implement",
                    false,
                    0,
                )?;
                let delivered = room
                    .all_messages()
                    .flat_map(|message| {
                        message
                            .to
                            .iter()
                            .map(move |member| (message.id.clone(), member.clone()))
                    })
                    .collect::<Vec<_>>();
                for (message, member) in delivered {
                    ops::record_delivery(room, &message, &member, 0);
                }
                room.delivery_outbox.clear();
                Ok(())
            })
            .unwrap();
        room.id
    }
    pub fn prepare(&self, owner: &AuthorizedAgent) -> (Offer, BatchView) {
        // Sources debounce for 350ms. Only this fixture waits for their native
        // scheduler, then uses the real prepare/begin/input-guard APIs.
        thread::sleep(Duration::from_millis(550));
        let binding = self
            .service
            .inbox
            .bind(&BindRequest {
                tab_id: owner.tab_id.clone(),
                terminal_session_id: owner.terminal_id.clone(),
                owner_id: "synthetic-ui".into(),
            })
            .unwrap();
        let offer = self
            .service
            .inbox
            .offer(&OfferRequest {
                binding,
                offer_id: op(),
                running: true,
                idle: true,
                composer_empty: true,
                awaiting_input: false,
                prompt_queue_empty: true,
            })
            .unwrap();
        let session_key = self
            .service
            .inbox
            .sessions(&owner.root, None)
            .unwrap()
            .sessions
            .into_iter()
            .find(|session| session.tab_id == owner.tab_id)
            .unwrap()
            .session_key;
        let prepared = self
            .service
            .inbox
            .prepare(&PrepareRequest {
                session_key,
                offer: offer.clone(),
                operation_id: op(),
            })
            .unwrap();
        assert!(prepared.batch.is_some(), "blocked: {:?}", prepared.blocker);
        (offer, prepared.batch.unwrap())
    }
    pub fn begin(&self, offer: Offer, batch: &BatchView) -> BeginResult {
        self.service
            .inbox
            .begin(&BeginRequest {
                batch: BatchRequest {
                    batch_id: batch.id.clone(),
                    attempt_id: batch.attempt_id.clone(),
                    expected_revision: batch.revision,
                },
                offer,
            })
            .unwrap()
    }
    pub fn finish(&self, begin: &BeginResult) -> (BatchView, Vec<u8>) {
        let bytes = Mutex::new(Vec::new());
        let paste = format!("\x1b[200~{}\x1b[201~", begin.batch.payload).into_bytes();
        self.gate
            .guarded_write(
                &begin.batch.terminal_session_id,
                &begin.write_guard,
                1,
                &paste,
                || {
                    bytes.lock().unwrap().extend_from_slice(&paste);
                    Ok(())
                },
            )
            .unwrap();
        self.gate
            .guarded_write(
                &begin.batch.terminal_session_id,
                &begin.write_guard,
                2,
                b"\r",
                || {
                    bytes.lock().unwrap().push(b'\r');
                    Ok(())
                },
            )
            .unwrap();
        let receipt = self
            .service
            .inbox
            .receipt(&ReceiptRequest {
                batch_id: begin.batch.id.clone(),
                attempt_id: begin.batch.attempt_id.clone(),
                sequence: begin.batch.sequence + 1,
                phase: "submitted".into(),
                payload_hash: begin.batch.payload_hash.clone(),
                message: None,
            })
            .unwrap();
        (receipt, bytes.into_inner().unwrap())
    }
}
impl Drop for Rig {
    fn drop(&mut self) {
        self.service.stop();
        self.runtime.stop();
        let _ = fs::remove_dir_all(&self.root);
    }
}
pub(super) fn session(owner: &AuthorizedAgent) -> SessionSnapshot {
    SessionSnapshot {
        tab_id: owner.tab_id.clone(),
        name: Some(format!("synthetic-{}", owner.tab_id)),
        title: "Fixture".into(),
        agent: owner.agent.id().into(),
        activity: "idle".into(),
        can_receive: true,
        project_root: Some(owner.root.clone()),
    }
}
pub(super) fn op() -> String {
    ulid::Ulid::generate().to_string().to_lowercase()
}
pub(super) fn code(error: &AppError) -> &str {
    error.code.0.as_ref()
}
pub(super) fn wait_for(predicate: impl Fn() -> bool) {
    let started = Instant::now();
    while !predicate() {
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "Local task was not accepted in time"
        );
        thread::sleep(Duration::from_millis(5));
    }
}
pub(super) fn message(text: &str) -> Value {
    json!({"messageId":op(),"role":"ROLE_USER","parts":[{"text":text}]})
}
