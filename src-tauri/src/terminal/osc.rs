//! 就地应答子进程发出的 OSC 10 / OSC 11 前景、背景色查询。
//!
//! 为什么不把这件事留给 xterm.js：
//! - Codex 这类 TUI 启动时发 `ESC ] 10 ; ? ST` + `ESC ] 11 ; ? ST`，只给 100ms 窗口，
//!   两条都答上才算数。绕一圈 `PTY → IPC → xterm.js → IPC → PTY` 在冷启动时经常超时。
//! - Windows 上超时的后果不是"没颜色"而是"猜错颜色"：Codex 退回读
//!   `GetConsoleScreenBufferInfoEx`，在 ConPTY 下拿到的是 conhost 自己的黑色调色板，
//!   于是把输入框按深色底渲染成黑块。
//!
//! 在 reader 线程里直接回，往返只有几微秒。命中的查询必须从转发给前端的字节里剔除，
//! 否则 xterm.js 会再答一遍，多出来的那份回复会被子进程当成键盘输入落进编辑框。

const BEL: u8 = 0x07;
const ESC: u8 = 0x1b;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Rgb(pub u8, pub u8, pub u8);

impl Rgb {
    /// 只认 `#rrggbb`：前端主题里就是这一种写法，别的格式没有来源。
    pub(super) fn parse(value: &str) -> Option<Self> {
        let hex = value.strip_prefix('#')?;
        // 长度之外还要挡住 `from_str_radix` 认的符号位，`#+a+b+c` 不该被当成颜色。
        if hex.len() != 6 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        let channel = |at: usize| u8::from_str_radix(hex.get(at..at + 2)?, 16).ok();
        Some(Self(channel(0)?, channel(2)?, channel(4)?))
    }
}

/// 终端的默认前景 / 背景色，由前端按当前主题下发。
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Palette {
    pub foreground: Rgb,
    pub background: Rgb,
}

impl Palette {
    pub(super) fn parse(foreground: &str, background: &str) -> Option<Self> {
        Some(Self {
            foreground: Rgb::parse(foreground)?,
            background: Rgb::parse(background)?,
        })
    }
}

pub(super) struct Filtered {
    /// 转发给前端的字节，已剔除被我们应答掉的查询。
    pub forward: Vec<u8>,
    /// 立刻回写给子进程的应答，可能一次命中两条。
    pub reply: Vec<u8>,
}

/// 扫描 PTY 输出，挑出 OSC 10/11 查询。
///
/// 状态只有一个"待判定缓冲"：见到 `ESC` 就先扣住，逐字节核对是否还是查询的前缀，
/// 落空就把扣住的字节按原顺序放行。缓冲上限 8 字节，正常输出流不受影响。
#[derive(Default)]
pub(super) struct OscColorFilter {
    /// 上限 8 字节：`ESC ] 1 1 ; ? ESC \` 就是判定一条查询要看的全部。
    held: Vec<u8>,
}

impl OscColorFilter {
    pub(super) fn feed(&mut self, chunk: &[u8], palette: Option<Palette>) -> Filtered {
        let Some(palette) = palette else {
            // 不知道主题就不能应答——瞎答等于骗子进程。原样放行，退回 xterm.js 自己答。
            let mut forward = std::mem::take(&mut self.held);
            forward.extend_from_slice(chunk);
            return Filtered {
                forward,
                reply: Vec::new(),
            };
        };
        let mut filtered = Filtered {
            forward: Vec::with_capacity(chunk.len()),
            reply: Vec::new(),
        };
        for &byte in chunk {
            self.push(byte, palette, &mut filtered);
        }
        filtered
    }

