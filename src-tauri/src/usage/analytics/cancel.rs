use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub(super) const CANCELLED: &str = "用量查询已取消";
pub(super) type Check<'a> = &'a dyn Fn() -> Result<(), String>;

#[derive(Clone, Default)]
pub(super) struct Cancellation(Arc<AtomicBool>);

impl Cancellation {
    pub fn check(&self) -> Result<(), String> {
        if self.0.load(Ordering::Acquire) {
            Err(CANCELLED.into())
        } else {
            Ok(())
        }
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
}
