use super::*;
use std::{io::{Read, Write}, net::TcpListener, thread};

fn mock_server(replies: Vec<(u16, &'static str)>) -> (String, thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let mut requests = Vec::new();
        for (status, body) in replies {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 1024];
            while !bytes.windows(4).any(|part| part == b"\r\n\r\n") {
                let read = stream.read(&mut buffer).unwrap();
                assert!(read > 0);
                bytes.extend_from_slice(&buffer[..read]);
            }
            requests.push(String::from_utf8(bytes).unwrap().to_lowercase());
            write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        }
        requests
    });
    (url, worker)
}

#[test]
fn preserves_prefix_and_avoids_duplicate_version() {
    assert_eq!("https://example.com/claude/v1/models", endpoints("https://example.com/claude/").unwrap()[0].as_str());
    assert_eq!("https://example.com/v1/models", endpoints("https://example.com/v1/").unwrap()[0].as_str());
    assert_eq!(2, endpoints("http://localhost:8080").unwrap().len());
}

#[test]
fn rejects_unsafe_or_ambiguous_urls() {
    for url in ["file:///tmp/key", "https://key@example.com", "https://example.com?key=x", "bad"] {
        assert!(endpoints(url).is_err());
    }
}

#[test]
fn parses_models_and_rejects_unexpected_formats() {
    let value = serde_json::json!({"data":[{"id":"a"},{"id":" "},{"id":"b","display_name":"B"}]});
    assert_eq!(vec!["a", "b"], parse_ids(&value).unwrap());
    assert!(parse_ids(&serde_json::json!({"error":"denied"})).is_err());
}

#[test]
fn fallback_preserves_prefix_and_sends_bearer() {
    let (url, server) = mock_server(vec![(404, "{}"), (200, r#"{"data":[{"id":"z"},{"id":"a"},{"id":"z"}]}"#)]);
    let models = tauri::async_runtime::block_on(fetch(AgentKind::Codex, &format!("{url}/gateway"), "demo-key")).unwrap();
    assert_eq!(vec!["a", "z"], models);
    let requests = server.join().unwrap();
    assert!(requests[0].starts_with("get /gateway/v1/models "));
    assert!(requests[1].starts_with("get /gateway/models "));
    assert!(requests[0].contains("authorization: bearer demo-key"));
    assert!(!requests[0].contains("x-api-key"));
}

#[test]
fn claude_pagination_sends_anthropic_headers() {
    let (url, server) = mock_server(vec![(200, r#"{"data":[{"id":"a"}],"has_more":true,"last_id":"a"}"#), (200, r#"{"data":[{"id":"b"}],"has_more":false}"#)]);
    let models = tauri::async_runtime::block_on(fetch(AgentKind::Claude, &url, "demo-key")).unwrap();
    assert_eq!(vec!["a", "b"], models);
    let requests = server.join().unwrap();
    assert!(requests[0].contains("x-api-key: demo-key"));
    assert!(requests[0].contains("anthropic-version: 2023-06-01"));
    assert!(requests[1].starts_with("get /v1/models?after_id=a "));
}

#[test]
fn authentication_error_does_not_expose_response_or_retry() {
    let (url, server) = mock_server(vec![(401, "private-error-body")]);
    let error = tauri::async_runtime::block_on(fetch(AgentKind::Claude, &url, "demo-key")).unwrap_err();
    assert!(error.message.contains("认证失败"));
    assert!(!error.message.contains("private-error-body"));
    assert!(!error.message.contains("demo-key"));
    assert_eq!(1, server.join().unwrap().len());
}

#[test]
fn rejects_html_and_accepts_empty_list() {
    for (body, expected) in [("<html>login</html>", false), (r#"{"data":[]}"#, true)] {
        let (url, server) = mock_server(vec![(200, body)]);
        let result = tauri::async_runtime::block_on(fetch(AgentKind::Codex, &url, ""));
        assert_eq!(expected, result.is_ok());
        let requests = server.join().unwrap();
        assert!(!requests[0].contains("authorization:"));
    }
}

#[test]
fn refuses_redirects() {
    let (url, server) = mock_server(vec![(302, "")]);
    let error = tauri::async_runtime::block_on(fetch(AgentKind::Codex, &url, "demo-key")).unwrap_err();
    assert!(error.message.contains("302"));
    server.join().unwrap();
}
