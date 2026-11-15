//! Connection metadata is committed only after its independent ciphertext is durable.
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::{
    contracts::*,
    errors::{error, storage},
    validation,
};
use crate::{
    provider::store::secrets::{self, KeyStore, MasterKey, NativeKeyStore},
    terminal::AppError,
};

const SERVICE: &str = "app.belfry.a2a-vault.v1";
const MAGIC: &[u8] = b"BELFRY-A2A-VAULT\x01";
const FILE: &str = "connections.json";
const MAX_METADATA: usize = 1024 * 1024;
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone)]
pub(super) struct Store {
    base: PathBuf,
    keys: Arc<dyn KeyStore + Send + Sync>,
}

// Never implement Debug or Serialize on a hydrated connection.
#[derive(Clone)]
pub(super) struct Resolved {
    pub info: ConnectionInfo,
    pub secret: Option<Zeroizing<String>>,
    pub credential_origin: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    #[serde(flatten)]
    info: ConnectionInfo,
    credential_origin: String,
    credential_ref: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Metadata {
    version: u32,
    connections: Vec<Record>,
}

impl Store {
    pub(super) fn native(base: PathBuf) -> Self {
        let keys = Arc::new(NativeKeyStore::for_namespace(&base, SERVICE));
        Self { base, keys }
    }

    #[cfg(test)]
    pub(super) fn synthetic(base: PathBuf, keys: Arc<dyn KeyStore + Send + Sync>) -> Self {
        Self { base, keys }
    }

    fn transaction<T>(&self, body: impl FnOnce() -> Result<T, AppError>) -> Result<T, AppError> {
        let _lock = LOCK.lock().map_err(|_| storage())?;
        directory(&self.base)?;
        reject_link(&self.base.join("store.lock"))?;
        let _file_lock = crate::atomic::FileLock::acquire(&self.base.join("store.lock"))
            .map_err(|_| storage())?;
        body()
    }

    pub(super) fn list(&self, root: &str) -> Result<Vec<ConnectionInfo>, AppError> {
        self.transaction(|| {
            Ok(self
                .read()?
                .connections
                .into_iter()
                .filter(|record| record.info.root_path == root)
                .map(|record| record.info)
                .collect())
        })
    }

    pub(super) fn resolve(&self, root: &str, id: &str) -> Result<Resolved, AppError> {
        self.transaction(|| {
            let metadata = self.read()?;
            let record = find(&metadata, root, id)?;
            Ok(Resolved {
                info: record.info.clone(),
                secret: self.open(record)?,
                credential_origin: record.credential_origin.clone(),
            })
        })
    }

    pub(super) fn preview(
        &self,
        root: &str,
        draft: &ConnectionDraft,
    ) -> Result<Resolved, AppError> {
        self.transaction(|| {
            let metadata = self.read()?;
            let existing = draft
                .id
                .as_deref()
                .map(|id| find(&metadata, root, id))
                .transpose()?;
            let (record, replacement) = prepare(root, draft, existing)?;
            let secret = match &draft.auth.credential {
                CredentialEdit::Keep => existing
                    .map(|record| self.open(record))
                    .transpose()?
                    .flatten(),
                CredentialEdit::Replace { .. } => replacement,
                CredentialEdit::Clear => None,
            };
            Ok(Resolved {
                info: record.info,
                secret,
                credential_origin: record.credential_origin,
            })
        })
    }

    pub(super) fn save(
        &self,
        root: &str,
        draft: &ConnectionDraft,
    ) -> Result<ConnectionInfo, AppError> {
        self.transaction(|| {
            let mut metadata = self.read()?;
            // No mutation may hide loss/corruption of an existing vault or recreate its key.
            for record in &metadata.connections {
                self.open(record)?;
            }
            let existing = draft
                .id
                .as_deref()
                .map(|id| find(&metadata, root, id))
                .transpose()?;
            let (mut record, replacement) = prepare(root, draft, existing)?;
            record.info.revision = ulid::Ulid::generate().to_string();
            if let Some(secret) = replacement {
                let key = self.master_for_new()?;
                let reference = secrets::random_id().map_err(|_| storage())?;
                record.credential_ref = Some(reference.clone());
                record.info.auth.has_credential = true;
                let cipher = secrets::encrypt_in(
                    &key,
                    SERVICE,
                    MAGIC,
                    &binding(&record)?,
                    secret.as_bytes(),
                )
                .map_err(|_| storage())?;
                let vault = self.base.join("vault");
                directory(&vault)?;
                sync_directory(&self.base)?;
                let path = vault.join(format!("{reference}.vault"));
                write_new(&path, &cipher)?;
                sync_directory(&vault)?;
                let verified = self.open(&record)?.ok_or_else(storage)?;
                if *verified != *secret {
                    return Err(storage());
                }
            }
            let info = record.info.clone();
            if let Some(position) = metadata
                .connections
                .iter()
                .position(|item| item.info.id == info.id)
            {
                metadata.connections[position] = record;
            } else {
                if metadata.connections.len() >= 256
                    || metadata
                        .connections
                        .iter()
                        .filter(|item| item.info.root_path == root)
                        .count()
                        >= 32
                {
                    return Err(error(
                        "A2A_CONNECTION_LIMIT",
                        "The A2A connection limit has been reached (32 per project, 256 total).",
                    ));
                }
                metadata.connections.push(record);
            }
            self.commit(&metadata)?;
            Ok(info)
        })
    }

