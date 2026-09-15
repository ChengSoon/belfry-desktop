use super::{
    output_budget::OutputBudget,
    protocol::{Command, Endpoint, POLL_BYTES, PollResult},
    replay::event_size,
    transport,
};
use crate::terminal::{TerminalEvent, backend::TerminalEventSink};
use std::{
    net::{Shutdown, TcpStream},
    sync::Mutex,
};

const MAX_BATCH_EVENTS: usize = 256;

pub(super) struct Subscription {
    pub session_id: String,
    pub connection_id: String,
    pub budget: OutputBudget,
    flow_control: bool,
    socket: Mutex<Option<TcpStream>>,
}

impl Subscription {
    pub(super) fn new(session_id: String, flow_control: bool) -> Self {
        Self {
            session_id,
            connection_id: ulid::Ulid::generate().to_string(),
            budget: OutputBudget::default(),
            flow_control,
            socket: Mutex::new(None),
        }
    }

    pub(super) fn cancel(&self) {
        self.budget.cancel();
        if let Some(socket) = self.socket.lock().unwrap().take() {
            let _ = socket.shutdown(Shutdown::Both);
        }
    }

    pub(super) fn acknowledge(&self, delivery: u64) -> bool {
        self.flow_control && self.budget.acknowledge(delivery)
    }

    pub(super) fn run(&self, endpoint: Endpoint, sink: &dyn TerminalEventSink) {
        if let Err(message) = self.poll(&endpoint, sink) {
            if self.budget.is_active() {
                let _ = sink.send(TerminalEvent::Disconnected {
                    session_id: self.session_id.clone(),
                    message,
                });
            }
        }
        self.cancel();
    }

    fn poll(&self, endpoint: &Endpoint, sink: &dyn TerminalEventSink) -> Result<(), String> {
        let mut cursor = 0;
        while self.budget.is_active() {
            if self.flow_control {
                self.budget.wait_ready()?;
            }
            let page = self.read_page(endpoint, cursor)?;
            if !self.budget.is_active() {
                return Ok(());
            }
            cursor = page.cursor;
            let ended = page
                .frames
                .iter()
                .any(|frame| matches!(frame.event, TerminalEvent::Exit { .. }));
            self.forward(page, sink)?;
            if ended {
                if self.flow_control {
                    self.budget.wait_drained()?;
                }
                return Ok(());
            }
        }
        Ok(())
    }

    fn read_page(&self, endpoint: &Endpoint, cursor: u64) -> Result<PollResult, String> {
        let mut stream = transport::connect(endpoint.port)?;
        {
            let mut socket = self.socket.lock().unwrap();
            if !self.budget.is_active() {
                return Err("终端输出连接已关闭".into());
            }
            *socket = Some(stream.try_clone().map_err(|error| error.to_string())?);
        }
        let result = transport::exchange(
            endpoint,
            Command::Poll {
                id: self.session_id.clone(),
                cursor,
            },
            &mut stream,
        );
        self.socket.lock().unwrap().take();
        result.map_err(|_| "后台连接已中断。可重新连接；原任务不会被自动重启。".into())
    }

    fn forward(&self, page: PollResult, sink: &dyn TerminalEventSink) -> Result<(), String> {
        let events = page
            .gap
            .into_iter()
            .chain(page.frames.into_iter().map(|frame| frame.event));
        if !self.flow_control {
            for event in events {
                if !self.budget.is_active() {
                    break;
                }
                sink.send(event).map_err(|error| error.message)?;
            }
            return Ok(());
        }
        let mut batch = Vec::new();
        let mut bytes = 0;
        for event in events {
            let size = event_size(&event);
            if !batch.is_empty() && (bytes + size > POLL_BYTES || batch.len() >= MAX_BATCH_EVENTS) {
                self.send_batch(std::mem::take(&mut batch), bytes, sink)?;
                bytes = 0;
            }
            bytes += size;
            batch.push(event);
        }
        if !batch.is_empty() {
            self.send_batch(batch, bytes, sink)?;
        }
        Ok(())
    }

    fn send_batch(
        &self,
        events: Vec<TerminalEvent>,
        bytes: usize,
        sink: &dyn TerminalEventSink,
    ) -> Result<(), String> {
        let delivery_id = self.budget.reserve(bytes)?;
        if !self.budget.is_active() {
            return Ok(());
        }
        sink.send(TerminalEvent::OutputBatch {
            session_id: self.session_id.clone(),
            connection_id: self.connection_id.clone(),
            delivery_id,
            events,
        })
        .map_err(|error| error.message)
    }
}
