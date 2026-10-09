//! Version-2 provider metadata plus an OS-key-protected, authenticated local vault.
//! Callers hold `lock()` across the entire load/modify/apply/save operation. These
//! functions deliberately do not reacquire it. Runtime stores are NOT serializable.
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use super::contracts::{AgentProviders, ProviderConfig};
use crate::agent::AgentKind;
use crate::terminal::AppError;

#[path = "migration.rs"]
mod migration;
#[path = "secrets.rs"]
mod secrets;
use migration::{Metadata, MetadataAgent, MetadataProvider, Parsed};
use secrets::{KeyStore, NativeKeyStore, unavailable};

const FILE: &str = "providers.json";
const VAULT_DIR: &str = "provider-vault";
const VERSION: u32 = 2;
static STORE_LOCK: Mutex<()> = Mutex::new(());

pub(super) fn lock() -> Result<MutexGuard<'static, ()>, AppError> {
    STORE_LOCK
        .lock()
        .map_err(|_| AppError::io("Provider 操作中断；请重启应用后重试。"))
}

/// Stable storage names, deliberately independent of CLI executable names.
pub(super) fn storage_key(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Codex => "codex",
        AgentKind::Claude => "claude",
        AgentKind::Pi => "pi",
    }
}

#[derive(Clone, Default)]
struct References {
    vault: Option<String>,
    api_keys: BTreeMap<(String, String), String>,
    official: Option<String>,
}

#[derive(Clone)]
pub(super) struct StoreFile {
    pub version: u32,
    pub agents: BTreeMap<String, AgentProviders>,
    /// Hydrated only by resolve_official_auth; None otherwise does NOT mean clear.
    pub codex_official_auth: Option<Value>,
    refs: RefCell<References>,
    official_auth_loaded: bool,
}

// Do not derive Debug: OAuth and pending API key replacements are runtime secrets.
impl std::fmt::Debug for StoreFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoreFile")
            .field("version", &self.version)
            .field("agent_count", &self.agents.len())
            .field("credentials", &"[REDACTED]")
            .finish()
    }
}

impl Default for StoreFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            agents: BTreeMap::new(),
            codex_official_auth: None,
            refs: RefCell::new(References::default()),
            official_auth_loaded: false,
        }
    }
}

impl StoreFile {
    pub fn agent(&self, kind: AgentKind) -> AgentProviders {
        self.agents
            .get(storage_key(kind))
            .cloned()
            .unwrap_or_default()
    }
    pub fn agent_mut(&mut self, kind: AgentKind) -> &mut AgentProviders {
        self.agents
            .entry(storage_key(kind).to_string())
            .or_default()
    }
    pub fn has_api_key(&self, kind: AgentKind, id: &str) -> bool {
        self.agents
            .get(storage_key(kind))
            .and_then(|a| a.find(id))
            .is_some_and(|p| {
                !p.api_key.is_empty()
                    || self
                        .refs
                        .borrow()
                        .api_keys
                        .contains_key(&(storage_key(kind).into(), id.into()))
            })
    }
    /// Explicit clear. Caller must also empty any pending ProviderConfig.api_key.
    pub fn clear_api_key(&mut self, kind: AgentKind, id: &str) {
        self.refs
            .get_mut()
            .api_keys
            .remove(&(storage_key(kind).into(), id.into()));
    }
    pub fn resolve_provider(
        &self,
        app: &AppHandle,
        kind: AgentKind,
        id: &str,
    ) -> Result<ProviderConfig, AppError> {
        let (fs, keys) = backend(app)?;
        self.resolve_with(
            &Engine {
                fs: &fs,
                keys: &keys,
            },
            kind,
            id,
        )
    }
    fn resolve_with(
        &self,
        engine: &Engine<'_>,
        kind: AgentKind,
        id: &str,
    ) -> Result<ProviderConfig, AppError> {
        let agent = storage_key(kind);
        let mut provider = self
            .agents
            .get(agent)
            .and_then(|a| a.find(id))
            .cloned()
            .ok_or_else(|| AppError::invalid_argument("Provider 不存在。"))?;
        // Availability is checked even for pending replacements, so a lost old
        // vault can never be silently replaced by the newly typed credential.
        let payload = engine.available(self)?;
        if provider.api_key.is_empty() {
            if let Some(reference) = self.refs.borrow().api_keys.get(&(agent.into(), id.into())) {
                provider.api_key = payload.api_key(reference, agent, id)?.to_owned();
            }
        }
        Ok(provider)
    }
    pub fn resolve_official_auth(&mut self, app: &AppHandle) -> Result<(), AppError> {
        let (fs, keys) = backend(app)?;
        self.resolve_official_with(&Engine {
            fs: &fs,
            keys: &keys,
        })
    }
    fn resolve_official_with(&mut self, engine: &Engine<'_>) -> Result<(), AppError> {
        if self.official_auth_loaded {
            return Ok(());
        }
        let payload = engine.available(self)?;
        // Preserve a freshly captured backup instead of overwriting it.
        if self.codex_official_auth.is_none() {
            if let Some(reference) = &self.refs.borrow().official {
                self.codex_official_auth = Some(payload.official(reference)?.clone());
            }
        }
        self.official_auth_loaded = true;
        Ok(())
    }

