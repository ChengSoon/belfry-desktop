use super::{
    protocol::{Command, Endpoint},
    transport,
};
use crate::terminal::AppError;
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const LEASE_TTL: Duration = Duration::from_secs(60);
const RENEW_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct Leases(Mutex<Option<(String, Instant)>>);
impl Leases {
    pub fn acquire(&self) -> Result<String, AppError> {
        let mut lease = self.0.lock().unwrap();
        if lease
            .as_ref()
            .is_some_and(|(_, expires)| *expires > Instant::now())
        {
            return Err(busy());
        }
        let token = ulid::Ulid::generate().to_string();
        *lease = Some((token.clone(), Instant::now() + LEASE_TTL));
        Ok(token)
    }
    pub fn renew(&self, token: &str) -> Result<(), AppError> {
        let mut lease = self.0.lock().unwrap();
        let Some((current, expires)) = lease.as_mut() else {
            return Err(busy());
        };
        if current != token || *expires < Instant::now() {
            return Err(busy());
        }
        *expires = Instant::now() + LEASE_TTL;
        Ok(())
    }
    pub fn release(&self, token: &str) {
        let mut lease = self.0.lock().unwrap();
        if lease.as_ref().is_some_and(|(current, _)| current == token) {
            *lease = None;
        }
    }
    pub fn allow_spawn(&self) -> Result<(), AppError> {
        if self
            .0
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|(_, expires)| *expires > Instant::now())
        {
            Err(busy())
        } else {
            Ok(())
        }
    }
}
fn busy() -> AppError {
    AppError::io("Worktree 正在执行操作，请完成后再创建会话")
}

pub struct LeaseGuard {
    endpoint: Endpoint,
    token: String,
    active: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl LeaseGuard {
    pub fn acquire(endpoint: Endpoint) -> Result<Self, AppError> {
        let token: String =
            transport::call(&endpoint, Command::AcquireWorkspace).map_err(AppError::io)?;
        let active = Arc::new(AtomicBool::new(true));
        let (target, ticket, running) = (endpoint.clone(), token.clone(), active.clone());
        let worker = thread::spawn(move || {
            while running.load(Ordering::Acquire) {
                thread::park_timeout(RENEW_INTERVAL);
                if !running.load(Ordering::Acquire) {
                    break;
                }
                let _ = transport::call::<()>(
                    &target,
                    Command::RenewWorkspace {
                        token: ticket.clone(),
                    },
                );
            }
        });
        Ok(Self {
            endpoint,
            token,
            active,
            worker: Some(worker),
        })
    }
}
impl Drop for LeaseGuard {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            worker.thread().unpark();
        }
        let _ = transport::call::<()>(
            &self.endpoint,
            Command::ReleaseWorkspace {
                token: self.token.clone(),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_current_owner_can_unlock_and_dead_owners_expire() {
        let leases = Leases::default();
        let token = leases.acquire().unwrap();
        assert!(leases.allow_spawn().is_err());
        assert!(leases.acquire().is_err());
        leases.release("wrong");
        assert!(leases.allow_spawn().is_err());
        leases.renew(&token).unwrap();
        leases.release(&token);
        assert!(leases.allow_spawn().is_ok());
        *leases.0.lock().unwrap() = Some(("dead".into(), Instant::now() - Duration::from_secs(1)));
        assert!(leases.allow_spawn().is_ok());
        let replacement = leases.acquire().unwrap();
        leases.release("dead");
        assert!(leases.allow_spawn().is_err());
        leases.release(&replacement);
    }
}
