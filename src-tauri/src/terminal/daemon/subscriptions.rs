use super::{protocol::Endpoint, subscription::Subscription};
use crate::terminal::{backend::TerminalEventSink, contracts::TerminalSession};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    thread,
};

/// 每一路视图的订阅，按连接号登记。
///
/// 原先按会话登记：同一个会话只留一路，后到的订阅把先到的那路 `cancel` 掉。
/// 看终端打开的正是同一条会话的第二路——工作台那路被静默掐死，它的活动判定
/// 就冻在最后一帧，房间成员行于是长期显示「空闲」，投递确认也跟着卡住。
/// 后台本身按轮询游标读回放，天然支持多路；登记表不该把它收窄成一路。
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
        self.attach(subscription.clone());
        let subscriptions = self.clone();
        thread::spawn(move || {
            subscription.run(endpoint, sink.as_ref());
            subscriptions.detach(&subscription.session_id, &subscription.connection_id);
        });
    }

    /// 登记一路新视图。刻意不取消同一会话的其他订阅：看终端与工作台要能同时盯着它。
    pub(super) fn attach(&self, subscription: Arc<Subscription>) {
        self.0
            .lock()
            .unwrap()
            .insert(subscription.connection_id.clone(), subscription);
    }

    /// 确认只能落到它自己那条连接上：别的视图的连接号或别人的投递号都不算数。
    pub(super) fn acknowledge(&self, session: &str, connection: &str, delivery: u64) -> bool {
        let subscription = self.0.lock().unwrap().get(connection).cloned();
        subscription.is_some_and(|subscription| {
            subscription.session_id == session && subscription.acknowledge(delivery)
        })
    }

    /// 收起一路视图只断它自己那路，不动同一会话的另一路。
    pub(super) fn detach(&self, session: &str, connection: &str) {
        let removed = {
            let mut subscriptions = self.0.lock().unwrap();
            if subscriptions
                .get(connection)
                .is_some_and(|current| current.session_id == session)
            {
                subscriptions.remove(connection)
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
