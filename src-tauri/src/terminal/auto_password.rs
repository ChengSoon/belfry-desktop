//! 自动应答 SSH 登录密码提示。
//!
//! OpenSSH 不接受命令行传密码，唯一通道是像人一样在提示出现时把密码敲进去。
//! 这里挂在 PTY 的 reader 上：扫描输出尾部，第一次命中密码提示就回写一次密码，
//! 然后立即停用——密码错了就由用户手动补，绝不在同一次会话里反复猜。

/// 只保留输出末尾这一段用于判定：提示本身很短，窗口开大了反而容易误命中。
const TAIL_LIMIT: usize = 128;

pub(super) struct AutoPassword {
    password: Vec<u8>,
    armed: bool,
    tail: Vec<u8>,
}

impl AutoPassword {
    pub fn new(password: &str) -> Self {
        Self {
            password: password.as_bytes().to_vec(),
            armed: true,
            tail: Vec::new(),
        }
    }

    /// 喂入一段子进程输出；命中密码提示时返回应回写的字节（密码 + 回车）。
    pub fn on_output(&mut self, bytes: &[u8]) -> Option<Vec<u8>> {
        if !self.armed || bytes.is_empty() {
            return None;
        }
        self.tail.extend_from_slice(bytes);
        if self.tail.len() > TAIL_LIMIT {
            self.tail.drain(..self.tail.len() - TAIL_LIMIT);
        }
        if is_password_prompt(&self.tail) {
            self.armed = false;
            let mut reply = self.password.clone();
            reply.push(b'\r');
            Some(reply)
        } else {
            None
        }
    }
}

/// 屏幕尾部是否停在密码提示上。常见形态：
/// `user@host's password: `、`Password: `（keyboard-interactive）、
/// `Password for user@host: `。统一判据：行尾是冒号，且近尾窗口里出现 password。
fn is_password_prompt(tail: &[u8]) -> bool {
    let text = String::from_utf8_lossy(tail);
    let line = text
        .trim_end()
        .rsplit(|character| character == '\r' || character == '\n')
        .next()
        .unwrap_or_default();
    line.ends_with(':') && line.to_ascii_lowercase().contains("password")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_classic_and_keyboard_interactive_prompts_once() {
        let mut responder = AutoPassword::new("hunter2");
        let reply = responder
            .on_output(b"root@example.com's password: ")
            .unwrap();
        assert_eq!(reply, b"hunter2\r");
        // 已停用：后续再出现提示（比如密码错误后的重试）不再自动填。
        assert!(
            responder
                .on_output(b"Permission denied, please try again.\r\nroot@example.com's password: ")
                .is_none()
        );
    }

    #[test]
    fn answers_a_password_for_prompt() {
        let mut responder = AutoPassword::new("hunter2");
        assert!(
            responder
                .on_output(b"Password for user@example.com: ")
                .is_some()
        );
    }

    #[test]
    fn recognizes_a_prompt_split_across_chunks() {
        let mut responder = AutoPassword::new("hunter2");
        assert!(responder.on_output(b"root@example.com's pass").is_none());
        assert!(responder.on_output(b"word: ").is_some());
    }

    #[test]
    fn stays_silent_without_a_prompt() {
        let mut responder = AutoPassword::new("hunter2");
        assert!(responder.on_output(b"banner text\r\n$ ").is_none());
        assert!(responder.on_output(b"ls -la\r\n").is_none());
    }

    #[test]
    fn password_text_on_a_previous_line_does_not_trigger() {
        let mut responder = AutoPassword::new("hunter2");
        assert!(
            responder
                .on_output(b"Password authentication is enabled\r\nChoice: ")
                .is_none()
        );
    }

    #[test]
    fn non_ascii_output_before_the_prompt_is_safe() {
        let mut responder = AutoPassword::new("hunter2");
        assert!(
            responder
                .on_output("欢迎连接服务器：password: ".as_bytes())
                .is_some()
        );
    }

    #[test]
    fn ignores_when_disarmed() {
        let mut responder = AutoPassword::new("hunter2");
        assert!(responder.on_output(b"password: ").is_some());
        assert!(responder.on_output(b"password: ").is_none());
    }
}
