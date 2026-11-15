//! Test-only access to the same embedded Node process and callback transport as desktop.
use serde_json::Value;
use std::{path::Path, sync::Arc};

use super::{
    connection::{Connection, HostHandler},
    embedded,
};

pub(crate) struct A2aTestHost(Arc<Connection>);
impl A2aTestHost {
    pub(crate) fn launch(base: &Path, handler: HostHandler) -> Self {
        let node = crate::agent::find_in_path("node")
            .expect("Node.js required for plugin integration tests");
        let root = embedded::materialize(base).unwrap();
        Self(Connection::launch((&node, &root, base), (handler, Arc::new(|_| {}))).unwrap())
    }
    pub(crate) fn call(&self, method: &str, args: Value) -> Value {
        self.0.call(method, args).unwrap()
    }
}
impl Drop for A2aTestHost {
    fn drop(&mut self) {
        self.0.stop();
    }
}