    pub(super) fn remove(&self, root: &str, id: &str) -> Result<(), AppError> {
        self.transaction(|| {
            let mut metadata = self.read()?;
            find(&metadata, root, id)?;
            for record in &metadata.connections {
                self.open(record)?;
            }
            metadata.connections.retain(|record| record.info.id != id);
            self.commit(&metadata)
        })
    }

    fn read(&self) -> Result<Metadata, AppError> {
        let Some(bytes) = read_optional(&self.base.join(FILE), MAX_METADATA)? else {
            return Ok(Metadata {
                version: 1,
                connections: vec![],
            });
        };
        let metadata: Metadata = serde_json::from_slice(&bytes).map_err(|_| storage())?;
        if metadata.version != 1 || metadata.connections.len() > 256 {
            return Err(storage());
        }
        let mut ids = HashSet::new();
        for record in &metadata.connections {
            if !validation::id(&record.info.id)
                || record.info.local.is_some()
                || !validation::id(&record.info.revision)
                || !ids.insert(&record.info.id)
                || !Path::new(&record.info.root_path).is_absolute()
                || record.info.name.is_empty()
                || record.info.name.len() > 512
                || record.info.auth.has_credential != record.credential_ref.is_some()
                || record
                    .credential_ref
                    .as_deref()
                    .is_some_and(|value| !valid_reference(value))
            {
                return Err(storage());
            }
            let card = validation::url(&record.info.card_url).map_err(|_| storage())?;
            let target = record
                .info
                .interface_url
                .as_deref()
                .map(validation::url)
                .transpose()
                .map_err(|_| storage())?
                .unwrap_or(card);
            if record.credential_origin != validation::origin(&target) {
                return Err(storage());
            }
            match record.info.auth.kind {
                AuthKind::ApiKey => {
                    let header = record
                        .info
                        .auth
                        .header_name
                        .as_deref()
                        .ok_or_else(storage)?;
                    if validation::header(header).map_err(|_| storage())? != header {
                        return Err(storage());
                    }
                }
                AuthKind::None if record.credential_ref.is_some() => return Err(storage()),
                _ if record.info.auth.header_name.is_some() => return Err(storage()),
                _ => {}
            }
            if record.info.interface_tenant.as_ref().is_some_and(|tenant| {
                tenant.is_empty() || tenant.len() > 512 || record.info.interface_url.is_none()
            }) {
                return Err(storage());
            }
        }
        Ok(metadata)
    }

    fn open(&self, record: &Record) -> Result<Option<Zeroizing<String>>, AppError> {
        let Some(reference) = &record.credential_ref else {
            return Ok(None);
        };
        let key = secrets::master(self.keys.as_ref(), false).map_err(|_| storage())?;
        let bytes = read_optional(
            &self.base.join("vault").join(format!("{reference}.vault")),
            16 * 1024,
        )?
        .ok_or_else(storage)?;
        let plain = secrets::decrypt_in(&key, SERVICE, MAGIC, &binding(record)?, &bytes)
            .map_err(|_| storage())?;
        let value = Zeroizing::new(
            std::str::from_utf8(&plain)
                .map_err(|_| storage())?
                .to_owned(),
        );
        validation::credential(&value).map_err(|_| storage())?;
        Ok(Some(value))
    }

