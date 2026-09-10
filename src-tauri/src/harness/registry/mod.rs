pub mod commands;
mod install;
mod launch;
mod owner;
mod store;
mod types;
use owner::RegistryOwner;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use store::RegistryStore;
pub use types::*;
const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");
const HISTORY_LIMIT: usize = 100;
type AuditSink = Arc<dyn Fn(RegistryAudit) + Send + Sync>;

pub struct SystemRegistry {
    store: RegistryStore,
    state: Mutex<RegistryState>,
    init_error: Option<RegistryError>,
    audit: AuditSink,
    imports: Mutex<HashMap<String, install::PendingInstall>>,
}
impl SystemRegistry {
    pub fn new(path: PathBuf, audit: impl Fn(RegistryAudit) + Send + Sync + 'static) -> Self {
        let store = RegistryStore::new(path);
        let loaded = store.load();
        let recovery_error = loaded
            .as_ref()
            .ok()
            .and_then(|state| SystemRegistry::recover_install_state(store.path(), state).err());
        let init_error = loaded.as_ref().err().cloned().or(recovery_error);
        Self {
            store,
            state: Mutex::new(loaded.unwrap_or_default()),
            init_error,
            audit: Arc::new(audit),
            imports: Mutex::new(HashMap::new()),
        }
    }
    pub fn list(&self) -> RegistryResult<RegistryState> {
        self.ensure_ready()?;
        let disk = self.store.load()?;
        *self.state.lock().unwrap() = disk.clone();
        Ok(disk)
    }
    pub fn discover(&self) -> RegistryResult<Vec<PluginDefinition>> {
        Ok(self.list()?.plugins.into_iter().filter(runnable).collect())
    }
    pub fn install(
        &self,
        expected: &str,
        plugin: PluginDefinition,
    ) -> RegistryResult<RegistryState> {
        let id = plugin.plugin_id.clone();
        self.mutate(expected, "install", Some(&id), |state| {
            if state
                .plugins
                .iter()
                .any(|item| item.plugin_id == plugin.plugin_id)
            {
                return Err(RegistryError::new(
                    "PLUGIN_EXISTS",
                    "plugin is already installed",
                ));
            }
            state.plugins.push(plugin);
            Ok(())
        })
    }
    pub fn update(
        &self,
        expected: &str,
        plugin: PluginDefinition,
    ) -> RegistryResult<RegistryState> {
        let id = plugin.plugin_id.clone();
        self.mutate(expected, "update", Some(&id), |state| {
            let current = state
                .plugins
                .iter_mut()
                .find(|item| item.plugin_id == plugin.plugin_id)
                .ok_or_else(|| RegistryError::new("PLUGIN_NOT_FOUND", "plugin is not installed"))?;
            state.history.push(current.clone());
            *current = plugin;
            trim_history(state);
            Ok(())
        })
    }
    pub fn disable(&self, expected: &str, plugin_id: &str) -> RegistryResult<RegistryState> {
        self.mutate(expected, "disable", Some(plugin_id), |state| {
            let plugin = state
                .plugins
                .iter_mut()
                .find(|item| item.plugin_id == plugin_id)
                .ok_or_else(|| RegistryError::new("PLUGIN_NOT_FOUND", "plugin is not installed"))?;
            plugin.enabled = false;
            Ok(())
        })
    }
    pub fn uninstall(&self, expected: &str, plugin_id: &str) -> RegistryResult<RegistryState> {
        self.mutate(expected, "uninstall", Some(plugin_id), |state| {
            let index = state
                .plugins
                .iter()
                .position(|item| item.plugin_id == plugin_id)
                .ok_or_else(|| RegistryError::new("PLUGIN_NOT_FOUND", "plugin is not installed"))?;
            state.history.push(state.plugins.remove(index));
            trim_history(state);
            for session in &mut state.sessions {
                if session.plugin.plugin_id == plugin_id {
                    session.resumable = false;
                }
            }
            Ok(())
        })
    }
    pub fn snapshot(
        &self,
        session_id: String,
        agent_id: String,
        plugin_id: &str,
        worker_id: String,
        project_root: String,
    ) -> RegistryResult<SessionSnapshot> {
        let plugin = self
            .discover()?
            .into_iter()
            .find(|item| item.plugin_id == plugin_id)
            .ok_or_else(|| RegistryError::new("PLUGIN_UNAVAILABLE", "plugin is not runnable"))?;
        self.persist_session(SessionSnapshot {
            session_id,
            agent_id,
            plugin,
            worker_id,
            project_root,
            grants: vec![],
            cancelled: false,
            resumable: true,
        })
    }
    pub fn authorize(
        &self,
        session_id: &str,
        grants: Vec<String>,
    ) -> RegistryResult<SessionSnapshot> {
        self.change_session(session_id, |session| session.grants = grants)
    }
    pub fn session(&self, session_id: &str) -> Option<SessionSnapshot> {
        self.list()
            .ok()?
            .sessions
            .into_iter()
            .find(|item| item.session_id == session_id)
    }
    pub fn cancel_session(&self, session_id: &str) -> RegistryResult<SessionSnapshot> {
        self.change_session(session_id, |session| session.cancelled = true)
    }
    fn mutate(
        &self,
        expected: &str,
        action: &str,
        plugin_id: Option<&str>,
        apply: impl FnOnce(&mut RegistryState) -> RegistryResult<()>,
    ) -> RegistryResult<RegistryState> {
        self.ensure_ready()?;
        let _owner = RegistryOwner::acquire(self.store.path())?;
        let mut next = self.store.load()?;
        if next.revision != expected {
            return Err(RegistryError::new(
                "REVISION_CONFLICT",
                "registry revision is stale",
            ));
        }
        apply(&mut next)?;
        next.revision = increment(&next.revision)?;
        self.commit(&next)?;
        (self.audit)(RegistryAudit {
            action: action.into(),
            plugin_id: plugin_id.map(str::to_owned),
            revision: next.revision.clone(),
            summary: "registry changed".into(),
        });
        Ok(next)
    }
    fn persist_session(&self, snapshot: SessionSnapshot) -> RegistryResult<SessionSnapshot> {
        self.ensure_ready()?;
        let _owner = RegistryOwner::acquire(self.store.path())?;
        let mut state = self.store.load()?;
        if state
            .sessions
            .iter()
            .any(|item| item.session_id == snapshot.session_id)
        {
            return Err(RegistryError::new(
                "SESSION_EXISTS",
                "session snapshot already exists",
            ));
        }
        state.sessions.push(snapshot.clone());
        state.revision = increment(&state.revision)?;
        self.commit(&state)?;
        Ok(snapshot)
    }
    fn change_session(
        &self,
        id: &str,
        change: impl FnOnce(&mut SessionSnapshot),
    ) -> RegistryResult<SessionSnapshot> {
        self.ensure_ready()?;
        let _owner = RegistryOwner::acquire(self.store.path())?;
        let mut state = self.store.load()?;
        let session = state
            .sessions
            .iter_mut()
            .find(|item| item.session_id == id)
            .ok_or_else(|| RegistryError::new("SESSION_NOT_FOUND", "session not found"))?;
        change(session);
        let result = session.clone();
        state.revision = increment(&state.revision)?;
        self.commit(&state)?;
        Ok(result)
    }
    fn commit(&self, state: &RegistryState) -> RegistryResult<()> {
        self.store.save(state)?;
        *self.state.lock().unwrap() = state.clone();
        Ok(())
    }
    fn ensure_ready(&self) -> RegistryResult<()> {
        self.init_error.clone().map_or(Ok(()), Err)
    }
}
fn runnable(plugin: &PluginDefinition) -> bool {
    plugin.trusted
        && plugin.enabled
        && plugin.harness_api == 1
        && version_at_least(HOST_VERSION, &plugin.min_app_version)
}
fn version_at_least(host: &str, minimum: &str) -> bool {
    matches!((semver(host), semver(minimum)), (Some(host), Some(minimum)) if host >= minimum)
}
fn semver(value: &str) -> Option<(u32, u32, u32)> {
    let core = value.split_once('-').map_or(value, |parts| parts.0);
    let mut p = core.split('.');
    let result = (
        p.next()?.parse().ok()?,
        p.next()?.parse().ok()?,
        p.next()?.parse().ok()?,
    );
    if p.next().is_none() {
        Some(result)
    } else {
        None
    }
}
fn increment(value: &str) -> RegistryResult<String> {
    value
        .parse::<u64>()
        .ok()
        .and_then(|v| v.checked_add(1))
        .map(|v| v.to_string())
        .ok_or_else(|| RegistryError::new("REVISION_EXHAUSTED", "registry revision is invalid"))
}
fn trim_history(state: &mut RegistryState) {
    if state.history.len() > HISTORY_LIMIT {
        state.history.drain(..state.history.len() - HISTORY_LIMIT);
    }
}
#[cfg(test)]
mod install_tests;
#[cfg(test)]
mod tests;
