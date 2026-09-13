use super::{
    contracts::HookMessage,
    input, machine,
    server::{IO_TIMEOUT, MAX_MESSAGE_BYTES},
};
use crate::agent::AgentKind;
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
};

pub(super) const ENV_PORT: &str = "BELFRY_HOOK_PORT";
pub(super) const ENV_TOKEN: &str = "BELFRY_HOOK_TOKEN";
const MAX_PAYLOAD_BYTES: u64 = 2 * 1024 * 1024;

pub(crate) fn run_if_requested() -> bool {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("--belfry-hook") {
        return false;
    }
    let kind = match args.get(1).map(String::as_str) {
        Some("codex") => Some(AgentKind::Codex),
        Some("claude") => Some(AgentKind::Claude),
        _ => None,
    };
    if let Some(kind) = kind {
        forward_stdin(kind);
    }
    // 所有 Hook 都只观察；包括 Stop 在内均返回不带决策的空对象。
    println!("{{}}");
    true
}

fn forward_stdin(agent: AgentKind) {
    let Some(port) = std::env::var(ENV_PORT)
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
    else {
        return;
    };
    let Some(token) = std::env::var(ENV_TOKEN)
        .ok()
        .filter(|value| value.len() == 26)
    else {
        return;
    };
    let at = machine::now();
    let mut bytes = Vec::new();
    if std::io::stdin()
        .take(MAX_PAYLOAD_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() > MAX_PAYLOAD_BYTES as usize
    {
        return;
    }
    if let Some(input) = input::from_payload(&bytes, at) {
        let _ = send(
            port,
            &HookMessage {
                version: 1,
                token,
                agent,
                input,
            },
        );
    }
}

pub(super) fn send(port: u16, message: &HookMessage) -> bool {
    let Ok(mut bytes) = serde_json::to_vec(message) else {
        return false;
    };
    bytes.push(b'\n');
    if bytes.len() > MAX_MESSAGE_BYTES as usize {
        return false;
    }
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, IO_TIMEOUT) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    if stream.write_all(&bytes).is_err() {
        return false;
    }
    let mut reply = String::new();
    BufReader::new(stream.take(MAX_MESSAGE_BYTES))
        .read_line(&mut reply)
        .is_ok()
        && serde_json::from_str::<serde_json::Value>(&reply).is_ok_and(|value| value["ok"] == true)
}
