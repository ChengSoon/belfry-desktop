use super::{relay::Relay, transport};
use belfry_protocol::{PROTOCOL_VERSION, Request, Response};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
};

const MAX_LINE: u64 = 1024 * 1024;

pub fn handle(mut stream: TcpStream, relay: &Relay) {
    if transport::prepare_peer(&stream).is_err() {
        return;
    }
    let result = read_line(&mut stream).and_then(|line| forward(&line, relay));
    let response = result.unwrap_or_else(Response::error);
    if let Ok(mut text) = serde_json::to_vec(&response) {
        text.push(b'\n');
        let _ = stream.write_all(&text);
    }
}

fn forward(line: &str, relay: &Relay) -> Result<Response, String> {
    let mut request: Request =
        serde_json::from_str(line).map_err(|_| "协作请求格式无效".to_string())?;
    if request.version != PROTOCOL_VERSION {
        return Err("协作协议版本不匹配".into());
    }
    let route = relay
        .collab(&request.tab_id, &request.token)
        .ok_or("后台协作身份校验失败")?;
    let (endpoint, token) = route
        .collab_target
        .ok_or("应用未连接，重新打开 Belfry 后可继续协作")?;
    request.token = token;
    let mut upstream = connect(&endpoint)?;
    let mut bytes = serde_json::to_vec(&request).map_err(|_| "协作请求编码失败")?;
    bytes.push(b'\n');
    upstream.write_all(&bytes).map_err(|_| offline())?;
    let response = read_line(&mut upstream)?;
    serde_json::from_str(&response).map_err(|_| "应用协作响应无效".into())
}

trait Connection: Read + Write {}
impl<T: Read + Write> Connection for T {}
fn connect(endpoint: &str) -> Result<Box<dyn Connection>, String> {
    if let Some(port) = endpoint
        .strip_prefix("tcp:127.0.0.1:")
        .and_then(|value| value.parse::<u16>().ok())
    {
        return transport::connect(port)
            .map(|stream| Box::new(stream) as Box<dyn Connection>)
            .map_err(|_| offline());
    }
    #[cfg(unix)]
    {
        if let Some(path) = endpoint
            .strip_prefix("unix:")
            .filter(|path| std::path::Path::new(path).is_absolute())
        {
            let stream = std::os::unix::net::UnixStream::connect(path).map_err(|_| offline())?;
            stream
                .set_read_timeout(Some(transport::IO_TIMEOUT))
                .map_err(|_| offline())?;
            stream
                .set_write_timeout(Some(transport::IO_TIMEOUT))
                .map_err(|_| offline())?;
            return Ok(Box::new(stream));
        }
    }
    Err("仅支持本机协作端点".into())
}

fn read_line(stream: &mut impl Read) -> Result<String, String> {
    let mut line = String::new();
    BufReader::new(stream)
        .take(MAX_LINE + 1)
        .read_line(&mut line)
        .map_err(|_| offline())?;
    if line.len() as u64 > MAX_LINE || !line.ends_with('\n') {
        return Err("协作消息超过上限或不完整".into());
    }
    Ok(line)
}
fn offline() -> String {
    "应用暂未连接；任务仍在后台运行，重新打开 Belfry 后重试".into()
}
