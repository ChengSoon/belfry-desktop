//! Track terminal modes and requests before forwarding native output to xterm.
//! A response-shaped user paste is not exempt unless the PTY actually requested that response.
#[derive(Default)]
pub(super) struct Modes {
    pub bracketed_paste: bool,
    parser: Parser,
    sequence: Option<u64>,
    queries: Vec<(Query, i64)>,
}
#[derive(Default)]
enum Parser {
    #[default]
    Ground,
    Escape,
    Csi(String),
    String(bool),
}
#[derive(Clone)]
enum Query {
    Cursor(bool),
    Status(bool),
    Attributes(bool),
    Mode(String),
    Window,
}
impl Modes {
    pub fn observe(&mut self, sequence: u64, bytes: &[u8], now: i64) {
        if self.sequence.is_some_and(|previous| sequence <= previous) {
            return;
        }
        self.sequence = Some(sequence);
        for &byte in bytes {
            let state = std::mem::take(&mut self.parser);
            self.parser = match state {
                Parser::Ground if byte == 0x1b => Parser::Escape,
                Parser::Escape if byte == b'[' => Parser::Csi(String::new()),
                Parser::Escape if matches!(byte, b']' | b'P' | b'_' | b'^') => Parser::String(false),
                Parser::Escape if byte == b'c' => {
                    self.bracketed_paste = false;
                    self.queries.clear();
                    Parser::Ground
                }
                Parser::Csi(params) if (0x40..=0x7e).contains(&byte) => {
                    self.csi(&params, byte, now);
                    Parser::Ground
                }
                Parser::Csi(mut params) if params.len() < 128 && (0x20..=0x3f).contains(&byte) => {
                    params.push(byte as char);
                    Parser::Csi(params)
                }
                Parser::String(escape) if byte == 7 || escape && byte == b'\\' => Parser::Ground,
                Parser::String(_) => Parser::String(byte == 0x1b),
                _ => Parser::Ground,
            };
        }
    }
    pub fn reset(&mut self) {
        self.bracketed_paste = false;
        self.parser = Parser::Ground;
        self.queries.clear();
    }
    fn csi(&mut self, params: &str, final_byte: u8, now: i64) {
        if matches!(final_byte, b'h' | b'l')
            && params.strip_prefix('?').is_some_and(|values| values.split(';').any(|value| value == "2004"))
        {
            self.bracketed_paste = final_byte == b'h';
        }
        let query = match (params, final_byte) {
            ("6", b'n') => Some(Query::Cursor(false)),
            ("?6", b'n') => Some(Query::Cursor(true)),
            ("5", b'n') => Some(Query::Status(false)),
            ("?5", b'n') => Some(Query::Status(true)),
            ("" | "0", b'c') => Some(Query::Attributes(false)),
            (">" | ">0", b'c') => Some(Query::Attributes(true)),
            (_, b'p') if params.ends_with('$') && params.starts_with('?') => {
                Some(Query::Mode(params.trim_end_matches('$').to_string()))
            }
            ("14" | "16" | "18" | "19", b't') => Some(Query::Window),
            _ => None,
        };
        self.queries.retain(|(_, deadline)| *deadline > now);
        if let Some(query) = query {
            if self.queries.len() == 32 {
                self.queries.remove(0);
            }
            self.queries.push((query, now + 5_000));
        }
    }
    pub fn response(&mut self, bytes: &[u8], now: i64) -> bool {
        if bytes.is_empty() || bytes.len() > 1024 {
            return false;
        }
        self.queries.retain(|(_, deadline)| *deadline > now);
        let mut remaining = bytes;
        let mut available = self.queries.clone();
        while !remaining.is_empty() {
            let Some(tail) = remaining.strip_prefix(b"\x1b[") else {
                return false;
            };
            let Some(end) = tail.iter().position(|byte| (0x40..=0x7e).contains(byte)) else {
                return false;
            };
            let Ok(params) = std::str::from_utf8(&tail[..end]) else {
                return false;
            };
            let final_byte = tail[end];
            let Some(index) = available.iter().position(|(query, _)| query.matches(params, final_byte)) else {
                return false;
            };
            available.remove(index);
            remaining = &tail[end + 1..];
        }
        self.queries = available;
        true
    }
}
fn numbers(value: &str, count: Option<usize>) -> bool {
    let parts: Vec<_> = value.split(';').collect();
    count.is_none_or(|count| parts.len() == count)
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.len() <= 6 && part.bytes().all(|byte| byte.is_ascii_digit()))
}
impl Query {
    fn matches(&self, params: &str, final_byte: u8) -> bool {
        match self {
            Self::Cursor(private) => {
                final_byte == b'R'
                    && if *private {
                        params.strip_prefix('?').is_some_and(|p| numbers(p, Some(2)))
                    } else {
                        numbers(params, Some(2))
                    }
            }
            Self::Status(private) => final_byte == b'n' && params == if *private { "?0" } else { "0" },
            Self::Attributes(secondary) => {
                final_byte == b'c'
                    && params.strip_prefix(if *secondary { '>' } else { '?' }).is_some_and(|p| numbers(p, None))
            }
            Self::Mode(mode) => {
                final_byte == b'y'
                    && params
                        .strip_prefix(&format!("{mode};"))
                        .is_some_and(|tail| matches!(tail, "0$" | "1$" | "2$" | "3$" | "4$"))
            }
            Self::Window => final_byte == b't' && numbers(params, Some(3)),
        }
    }
}