    /// 流结束时把没凑够一条序列的残字节吐出去，不然它们会被永远吞掉。
    pub(super) fn flush(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.held)
    }

    fn push(&mut self, byte: u8, palette: Palette, filtered: &mut Filtered) {
        self.held.push(byte);
        // 落空时只放行首字节，剩下的重新起头判定：`ESC ESC ] 11 ; ? BEL` 里
        // 第二个 ESC 仍是一条合法查询的开头，不能跟着一起放掉。
        loop {
            match classify(&self.held) {
                Verdict::Partial => return,
                Verdict::Query(query) => {
                    filtered.reply.extend_from_slice(&query.response(palette));
                    self.held.clear();
                    return;
                }
                Verdict::Miss => {
                    filtered.forward.push(self.held.remove(0));
                    if self.held.is_empty() {
                        return;
                    }
                }
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Slot {
    Foreground,
    Background,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Terminator {
    Bel,
    St,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Query {
    slot: Slot,
    terminator: Terminator,
}

impl Query {
    /// 应答格式与 xterm 一致：每通道 16 位，8 位值按 `c * 0x0101` 展宽。
    /// 终止符照抄请求里的那一个——只扫 BEL 的客户端不会漏读。
    fn response(self, palette: Palette) -> Vec<u8> {
        let (code, Rgb(r, g, b)) = match self.slot {
            Slot::Foreground => (10, palette.foreground),
            Slot::Background => (11, palette.background),
        };
        let wide = |channel: u8| u16::from(channel) * 0x0101;
        let mut response = format!(
            "\x1b]{code};rgb:{:04x}/{:04x}/{:04x}",
            wide(r),
            wide(g),
            wide(b)
        )
        .into_bytes();
        match self.terminator {
            Terminator::Bel => response.push(BEL),
            Terminator::St => response.extend_from_slice(b"\x1b\\"),
        }
        response
    }
}

enum Verdict {
    /// 还可能是一条查询，继续等。
    Partial,
    /// 确定不是，首字节可以放行。
    Miss,
    Query(Query),
}

/// 逐位比对 `ESC ] 1 <0|1> ; ? <BEL | ESC \>`。
fn classify(held: &[u8]) -> Verdict {
    const PREFIX_LEN: usize = 6;
    for (at, &byte) in held.iter().take(PREFIX_LEN).enumerate() {
        let expected = match at {
            0 => byte == ESC,
            1 => byte == b']',
            2 => byte == b'1',
            3 => byte == b'0' || byte == b'1',
            4 => byte == b';',
            _ => byte == b'?',
        };
        if !expected {
            return Verdict::Miss;
        }
    }
    if held.len() < PREFIX_LEN {
        return Verdict::Partial;
    }
    let slot = if held[3] == b'0' {
        Slot::Foreground
    } else {
        Slot::Background
    };
    let query = |terminator| Verdict::Query(Query { slot, terminator });
    match held.get(PREFIX_LEN) {
        None => Verdict::Partial,
        Some(&BEL) => query(Terminator::Bel),
        // ST 是双字节 `ESC \`，得再看一位。
        Some(&ESC) => match held.get(PREFIX_LEN + 1) {
            None => Verdict::Partial,
            Some(b'\\') => query(Terminator::St),
            Some(_) => Verdict::Miss,
        },
        Some(_) => Verdict::Miss,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIGHT: Palette = Palette {
        foreground: Rgb(0x26, 0x27, 0x2b),
        background: Rgb(0xfa, 0xfa, 0xfa),
    };

    fn feed_all(chunks: &[&[u8]]) -> (Vec<u8>, Vec<u8>) {
        let mut filter = OscColorFilter::default();
        let (mut forward, mut reply) = (Vec::new(), Vec::new());
        for chunk in chunks {
            let filtered = filter.feed(chunk, Some(LIGHT));
            forward.extend_from_slice(&filtered.forward);
            reply.extend_from_slice(&filtered.reply);
        }
        forward.extend_from_slice(&filter.flush());
        (forward, reply)
    }

    #[test]
    fn answers_both_queries_and_strips_them_from_the_forwarded_stream() {
        // Codex 就是这样一次性发两条的。
        let (forward, reply) = feed_all(&[b"hi\x1b]10;?\x1b\\\x1b]11;?\x1b\\bye"]);
        assert_eq!(forward, b"hibye");
        assert_eq!(
            reply,
            b"\x1b]10;rgb:2626/2727/2b2b\x1b\\\x1b]11;rgb:fafa/fafa/fafa\x1b\\".to_vec()
        );
    }

    #[test]
    fn mirrors_a_bel_terminated_request() {
        let (forward, reply) = feed_all(&[b"\x1b]11;?\x07"]);
        assert!(forward.is_empty());
        assert_eq!(reply, b"\x1b]11;rgb:fafa/fafa/fafa\x07".to_vec());
    }

    #[test]
    fn reassembles_a_query_split_across_reads() {
        // PTY 一次 read 切在哪里不由我们决定，逐字节喂是最狠的分片。
        let bytes = b"\x1b]11;?\x1b\\";
        let chunks: Vec<&[u8]> = bytes.iter().map(std::slice::from_ref).collect();
        let (forward, reply) = feed_all(&chunks);
        assert!(forward.is_empty());
        assert_eq!(reply, b"\x1b]11;rgb:fafa/fafa/fafa\x1b\\".to_vec());
    }

    #[test]
    fn passes_through_other_sequences_untouched() {
        // 设置色（不带 ?）、标题、CSI 都不能被吞。
        let stream = b"\x1b]11;#ff0000\x07\x1b]0;title\x07\x1b[31mred\x1b[0m\x1b]12;?\x07";
        let (forward, reply) = feed_all(&[stream]);
        assert_eq!(forward, stream.to_vec());
        assert!(reply.is_empty());
    }

    #[test]
    fn replays_a_false_start_without_losing_the_real_query() {
        // 前一条是残缺的 OSC，后面紧跟真查询：残缺的要原样放行，真的要答。
        let (forward, reply) = feed_all(&[b"\x1b]11;?\x1b]11;?\x07"]);
        assert_eq!(forward, b"\x1b]11;?".to_vec());
        assert_eq!(reply, b"\x1b]11;rgb:fafa/fafa/fafa\x07".to_vec());
    }

    #[test]
    fn holds_at_most_one_sequence_worth_of_bytes() {
        let mut filter = OscColorFilter::default();
        let filtered = filter.feed(b"\x1b]11;?\x1b", Some(LIGHT));
        assert!(filtered.forward.is_empty());
        assert!(filter.held.len() <= 8);
        // 悬着的 ESC 不能凭空消失。
        assert_eq!(filter.flush(), b"\x1b]11;?\x1b".to_vec());
    }

    #[test]
    fn without_a_palette_the_stream_is_untouched() {
        let mut filter = OscColorFilter::default();
        let filtered = filter.feed(b"\x1b]11;?\x1b\\", None);
        assert_eq!(filtered.forward, b"\x1b]11;?\x1b\\".to_vec());
        assert!(filtered.reply.is_empty());
    }

    #[test]
    fn parses_only_six_digit_hex_colors() {
        assert_eq!(Rgb::parse("#fafafa"), Some(Rgb(0xfa, 0xfa, 0xfa)));
        assert_eq!(Rgb::parse("#0A0A0B"), Some(Rgb(0x0a, 0x0a, 0x0b)));
        assert_eq!(Rgb::parse("fafafa"), None);
        assert_eq!(Rgb::parse("#fff"), None);
        assert_eq!(Rgb::parse("#gggggg"), None);
    }
}
