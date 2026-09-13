use super::{
    super::contracts::TerminalEvent,
    protocol::{CACHE_BYTES, Frame, POLL_BYTES, PollResult},
};
use std::collections::VecDeque;

#[derive(Default)]
pub struct Replay {
    frames: VecDeque<Frame>,
    next: u64,
    bytes: usize,
    next_output: u64,
}

impl Replay {
    pub fn push(&mut self, event: TerminalEvent) {
        if let TerminalEvent::Output { sequence, .. } = &event {
            self.next_output = sequence + 1;
        }
        self.bytes += event_size(&event);
        self.frames.push_back(Frame {
            cursor: self.next,
            event,
        });
        self.next += 1;
        while self.bytes > CACHE_BYTES {
            if let Some(frame) = self.frames.pop_front() {
                self.bytes -= event_size(&frame.event);
            } else {
                break;
            }
        }
    }

    pub fn read(&self, id: &str, cursor: u64) -> Result<PollResult, String> {
        if cursor > self.next {
            return Err("回放游标超出后台输出范围".into());
        }
        let oldest = self.frames.front().map_or(self.next, |frame| frame.cursor);
        let missing = cursor < oldest;
        let mut size = 0;
        let frames = self
            .frames
            .iter()
            .filter(|frame| frame.cursor >= cursor)
            .take_while(|frame| {
                if size >= POLL_BYTES {
                    return false;
                }
                size += event_size(&frame.event);
                true
            })
            .cloned()
            .collect::<Vec<_>>();
        let next_sequence = self
            .frames
            .iter()
            .filter(|frame| frame.cursor >= cursor)
            .find_map(|frame| {
                if let TerminalEvent::Output { sequence, .. } = &frame.event {
                    Some(*sequence)
                } else {
                    None
                }
            })
            .unwrap_or(self.next_output);
        let next = frames
            .last()
            .map_or(cursor.max(oldest), |frame| frame.cursor + 1);
        Ok(PollResult {
            cursor: next,
            frames,
            gap: missing.then(|| TerminalEvent::ReplayGap {
                session_id: id.into(),
                next_sequence,
                dropped_events: oldest - cursor,
            }),
        })
    }
}

fn event_size(event: &TerminalEvent) -> usize {
    match event {
        TerminalEvent::Output { bytes, .. } => bytes.len() + 128,
        TerminalEvent::AgentState { snapshot, .. } => {
            256 + snapshot.reason.len()
                + snapshot.transcript_path.as_ref().map_or(0, String::len)
                + snapshot
                    .session
                    .as_ref()
                    .map_or(0, |session| session.id.len())
        }
        TerminalEvent::Disconnected { message, .. } => message.len() + 128,
        _ => 256,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn output(sequence: u64, size: usize) -> TerminalEvent {
        TerminalEvent::Output {
            session_id: "qa".into(),
            sequence,
            bytes: vec![b'x'; size],
            eof: false,
        }
    }
    #[test]
    fn paginated_replay_never_duplicates_or_reorders_output() {
        let mut replay = Replay::default();
        for n in 0..10 {
            replay.push(output(n, 40_000));
        }
        let mut cursor = 0;
        let mut sequences = vec![];
        loop {
            let page = replay.read("qa", cursor).unwrap();
            assert!(page.gap.is_none());
            if page.frames.is_empty() {
                break;
            }
            cursor = page.cursor;
            for frame in page.frames {
                if let TerminalEvent::Output { sequence, .. } = frame.event {
                    sequences.push(sequence);
                }
            }
        }
        assert_eq!((0..10).collect::<Vec<_>>(), sequences);
    }
    #[test]
    fn bounded_buffer_reports_exact_resume_sequence_and_rejects_future_cursor() {
        let mut replay = Replay::default();
        for n in 0..80 {
            replay.push(output(n, 64_000));
        }
        let page = replay.read("qa", 0).unwrap();
        let Some(TerminalEvent::ReplayGap {
            next_sequence,
            dropped_events,
            ..
        }) = page.gap
        else {
            panic!("missing gap")
        };
        assert!(dropped_events > 0);
        assert_eq!(next_sequence, page.frames[0].cursor);
        assert!(replay.read("qa", 81).is_err());
        assert!(replay.bytes <= CACHE_BYTES);
    }
}
