use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use crate::terminal::AppError;

#[derive(Clone, Default)]
pub(super) struct SearchCancellation {
    cancelled: Arc<AtomicBool>,
}

impl SearchCancellation {
    pub fn check(&self) -> Result<(), AppError> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err(AppError::io("历史搜索已取消"))
        } else {
            Ok(())
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}

struct ActiveSearch {
    id: String,
    token: SearchCancellation,
}

#[derive(Default)]
pub(super) struct SearchRegistry {
    active: Mutex<Option<ActiveSearch>>,
}

impl SearchRegistry {
    pub fn begin(&self, id: String) -> Result<SearchCancellation, AppError> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| AppError::io("搜索状态暂不可用"))?;
        if let Some(previous) = active.take() {
            previous.token.cancel();
        }
        let token = SearchCancellation::default();
        *active = Some(ActiveSearch {
            id,
            token: token.clone(),
        });
        Ok(token)
    }

    pub fn cancel(&self, id: &str) {
        if let Ok(active) = self.active.lock() {
            if let Some(search) = active.as_ref().filter(|search| search.id == id) {
                search.token.cancel();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelling_an_old_panel_does_not_cancel_the_new_request() {
        let registry = SearchRegistry::default();
        let old = registry.begin("old-panel".into()).unwrap();
        let current = registry.begin("new-panel".into()).unwrap();
        assert!(old.check().is_err());
        registry.cancel("old-panel");
        assert!(current.check().is_ok());
        registry.cancel("new-panel");
        assert!(current.check().is_err());
    }
}
