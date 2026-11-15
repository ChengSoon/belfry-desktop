use super::{
    contracts::ConnectionInfo,
    store::{Resolved, Store},
};
use crate::terminal::AppError;

/// Both persisted external connections and scoped, ephemeral local adapters use
/// the same HTTP client and task-handle runtime.
pub(super) trait ConnectionSource: Send + Sync {
    fn list(&self, root: &str) -> Result<Vec<ConnectionInfo>, AppError>;
    fn resolve(&self, root: &str, id: &str) -> Result<Resolved, AppError>;
}
impl ConnectionSource for Store {
    fn list(&self, root: &str) -> Result<Vec<ConnectionInfo>, AppError> {
        self.list(root)
    }
    fn resolve(&self, root: &str, id: &str) -> Result<Resolved, AppError> {
        self.resolve(root, id)
    }
}
