use super::{
    cancel::Cancellation,
    contracts::{DetailPage, DetailRequest},
    reader::DetailReader,
    sources,
};
use crate::terminal::AppError;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const MAX_READERS: usize = 4;
const READER_IDLE: Duration = Duration::from_secs(10 * 60);

#[derive(Clone)]
struct ActiveReader {
    reader: Arc<Mutex<Option<DetailReader>>>,
    cancel: Cancellation,
    touched: Instant,
}

#[derive(Default)]
pub struct HistoryDetailState {
    readers: Mutex<HashMap<String, ActiveReader>>,
}

impl HistoryDetailState {
    pub async fn open(&self, request: DetailRequest) -> Result<DetailPage, AppError> {
        request
            .session
            .validate()
            .map_err(AppError::invalid_argument)?;
        let root = sources::root(request.session.agent)?;
        let active = self.register(&request.reader_id)?;
        let id = request.reader_id.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let mut reader = DetailReader::open(request, &root, active.cancel)?;
            let page = reader.page(0)?;
            *active.reader.lock().map_err(|_| unavailable())? = Some(reader);
            Ok(page)
        })
        .await
        .map_err(|error| AppError::io(error.to_string()))?;
        if result.is_err() {
            self.close(&id);
        }
        result
    }

    pub async fn next(&self, id: String, page: u32) -> Result<DetailPage, AppError> {
        let active = self.get(&id)?;
        tauri::async_runtime::spawn_blocking(move || {
            active.cancel.check()?;
            active
                .reader
                .lock()
                .map_err(|_| unavailable())?
                .as_mut()
                .ok_or_else(unavailable)?
                .page(page)
        })
        .await
        .map_err(|error| AppError::io(error.to_string()))?
    }

    pub fn close(&self, id: &str) {
        if let Ok(mut readers) = self.readers.lock() {
            if let Some(active) = readers.remove(id) {
                active.cancel.cancel();
            }
        }
    }

    fn register(&self, id: &str) -> Result<ActiveReader, AppError> {
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err(AppError::invalid_argument("详情读取标识无效"));
        }
        let mut readers = self.readers.lock().map_err(|_| unavailable())?;
        readers.retain(|_, active| {
            if active.touched.elapsed() < READER_IDLE {
                true
            } else {
                active.cancel.cancel();
                false
            }
        });
        if readers.contains_key(id) {
            return Err(AppError::invalid_argument("详情读取标识已存在"));
        }
        if readers.len() >= MAX_READERS {
            let oldest = readers
                .iter()
                .min_by_key(|(_, active)| active.touched)
                .map(|(id, _)| id.clone());
            if let Some(oldest) = oldest.and_then(|id| readers.remove(&id)) {
                oldest.cancel.cancel();
            }
        }
        let active = ActiveReader {
            reader: Arc::new(Mutex::new(None)),
            cancel: Cancellation::default(),
            touched: Instant::now(),
        };
        readers.insert(id.to_owned(), active.clone());
        Ok(active)
    }

    fn get(&self, id: &str) -> Result<ActiveReader, AppError> {
        let mut readers = self.readers.lock().map_err(|_| unavailable())?;
        let active = readers.get_mut(id).ok_or_else(unavailable)?;
        if active.touched.elapsed() >= READER_IDLE {
            active.cancel.cancel();
            return Err(unavailable());
        }
        active.touched = Instant::now();
        Ok(active.clone())
    }
}

fn unavailable() -> AppError {
    AppError::io("历史详情已关闭或过期，请刷新后重试")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_one_reader_never_cancels_another_and_oldest_readers_are_bounded() {
        let state = HistoryDetailState::default();
        let first = state.register("first").unwrap();
        let second = state.register("second").unwrap();
        state.close("first");
        assert!(first.cancel.check().is_err());
        assert!(second.cancel.check().is_ok());
        for index in 0..MAX_READERS {
            state.register(&format!("new-{index}")).unwrap();
        }
        assert!(second.cancel.check().is_err());
        assert_eq!(MAX_READERS, state.readers.lock().unwrap().len());
    }
}
