use crate::terminal::AppError;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[derive(Clone, Default)]
pub(super) struct Cancellation(Arc<AtomicBool>);

impl Cancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
    pub fn check(&self) -> Result<(), AppError> {
        if self.0.load(Ordering::Relaxed) {
            Err(AppError::io("历史详情读取已取消"))
        } else {
            Ok(())
        }
    }
}