    /// Commit an OAuth backup before touching external auth.json, without committing
    /// pending selections/providers. The caller holds the same full-operation lock.
    pub fn persist_official_backup(
        &mut self,
        app: &AppHandle,
        backup: &Option<Value>,
    ) -> Result<(), AppError> {
        let (fs, keys) = backend(app)?;
        self.persist_official_backup_with(
            &Engine {
                fs: &fs,
                keys: &keys,
            },
            backup,
        )
    }

    fn persist_official_backup_with(
        &mut self,
        engine: &Engine<'_>,
        backup: &Option<Value>,
    ) -> Result<(), AppError> {
        if self.version != VERSION {
            return Err(migration::invalid());
        }
        // Require the caller's generation to still be current. Only this backup
        // commit may advance it; never rebase an arbitrary stale pending mutation.
        let mut durable = engine
            .current(self, false)?
            .map(Metadata::into_runtime)
            .unwrap_or_default();
        durable.codex_official_auth = backup.clone();
        durable.official_auth_loaded = true; // explicit None means clear
        engine.save(&durable, false)?;

        let committed = durable.refs.into_inner();
        let refs = self.refs.get_mut();
        refs.vault = committed.vault;
        refs.official = committed.official;
        // Do NOT replace api_keys or agents: pending clear/add/import/edit state
        // must survive while old currentId remains on disk until the final save.
        self.codex_official_auth = backup.clone();
        self.official_auth_loaded = true;
        Ok(())
    }
}

fn backend(app: &AppHandle) -> Result<(LocalFiles, NativeKeyStore), AppError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::io("找不到应用数据目录。"))?;
    let keys = NativeKeyStore::for_directory(&base);
    Ok((LocalFiles(base), keys))
}

pub(super) fn load(app: &AppHandle) -> Result<StoreFile, AppError> {
    let (fs, keys) = backend(app)?;
    Engine {
        fs: &fs,
        keys: &keys,
    }
    .load()
}

pub(super) fn save(app: &AppHandle, store: &StoreFile) -> Result<(), AppError> {
    let (fs, keys) = backend(app)?;
    Engine {
        fs: &fs,
        keys: &keys,
    }
    .save(store, false)
}

/// Before writing ANY external CLI configuration. Does not acquire the store lock.
pub(super) fn ensure_available(app: &AppHandle, store: &StoreFile) -> Result<(), AppError> {
    let (fs, keys) = backend(app)?;
    Engine {
        fs: &fs,
        keys: &keys,
    }
    .available(store)
    .map(|_| ())
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Secret {
    ApiKey {
        agent: String,
        provider: String,
        value: String,
    },
    OfficialAuth {
        value: Value,
    },
}
#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    secrets: BTreeMap<String, Secret>,
}
impl Payload {
    fn api_key(&self, reference: &str, agent: &str, id: &str) -> Result<&str, AppError> {
        match self.secrets.get(reference) {
            Some(Secret::ApiKey {
                agent: a,
                provider,
                value,
            }) if a == agent && provider == id && !value.is_empty() => Ok(value),
            _ => Err(unavailable()),
        }
    }
    fn official(&self, reference: &str) -> Result<&Value, AppError> {
        match self.secrets.get(reference) {
            Some(Secret::OfficialAuth { value }) if value.is_object() => Ok(value),
            _ => Err(unavailable()),
        }
    }
    fn verify(&self, metadata: &Metadata) -> Result<(), AppError> {
        for (name, agent) in &metadata.agents {
            for p in &agent.providers {
                if let Some(r) = &p.api_key_ref {
                    self.api_key(r, name, &p.id)?;
                }
            }
        }
        if let Some(r) = &metadata.codex_official_auth_ref {
            self.official(r)?;
        }
        Ok(())
    }
}

/// Dependency seam: deterministic tests never consult the real filesystem or OS keychain.
trait Files {
    fn read(&self, name: &str) -> Result<Option<Vec<u8>>, AppError>;
    /// Success means file contents and its directory entry have been flushed.
    fn write(&self, name: &str, bytes: &[u8]) -> Result<(), AppError>;
    fn vault_files(&self) -> Result<Vec<String>, AppError>;
    fn remove(&self, name: &str) -> Result<(), AppError>;
    /// Reconfirm a visible commit before reclaiming older generations on load.
    fn confirm_commit(&self) -> Result<(), AppError> {
        Ok(())
    }
}
struct LocalFiles(PathBuf);