    fn master_for_new(&self) -> Result<MasterKey, AppError> {
        let vault = self.base.join("vault");
        reject_link(&vault)?;
        let empty = match fs::read_dir(&vault) {
            Ok(mut entries) => entries.next().is_none(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
            Err(_) => return Err(storage()),
        };
        secrets::master(self.keys.as_ref(), empty).map_err(|_| storage())
    }

    fn commit(&self, metadata: &Metadata) -> Result<(), AppError> {
        let bytes = serde_json::to_string_pretty(metadata).map_err(|_| storage())?;
        if bytes.len() > MAX_METADATA {
            return Err(storage());
        }
        reject_link(&self.base.join(FILE))?;
        crate::atomic::write_atomic(&self.base.join(FILE), &bytes, true).map_err(|_| storage())?;
        // Old encrypted files are reclaimed only after the metadata commit point.
        let references: HashSet<&str> = metadata
            .connections
            .iter()
            .filter_map(|record| record.credential_ref.as_deref())
            .collect();
        let vault = self.base.join("vault");
        if let Ok(entries) = fs::read_dir(vault) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Some(reference) = name.strip_suffix(".vault") {
                    if valid_reference(reference)
                        && !references.contains(reference)
                        && entry.file_type().is_ok_and(|kind| kind.is_file())
                    {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }
        Ok(())
    }
}

fn find<'a>(metadata: &'a Metadata, root: &str, id: &str) -> Result<&'a Record, AppError> {
    metadata
        .connections
        .iter()
        .find(|record| record.info.root_path == root && record.info.id == id)
        .ok_or_else(|| {
            error(
                "A2A_CONNECTION_NOT_FOUND",
                "This A2A connection is unavailable in the current project.",
            )
        })
}

fn prepare(
    root: &str,
    draft: &ConnectionDraft,
    existing: Option<&Record>,
) -> Result<(Record, Option<Zeroizing<String>>), AppError> {
    let (card_url, interface_url, interface_tenant, header_name, credential_origin) =
        validation::draft(draft)?;
    let mut reference = None;
    let mut replacement = None;
    match &draft.auth.credential {
        CredentialEdit::Keep => {
            let old = existing.ok_or_else(|| {
                error(
                    "A2A_CREDENTIAL_KEEP_INVALID",
                    "Only an existing connection can keep a credential.",
                )
            })?;
            if old.info.auth.kind != draft.auth.kind
                || old.info.auth.header_name != header_name
                || old.credential_origin != credential_origin
            {
                return Err(error(
                    "A2A_CREDENTIAL_KEEP_INVALID",
                    "Changing the credential origin or authentication requires an explicit replacement or clear.",
                ));
            }
            reference = old.credential_ref.clone();
        }
        CredentialEdit::Replace { value } if draft.auth.kind != AuthKind::None => {
            validation::credential(value)?;
            replacement = Some(Zeroizing::new(value.clone()));
        }
        CredentialEdit::Replace { .. } => {
            return Err(error(
                "A2A_CREDENTIAL_INVALID",
                "Anonymous connections must clear their credential.",
            ));
        }
        CredentialEdit::Clear if existing.is_none() && draft.auth.kind != AuthKind::None => {
            return Err(error(
                "A2A_AUTHENTICATION_REQUIRED",
                "A new authenticated connection requires a credential.",
            ));
        }
        CredentialEdit::Clear => {}
    }
    let record = Record {
        info: ConnectionInfo {
            id: existing
                .map(|record| record.info.id.clone())
                .unwrap_or_else(|| ulid::Ulid::generate().to_string()),
            name: draft.name.trim().into(),
            root_path: root.into(),
            card_url,
            interface_url,
            interface_tenant,
            auth: AuthInfo {
                kind: draft.auth.kind,
                header_name,
                has_credential: reference.is_some() || replacement.is_some(),
            },
            revision: existing
                .map(|record| record.info.revision.clone())
                .unwrap_or_else(|| ulid::Ulid::generate().to_string()),
            local: None,
        },
        credential_origin,
        credential_ref: reference,
    };
    Ok((record, replacement))
}

fn binding(record: &Record) -> Result<String, AppError> {
    serde_json::to_string(&(
        &record.info.root_path,
        &record.info.id,
        record.info.auth.kind,
        &record.info.auth.header_name,
        &record.credential_origin,
        &record.credential_ref,
    ))
    .map_err(|_| storage())
}

fn valid_reference(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn reject_link(path: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(storage()),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(storage()),
    }
}

fn directory(path: &Path) -> Result<(), AppError> {
    reject_link(path)?;
    fs::create_dir_all(path).map_err(|_| storage())?;
    Ok(())
}

fn read_optional(path: &Path, max: usize) -> Result<Option<Vec<u8>>, AppError> {
    reject_link(path)?;
    // Also reject a replaced vault directory before opening its child.
    if let Some(parent) = path.parent() {
        reject_link(parent)?;
    }
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(storage()),
    };
    let meta = file.metadata().map_err(|_| storage())?;
    if !meta.is_file() || meta.len() > max as u64 {
        return Err(storage());
    }
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| storage())?;
    if bytes.len() > max {
        return Err(storage());
    }
    Ok(Some(bytes))
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|_| storage())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| storage())
}

fn sync_directory(path: &Path) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        fs::File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|_| storage())?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}
