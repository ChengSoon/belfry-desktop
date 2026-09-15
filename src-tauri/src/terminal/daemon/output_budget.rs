use std::{
    collections::VecDeque,
    sync::{Condvar, Mutex, MutexGuard},
    time::{Duration, Instant},
};

/// 约束宿主到 WebView 的源输出与事件开销，不阻塞 daemon 的 PTY reader。
pub(super) const WINDOW_BYTES: usize = 256 * 1024;
pub(super) const WINDOW_BATCHES: usize = 4;
const ACK_TIMEOUT: Duration = Duration::from_secs(30);

struct Pending {
    id: u64,
    bytes: usize,
    sent: Instant,
}

struct State {
    active: bool,
    next: u64,
    bytes: usize,
    pending: VecDeque<Pending>,
}

pub(super) struct OutputBudget {
    state: Mutex<State>,
    changed: Condvar,
    timeout: Duration,
}

impl Default for OutputBudget {
    fn default() -> Self {
        Self::with_timeout(ACK_TIMEOUT)
    }
}

impl OutputBudget {
    pub(super) fn with_timeout(timeout: Duration) -> Self {
        Self {
            state: Mutex::new(State {
                active: true,
                next: 1,
                bytes: 0,
                pending: VecDeque::new(),
            }),
            changed: Condvar::new(),
            timeout,
        }
    }

    pub(super) fn reserve(&self, bytes: usize) -> Result<u64, String> {
        if bytes > WINDOW_BYTES {
            return Err("后台输出批次超出消费预算，请重新连接。".into());
        }
        let mut state = self.wait_for(|state| {
            state.bytes + bytes <= WINDOW_BYTES && state.pending.len() < WINDOW_BATCHES
        })?;
        let id = state.next;
        state.next += 1;
        state.bytes += bytes;
        state.pending.push_back(Pending {
            id,
            bytes,
            sent: Instant::now(),
        });
        Ok(id)
    }

    pub(super) fn acknowledge(&self, id: u64) -> bool {
        let mut state = self.state.lock().unwrap();
        if !state.active || state.pending.front().is_none_or(|pending| pending.id != id) {
            return false;
        }
        let pending = state.pending.pop_front().unwrap();
        state.bytes -= pending.bytes;
        self.changed.notify_all();
        true
    }

    pub(super) fn wait_ready(&self) -> Result<(), String> {
        drop(self.wait_for(|state| {
            state.bytes < WINDOW_BYTES && state.pending.len() < WINDOW_BATCHES
        })?);
        Ok(())
    }

    pub(super) fn wait_drained(&self) -> Result<(), String> {
        drop(self.wait_for(|state| state.pending.is_empty())?);
        Ok(())
    }

    pub(super) fn is_active(&self) -> bool {
        self.state.lock().unwrap().active
    }

    pub(super) fn cancel(&self) {
        let mut state = self.state.lock().unwrap();
        state.active = false;
        state.pending.clear();
        state.bytes = 0;
        self.changed.notify_all();
    }

    fn wait_for(&self, ready: impl Fn(&State) -> bool) -> Result<MutexGuard<'_, State>, String> {
        let mut state = self.state.lock().unwrap();
        loop {
            if !state.active {
                return Err("终端输出连接已关闭".into());
            }
            let remaining = state
                .pending
                .front()
                .map(|pending| self.timeout.saturating_sub(pending.sent.elapsed()));
            if remaining.is_some_and(|time| time.is_zero()) {
                return Err("终端输出消费确认超时。可重新连接；原任务仍在后台运行。".into());
            }
            if ready(&state) {
                return Ok(state);
            }
            state = self
                .changed
                .wait_timeout(state, remaining.unwrap_or(self.timeout))
                .unwrap()
                .0;
        }
    }

    #[cfg(test)]
    pub(super) fn outstanding(&self) -> (usize, usize) {
        let state = self.state.lock().unwrap();
        (state.bytes, state.pending.len())
    }
}
