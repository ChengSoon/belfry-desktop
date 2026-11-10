//! A durable inbox transaction ends before any PTY call. Unknown versions are never rewritten.
use super::model::{self, Data};
use crate::{
    atomic::{FileLock, read_text_optional, write_atomic},
    terminal::AppError,
};
use std::{path::PathBuf, sync::Mutex};

struct Inner {
    data: Data,
    root: Option<PathBuf>,
    error: Option<String>,
}
pub(super) struct Store {
    inner: Mutex<Inner>,
}
impl Store {
    pub fn load(root: Option<PathBuf>) -> Self {
        let loaded =
            root.as_ref().ok_or_else(|| AppError::io("Inbox storage directory is unavailable")).and_then(|root| {
                let _writer = FileLock::acquire(&root.join("inbox.lock"))?;
                read(root)
            });
        let (data, error) = match loaded {
            Ok(data) => (data, None),
            Err(error) => (Data::default(), Some(error.message)),
        };
        let store = Self { inner: Mutex::new(Inner { data, root, error }) };
        if store.error().is_none()
            && let Err(error) = store.edit(|data| {
                let prepared: Vec<_> = data
                    .batches
                    .values()
                    .filter(|batch| batch.view.phase == "prepared")
                    .map(|batch| batch.view.id.clone())
                    .collect();
                for id in prepared {
                    model::abort(data, &id);
                }
                let submitting: Vec<_> = data
                    .batches
                    .values()
                    .filter(|batch| batch.view.phase == "submitting")
                    .map(|batch| batch.view.id.clone())
                    .collect();
                for id in submitting {
                    model::set_phase(data, &id, "uncertain");
                }
                Ok(())
            })
        {
            store.inner.lock().unwrap().error = Some(error.message);
        }
        store
    }
    pub fn error(&self) -> Option<String> {
        self.inner.lock().map(|inner| inner.error.clone()).unwrap_or(Some("Inbox storage lock is unavailable".into()))
    }
    pub fn snapshot(&self) -> Result<Data, AppError> {
        let inner = self.inner.lock().map_err(|_| AppError::io("Inbox storage lock is unavailable"))?;
        if let Some(error) = &inner.error {
            return Err(AppError::io(error));
        }
        Ok(inner.data.clone())
    }
    pub fn edit<T>(&self, action: impl FnOnce(&mut Data) -> Result<T, AppError>) -> Result<T, AppError> {
        self.edit_after(action, Ok)
    }
    pub fn edit_after<T, R>(
        &self,
        action: impl FnOnce(&mut Data) -> Result<T, AppError>,
        committed: impl FnOnce(T) -> Result<R, AppError>,
    ) -> Result<R, AppError> {
        let mut inner = self.inner.lock().map_err(|_| AppError::io("Inbox storage lock is unavailable"))?;
        if let Some(error) = &inner.error {
            return Err(AppError::io(error));
        }
        let root = inner.root.clone().ok_or_else(|| AppError::io("Inbox storage is unavailable"))?;
        let _writer = FileLock::acquire(&root.join("inbox.lock"))?;
        let disk = read(&root)?;
        if disk.revision != inner.data.revision {
            return Err(AppError::conflict("Inbox changed in another application instance; reload before writing"));
        }
        let mut next = inner.data.clone();
        let result = action(&mut next)?;
        if serde_json::to_vec(&next).map_err(|e| AppError::io(e.to_string()))?
            == serde_json::to_vec(&inner.data).map_err(|e| AppError::io(e.to_string()))?
        {
            return committed(result);
        }
        next.revision = inner.data.revision.checked_add(1).ok_or_else(|| AppError::io("Inbox revision overflow"))?;
        let text = serde_json::to_string(&next).map_err(|e| AppError::io(e.to_string()))?;
        #[cfg(test)]
        if FAIL_WRITE.replace(false) {
            return Err(AppError::io("Injected inbox commit failure"));
        }
        write_atomic(&root.join("inbox.json"), &text, true)?;
        inner.data = next;
        committed(result)
    }
}
fn read(root: &std::path::Path) -> Result<Data, AppError> {
    let text = read_text_optional(&root.join("inbox.json"))?;
    if text.trim().is_empty() {
        return Ok(Data::default());
    }
    let data: Data = serde_json::from_str(&text)
        .map_err(|error| AppError::io(format!("Inbox file is invalid; preserved without changes: {error}")))?;
    if data.schema_version != belfry_protocol::inbox::SCHEMA_VERSION {
        return Err(AppError::unsupported("Inbox file version is not supported; preserved without changes"));
    }
    Ok(data)
}
#[cfg(test)]
thread_local! { pub(super) static FAIL_WRITE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