fn disk_error() -> AppError {
    AppError::io("Provider 安全存储读写失败；请检查磁盘空间和权限后重试。")
}
fn sync_directory(path: &Path) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        std::fs::File::open(path)
            .and_then(|f| f.sync_all())
            .map_err(|_| disk_error())?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

impl Files for LocalFiles {
    fn read(&self, name: &str) -> Result<Option<Vec<u8>>, AppError> {
        match std::fs::read(self.0.join(name)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err(disk_error()),
        }
    }
    fn write(&self, name: &str, bytes: &[u8]) -> Result<(), AppError> {
        let target = self.0.join(name);
        let parent = target.parent().ok_or_else(disk_error)?;
        std::fs::create_dir_all(parent).map_err(|_| disk_error())?;
        // Persist creation of provider-vault itself before committing metadata.
        if parent != self.0 {
            sync_directory(&self.0)?;
        }
        let temp = parent.join(format!(".provider-{}.tmp", secrets::random_id()?));
        let result = (|| {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temp).map_err(|_| disk_error())?;
            file.write_all(bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| disk_error())?;
            drop(file);
            replace_file(&temp, &target)?;
            sync_directory(parent)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        result
    }
    fn vault_files(&self) -> Result<Vec<String>, AppError> {
        let entries = match std::fs::read_dir(self.0.join(VAULT_DIR)) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err(disk_error()),
        };
        let mut names = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|_| disk_error())?;
            let name = entry.file_name().into_string().map_err(|_| disk_error())?;
            names.push(format!("{VAULT_DIR}/{name}"));
        }
        Ok(names)
    }
    fn remove(&self, name: &str) -> Result<(), AppError> {
        std::fs::remove_file(self.0.join(name)).map_err(|_| disk_error())
    }
    fn confirm_commit(&self) -> Result<(), AppError> {
        sync_directory(&self.0)
    }
}

#[cfg(not(target_os = "windows"))]
fn replace_file(from: &Path, to: &Path) -> Result<(), AppError> {
    std::fs::rename(from, to).map_err(|_| disk_error())
}
#[cfg(target_os = "windows")]
fn replace_file(from: &Path, to: &Path) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let from: Vec<_> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<_> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(disk_error())
    } else {
        Ok(())
    }
}

