use super::{relay::Relay, transport};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
    time::Duration,
};

const MAX_HEADERS: usize = 16 * 1024;
const MAX_BODY: usize = 1024 * 1024;
const TOOL_TIMEOUT: Duration = Duration::from_secs(115);

struct HttpRequest {
    method: String,
    token: String,
    body: Vec<u8>,
}

pub fn handle(mut client: TcpStream, relay: &Relay) {
    if transport::prepare_peer(&client).is_err() {
        return;
    }
    if let Err(status) = forward(&mut client, relay) {
        unavailable(&mut client, status);
    }
}

fn forward(client: &mut TcpStream, relay: &Relay) -> Result<(), u16> {
    let request = read_request(client)?;
    let route = relay.plugin(&request.token).ok_or(403_u16)?;
    let (port, token) = route.plugin_target.ok_or(503_u16)?;
    let mut upstream = transport::connect(port).map_err(|_| 503_u16)?;
    upstream
        .set_read_timeout(Some(TOOL_TIMEOUT))
        .map_err(|_| 503_u16)?;
    let header = format!(
        "{} /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nAccept: application/json, text/event-stream\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        request.method,
        port,
        token,
        request.body.len()
    );
    upstream
        .write_all(header.as_bytes())
        .and_then(|_| upstream.write_all(&request.body))
        .map_err(|_| 503_u16)?;
    let mut reader = BufReader::new(upstream);
    let head = read_head(&mut reader).map_err(|_| 503_u16)?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or(503_u16)?;
    // UI 重开前旧票据可能已失效；503 让 Node 的 SSE 自动重试，不永久停订阅。
    if matches!(status, 401 | 403) {
        return Err(503);
    }
    if client.write_all(head.as_bytes()).is_ok() {
        let _ = std::io::copy(&mut reader, client);
    }
    Ok(())
}

fn read_request(client: &mut TcpStream) -> Result<HttpRequest, u16> {
    let mut reader = BufReader::new(client);
    let head = read_head(&mut reader)?;
    let mut lines = head.split("\r\n");
    let first = lines
        .next()
        .ok_or(400_u16)?
        .split_whitespace()
        .collect::<Vec<_>>();
    if first.len() != 3 || first[1] != "/mcp" || first[2] != "HTTP/1.1" {
        return Err(400);
    }
    if first[0] != "GET" && first[0] != "POST" {
        return Err(405);
    }
    let mut token = None;
    let mut length = None;
    for line in lines.filter(|line| !line.is_empty()) {
        let (key, value) = line.split_once(':').ok_or(400_u16)?;
        match key.to_ascii_lowercase().as_str() {
            "authorization" if token.is_none() => {
                token = value.trim().strip_prefix("Bearer ").map(str::to_owned)
            }
            "content-length" if length.is_none() => {
                length = Some(value.trim().parse::<usize>().map_err(|_| 400_u16)?)
            }
            "authorization" | "content-length" | "transfer-encoding" => return Err(400),
            _ => {}
        }
    }
    let length = length.unwrap_or(0);
    if length > MAX_BODY || (first[0] == "GET" && length != 0) {
        return Err(413);
    }
    let token = token.filter(|token| token.len() <= 128).ok_or(403_u16)?;
    let mut body = vec![0; length];
    reader.read_exact(&mut body).map_err(|_| 400_u16)?;
    Ok(HttpRequest {
        method: first[0].into(),
        token,
        body,
    })
}

fn read_head(reader: &mut impl BufRead) -> Result<String, u16> {
    let mut bytes = vec![];
    while !bytes.ends_with(b"\r\n\r\n") {
        let mut byte = [0_u8];
        reader.read_exact(&mut byte).map_err(|_| 400_u16)?;
        bytes.push(byte[0]);
        if bytes.len() > MAX_HEADERS {
            return Err(413);
        }
    }
    String::from_utf8(bytes).map_err(|_| 400_u16)
}

fn unavailable(client: &mut TcpStream, status: u16) {
    let body = if status == 503 {
        "{\"error\":\"Belfry UI is offline; reconnect the session and retry\"}"
    } else {
        "{\"error\":\"Invalid local plugin request\"}"
    };
    let header = format!(
        "HTTP/1.1 {status} Unavailable\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = client.write_all(header.as_bytes());
}
