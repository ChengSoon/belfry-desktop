use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use crate::terminal::AppError;

const MAX_REQUESTS: usize = 8;
const MAX_ID: usize = 100;
const MAX_EARLY_CANCELS: usize = 64;

#[derive(Default)]
pub struct SshRequests(Mutex<Requests>);

#[derive(Default)]
struct Requests {
    active: HashMap<String, Arc<AtomicBool>>,
    cancelled: VecDeque<String>,
}

impl SshRequests {
    pub(super) fn begin(&self, id: &str) -> Result<Arc<AtomicBool>, AppError> {
        if id.is_empty() || id.len() > MAX_ID || id.chars().any(char::is_control) {
            return Err(AppError::invalid_argument("SSH 请求身份无效"));
        }
        let mut requests = self.0.lock().map_err(|_| AppError::io("SSH 请求管理器不可用"))?;
        if let Some(index) = requests.cancelled.iter().position(|value| value == id) {
            requests.cancelled.remove(index);
            return Err(AppError::io("SSH 请求已取消"));
        }
        if requests.active.len() >= MAX_REQUESTS || requests.active.contains_key(id) {
            return Err(AppError::invalid_argument("SSH 请求过多或身份重复"));
        }
        let flag = Arc::new(AtomicBool::new(false));
        requests.active.insert(id.into(), flag.clone());
        Ok(flag)
    }

    pub(super) fn finish(&self, id: &str) {
        if let Ok(mut requests) = self.0.lock() { requests.active.remove(id); }
    }

    pub(super) fn cancel(&self, id: &str) {
        if id.is_empty() || id.len() > MAX_ID { return; }
        if let Ok(mut requests) = self.0.lock() {
            if let Some(flag) = requests.active.get(id) { flag.store(true, Ordering::Release); }
            else if !requests.cancelled.iter().any(|value| value == id) {
                if requests.cancelled.len() >= MAX_EARLY_CANCELS { requests.cancelled.pop_front(); }
                requests.cancelled.push_back(id.into());
            }
        }
    }
}