struct Engine<'a> {
    fs: &'a dyn Files,
    keys: &'a dyn KeyStore,
}
fn vault_file(id: &str) -> String {
    format!("{VAULT_DIR}/{id}.vault")
}
impl Engine<'_> {
    fn open(&self, metadata: &Metadata) -> Result<Payload, AppError> {
        let key = secrets::master(self.keys, false)?;
        let bytes = self
            .fs
            .read(&vault_file(&metadata.vault))?
            .ok_or_else(unavailable)?;
        let plain = secrets::decrypt(&key, &metadata.vault, &bytes)?;
        let payload: Payload = serde_json::from_slice(&plain).map_err(|_| unavailable())?;
        payload.verify(metadata)?;
        Ok(payload)
    }
    fn load(&self) -> Result<StoreFile, AppError> {
        let Some(bytes) = self.fs.read(FILE)? else {
            // An interrupted first commit can leave ciphertext. Never generate a
            // replacement key for it, even when the primary is absent.
            if !self.fs.vault_files()?.is_empty() {
                secrets::master(self.keys, false)?;
            }
            return Ok(StoreFile::default());
        };
        let bytes = Zeroizing::new(bytes); // legacy input can contain plaintext
        match migration::parse(&bytes)? {
            Parsed::Legacy(store) => {
                self.save(&store, true)?;
                self.load()
            }
            Parsed::Current(metadata) => {
                self.open(&metadata)?; // fail closed, without hydrating runtime credentials
                self.fs.confirm_commit()?;
                self.cleanup(&metadata.vault);
                Ok(metadata.into_runtime())
            }
        }
    }
    fn current(&self, store: &StoreFile, migrating: bool) -> Result<Option<Metadata>, AppError> {
        let expected = store.refs.borrow().vault.clone();
        match self.fs.read(FILE)? {
            Some(bytes) => match migration::parse(&Zeroizing::new(bytes))? {
                Parsed::Current(metadata) if Some(&metadata.vault) == expected.as_ref() => {
                    Ok(Some(metadata))
                }
                Parsed::Legacy(_) if migrating && expected.is_none() => Ok(None),
                _ => Err(migration::invalid()), // stale store or uncompleted migration
            },
            None if expected.is_none() => Ok(None),
            None => Err(unavailable()),
        }
    }
    fn available(&self, store: &StoreFile) -> Result<Payload, AppError> {
        match self.current(store, false)? {
            Some(metadata) => self.open(&metadata),
            None => {
                secrets::master(self.keys, self.fs.vault_files()?.is_empty())?;
                Ok(Payload::default())
            }
        }
    }
    fn save(&self, store: &StoreFile, migrating: bool) -> Result<(), AppError> {
        if store.version != VERSION {
            return Err(migration::invalid());
        }
        let previous = self.current(store, migrating)?;
        let old = match &previous {
            Some(metadata) => self.open(metadata)?,
            None => Payload::default(),
        };
        let key = secrets::master(
            self.keys,
            previous.is_none() && self.fs.vault_files()?.is_empty(),
        )?;
        let refs = store.refs.borrow().clone();
        let mut payload = Payload::default();
        let mut metadata = Metadata {
            version: VERSION,
            vault: secrets::random_id()?,
            agents: BTreeMap::new(),
            codex_official_auth_ref: None,
        };
        for (name, agent) in &store.agents {
            let mut providers = Vec::new();
            for p in &agent.providers {
                let existing = refs.api_keys.get(&(name.clone(), p.id.clone()));
                let value = if !p.api_key.is_empty() {
                    Some(p.api_key.as_str())
                } else if let Some(r) = existing {
                    Some(old.api_key(r, name, &p.id)?)
                } else {
                    None
                };
                let reference = if let Some(value) = value {
                    let r = match existing {
                        Some(r) => r.clone(),
                        None => secrets::random_id()?,
                    };
                    payload.secrets.insert(
                        r.clone(),
                        Secret::ApiKey {
                            agent: name.clone(),
                            provider: p.id.clone(),
                            value: value.to_owned(),
                        },
                    );
                    Some(r)
                } else {
                    None
                };
                providers.push(MetadataProvider {
                    id: p.id.clone(),
                    name: p.name.clone(),
                    base_url: p.base_url.clone(),
                    model: p.model.clone(),
                    created_at: p.created_at,
                    api_key_ref: reference,
                });
            }
            metadata.agents.insert(
                name.clone(),
                MetadataAgent {
                    providers,
                    current_id: agent.current_id.clone(),
                },
            );
        }
        let official = if store.official_auth_loaded || store.codex_official_auth.is_some() {
            store.codex_official_auth.as_ref()
        } else if let Some(r) = &refs.official {
            Some(old.official(r)?)
        } else {
            None
        };
        if let Some(value) = official {
            if !value.is_object() {
                return Err(migration::invalid());
            }
            let reference = match &refs.official {
                Some(r) => r.clone(),
                None => secrets::random_id()?,
            };
            payload.secrets.insert(
                reference.clone(),
                Secret::OfficialAuth {
                    value: value.clone(),
                },
            );
            metadata.codex_official_auth_ref = Some(reference);
        }
        metadata.validate()?;
        let plain = Zeroizing::new(serde_json::to_vec(&payload).map_err(|_| unavailable())?);
        let ciphertext = secrets::encrypt(&key, &metadata.vault, &plain)?;
        let file = vault_file(&metadata.vault);
        self.fs.write(&file, &ciphertext)?;
        let readback = self.fs.read(&file)?.ok_or_else(unavailable)?;
        let verified = secrets::decrypt(&key, &metadata.vault, &readback)?;
        if *verified != *plain {
            return Err(unavailable());
        }
        // Only this atomic replacement is the commit point. Old generations are
        // untouched on ANY preceding error; retries can still open the old primary.
        let bytes = serde_json::to_vec_pretty(&metadata).map_err(|_| migration::invalid())?;
        self.fs.write(FILE, &bytes)?;
        // Interior state update supports repeated save(&store) without stale refs.
        *store.refs.borrow_mut() = metadata.clone().into_runtime().refs.into_inner();
        self.cleanup(&metadata.vault);
        Ok(())
    }
    fn cleanup(&self, committed: &str) {
        // Best effort ONLY after a verified metadata commit/load. Never delete old
        // referenced ciphertext before commit. Failed deletion is retried next time.
        if let Ok(files) = self.fs.vault_files() {
            let keep = vault_file(committed);
            for file in files {
                let name = file.strip_prefix("provider-vault/").unwrap_or("");
                let owned = name.strip_suffix(".vault").is_some_and(migration::valid_id)
                    || (name.starts_with(".provider-") && name.ends_with(".tmp"));
                if file != keep && owned {
                    let _ = self.fs.remove(&file);
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "store_path_tests.rs"]
mod path_tests;
