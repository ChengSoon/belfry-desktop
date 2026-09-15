use super::{protocol::Endpoint, subscription::Subscription};
use crate::terminal::{backend::TerminalEventSink, contracts::TerminalSession};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    thread,
};

#[derive(Clone, Default)]
pub(super) struct Subscriptions(Arc<Mutex<HashMap<String, Arc<Subscription>>>>);

impl Subscriptions {
    pub(super) fn start(
        &self,
        session: &mut TerminalSession,
        endpoint: Endpoint,
        sink: Arc<dyn TerminalEventSink>,
    ) {
        let subscription = Arc::new(Subscription::new(
            session.id.clone(),
            sink.uses_output_acknowledgements(),
        ));
        session.connection_id = Some(subscription.connection_id.clone());
        self.replace(subscription.clone());
        let subscriptions = self.clone();
        thread::spawn(move || {
            subscription.run(endpoint, sink.as_ref());
            subscriptions.detach(&subscription.session_id, &subscription.connection_id);
        });
    }

    pub(super) fn replace(&self, subscription: Arc<Subscription>) {
        let previous = self
            .0
            .lock()
            .unwrap()
            .insert(subscription.session_id.clone(), subscription);
        if let Some(previous) = previous {
            previous.cancel();
        }
    }

    pub(super) fn acknowledge(&self, session: &str, connection: &str, delivery: u64) -> bool {
        let subscription = self.0.lock().unwrap().get(session).cloned();
        subscription.is_some_and(|subscription| {
            subscription.connection_id == connection && subscription.acknowledge(delivery)
        })
    }

    pub(super) fn detach(&self, session: &str, connection: &str) {
        let removed = {
            let mut subscriptions = self.0.lock().unwrap();
            if subscriptions
                .get(session)
                .is_some_and(|current| current.connection_id == connection)
            {
                subscriptions.remove(session)
            } else {
                None
            }
        };
        if let Some(subscription) = removed {
            subscription.cancel();
        }
    }

    pub(super) fn detach_all(&self) {
        let removed = self
            .0
            .lock()
            .unwrap()
            .drain()
            .map(|(_, subscription)| subscription)
            .collect::<Vec<_>>();
        for subscription in removed {
            subscription.cancel();
        }
    }
}
