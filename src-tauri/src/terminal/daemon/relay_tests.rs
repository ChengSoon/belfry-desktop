use super::{
    relay::{PLUGIN_TOKEN, PLUGIN_URL, Relay, plugin_port},
    transport,
};
use crate::terminal::CreateTerminalRequest;
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    thread,
};

fn request() -> CreateTerminalRequest {
    serde_json::from_value(
        serde_json::json!({ "platform": "macos", "profileId": "agent:claude", "tabId": "qa-tab",
        "cwd": "file:///tmp", "cols": 80, "rows": 24, "elevation": "normal" }),
    )
    .unwrap()
}

fn upstream(expected: &'static str, response: &'static str) -> (u16, thread::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let worker = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(transport::IO_TIMEOUT))
            .unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut lines = String::new();
        let mut length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if let Some(value) = line.strip_prefix("Content-Length: ") {
                length = value.trim().parse().unwrap();
            }
            lines.push_str(&line);
            if line == "\r\n" {
                break;
            }
        }
        assert!(lines.contains(&format!("Authorization: Bearer {expected}\r\n")));
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        stream.write_all(response.as_bytes()).unwrap();
    });
    (port, worker)
}

fn call(port: u16, token: &str, method: &str) -> String {
    let mut stream = transport::connect(port).unwrap();
    let request = format!(
        "{method} /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Length: 2\r\n\r\n{{}}"
    );
    stream.write_all(request.as_bytes()).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
}

#[test]
fn old_agent_credentials_follow_a_new_ui_target_without_authentication_leaks() {
    let relay = Relay::start().unwrap();
    let (first, worker) = upstream(
        "first-ui",
        "HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\none",
    );
    let mut launch = request();
    launch
        .env
        .insert(PLUGIN_URL.into(), format!("http://127.0.0.1:{first}/mcp"));
    launch.env.insert(PLUGIN_TOKEN.into(), "first-ui".into());
    relay.bind("pty", &mut launch).unwrap();
    let token = launch.env[PLUGIN_TOKEN].clone();
    let port = plugin_port(&launch.env[PLUGIN_URL]).unwrap();
    assert_ne!("first-ui", token);
    assert!(call(port, &token, "POST").ends_with("one"));
    worker.join().unwrap();
    assert!(call(port, "wrong", "POST").starts_with("HTTP/1.1 403"));
    assert!(call(port, &token, "POST").starts_with("HTTP/1.1 503"));
    let (second, worker) = upstream(
        "second-ui",
        "HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\ntwo",
    );
    let mut updated = request();
    updated
        .env
        .insert(PLUGIN_URL.into(), format!("http://127.0.0.1:{second}/mcp"));
    updated.env.insert(PLUGIN_TOKEN.into(), "second-ui".into());
    relay.bind("pty", &mut updated).unwrap();
    assert_eq!(token, updated.env[PLUGIN_TOKEN]);
    assert!(call(port, &token, "POST").ends_with("two"));
    worker.join().unwrap();
    relay.remove("pty");
    assert!(call(port, &token, "POST").starts_with("HTTP/1.1 403"));
}

#[test]
fn expired_ui_tickets_are_retryable_and_non_loopback_targets_are_rejected() {
    let relay = Relay::start().unwrap();
    let (port, worker) = upstream(
        "old",
        "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n",
    );
    let mut launch = request();
    launch
        .env
        .insert(PLUGIN_URL.into(), format!("http://127.0.0.1:{port}/mcp"));
    launch.env.insert(PLUGIN_TOKEN.into(), "old".into());
    relay.bind("pty", &mut launch).unwrap();
    let proxy = plugin_port(&launch.env[PLUGIN_URL]).unwrap();
    assert!(call(proxy, &launch.env[PLUGIN_TOKEN], "POST").starts_with("HTTP/1.1 503"));
    worker.join().unwrap();
    for url in [
        "http://example.com:80/mcp",
        "http://127.0.0.1:0/mcp",
        "http://127.0.0.1:80/private",
        "http://127.0.0.1:80/mcp?path=/private",
    ] {
        assert!(plugin_port(url).is_none());
    }
    assert!(call(proxy, &launch.env[PLUGIN_TOKEN], "DELETE").starts_with("HTTP/1.1 405"));
}

#[test]
fn collaboration_rebinds_tokens_and_keeps_the_original_tab_identity() {
    let relay = Relay::start().unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let mut launch = request();
    launch.env.insert(
        belfry_protocol::ENV_ENDPOINT.into(),
        format!("tcp:{}", listener.local_addr().unwrap()),
    );
    launch
        .env
        .insert(belfry_protocol::ENV_TOKEN.into(), "new-ui-secret".into());
    relay.bind("pty", &mut launch).unwrap();
    let port: u16 = launch.env[belfry_protocol::ENV_ENDPOINT]
        .strip_prefix("tcp:127.0.0.1:")
        .unwrap()
        .parse()
        .unwrap();
    let worker = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut line = String::new();
        BufReader::new(stream.try_clone().unwrap())
            .read_line(&mut line)
            .unwrap();
        let request: belfry_protocol::Request = serde_json::from_str(&line).unwrap();
        assert_eq!("new-ui-secret", request.token);
        assert_eq!("qa-tab", request.tab_id);
        stream
            .write_all(b"{\"status\":\"error\",\"message\":\"qa-response\"}\n")
            .unwrap();
    });
    let request = belfry_protocol::Request::new(
        "qa-tab".into(),
        launch.env[belfry_protocol::ENV_TOKEN].clone(),
        belfry_protocol::Command::Peers,
    );
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let mut bytes = serde_json::to_vec(&request).unwrap();
    bytes.push(b'\n');
    stream.write_all(&bytes).unwrap();
    let mut response = String::new();
    BufReader::new(stream).read_line(&mut response).unwrap();
    assert!(response.contains("qa-response"));
    assert!(!response.contains("secret"));
    worker.join().unwrap();
}
