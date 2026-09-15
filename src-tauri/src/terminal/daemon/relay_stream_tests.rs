use super::{
    relay::{PLUGIN_TOKEN, PLUGIN_URL, Relay, plugin_port},
    transport,
};
use crate::terminal::CreateTerminalRequest;
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::mpsc,
    thread,
};

fn bind(relay: &Relay, port: u16, token: &str) -> (u16, String) {
    let mut request: CreateTerminalRequest = serde_json::from_value(serde_json::json!({
        "platform": "macos", "profileId": "agent:claude", "tabId": "stream-tab",
        "cwd": "file:///tmp", "cols": 80, "rows": 24, "elevation": "normal"
    }))
    .unwrap();
    request
        .env
        .insert(PLUGIN_URL.into(), format!("http://127.0.0.1:{port}/mcp"));
    request.env.insert(PLUGIN_TOKEN.into(), token.into());
    relay.bind("stream-pty", &mut request).unwrap();
    (
        plugin_port(&request.env[PLUGIN_URL]).unwrap(),
        request.env[PLUGIN_TOKEN].clone(),
    )
}

fn read_head(reader: &mut impl BufRead) -> String {
    let mut head = String::new();
    loop {
        let mut line = String::new();
        assert!(reader.read_line(&mut line).unwrap() > 0);
        head.push_str(&line);
        if line == "\r\n" {
            return head;
        }
    }
}

fn stream_upstream(token: &'static str) -> (u16, mpsc::Sender<()>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let (finish, proceed) = mpsc::channel();
    let worker = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(transport::IO_TIMEOUT))
            .unwrap();
        let head = read_head(&mut BufReader::new(stream.try_clone().unwrap()));
        assert!(head.starts_with("GET /mcp HTTP/1.1\r\n"));
        assert!(head.contains(&format!("Authorization: Bearer {token}\r\n")));
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: first\n\n").unwrap();
        // 客户端必须先读到首条事件，服务才继续；由此证明代理没有等待连接关闭。
        proceed.recv_timeout(transport::IO_TIMEOUT).unwrap();
        stream.write_all(b"data: second\n\n").unwrap();
    });
    (port, finish, worker)
}

fn open_stream(port: u16, token: &str) -> BufReader<TcpStream> {
    let mut stream = transport::connect(port).unwrap();
    write!(stream, "GET /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nAccept: text/event-stream\r\n\r\n").unwrap();
    BufReader::new(stream)
}

fn read_event(reader: &mut impl BufRead) -> String {
    let mut event = String::new();
    loop {
        let mut line = String::new();
        assert!(reader.read_line(&mut line).unwrap() > 0);
        if line == "\n" {
            return event;
        }
        event.push_str(&line);
    }
}

#[test]
fn sse_events_arrive_before_close_and_old_credentials_survive_ui_rebinding() {
    let relay = Relay::start().unwrap();
    let mut stable = None;
    for token in ["first-ui", "reopened-ui"] {
        let (port, finish, worker) = stream_upstream(token);
        let route = bind(&relay, port, token);
        if let Some(original) = &stable {
            assert_eq!(original, &route);
        }
        stable = Some(route.clone());
        let mut response = open_stream(route.0, &route.1);
        assert!(read_head(&mut response).starts_with("HTTP/1.1 200"));
        assert_eq!("data: first\n", read_event(&mut response));
        finish.send(()).unwrap();
        assert_eq!("data: second\n", read_event(&mut response));
        worker.join().unwrap();
        let mut offline = open_stream(route.0, &route.1);
        assert!(read_head(&mut offline).starts_with("HTTP/1.1 503"));
    }
}
