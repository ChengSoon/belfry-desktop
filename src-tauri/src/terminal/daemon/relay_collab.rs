use super::{relay::Relay, transport};
use belfry_protocol::{PROTOCOL_VERSION, Response};
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
    let text = match result {
        Ok(response) => response,
        Err(message) => match serde_json::to_string(&Response::error(message)) {
            Ok(response) => format!("{response}\n"),
            Err(_) => return,
        },
    };
    let _ = stream.write_all(text.as_bytes());
}

/// 只读信封（版本、tabId、token），命令原样转给应用。
///
/// 后台进程比应用活得久：应用升级加了新命令（`room task` 之类），旧后台仍在跑。
/// 要是在这里按自己那份命令表解析，新命令一律报「格式无效」，只能重启后台才好。
/// 命令归应用解释，后台只做身份换票；响应同样只核对信封，保留所有类型和字段。
fn forward(line: &str, relay: &Relay) -> Result<String, String> {
    let mut request: serde_json::Value =
        serde_json::from_str(line).map_err(|_| "协作请求格式无效".to_string())?;
    let envelope = request.as_object_mut().ok_or("协作请求格式无效")?;
    if envelope.get("version").and_then(serde_json::Value::as_u64) != Some(u64::from(PROTOCOL_VERSION)) {
        return Err("协作协议版本不匹配".into());
    }
    let field = |name: &str| envelope.get(name).and_then(serde_json::Value::as_str).map(str::to_string);
    let (tab_id, agent_token) = field("tabId").zip(field("token")).ok_or("协作请求格式无效")?;
    let route = relay
        .collab(&tab_id, &agent_token)
        .ok_or("后台协作身份校验失败")?;
    let (endpoint, token) = route
        .collab_target
        .ok_or("应用未连接，重新打开 Belfry 后可继续协作")?;
    envelope.insert("token".into(), serde_json::Value::String(token));
    let mut upstream = connect(&endpoint)?;
    let mut bytes = serde_json::to_vec(&request).map_err(|_| "协作请求编码失败")?;
    bytes.push(b'\n');
    upstream.write_all(&bytes).map_err(|_| offline())?;
    let response = read_line(&mut upstream)?;
    // ResponseData 是 CLI 和应用之间的约定。常驻后台按自己的枚举解析会拒绝新类型，
    // 也会静默丢掉已有类型新增的字段（例如 room say 的 message），令成功写入看似失败。
    let envelope: serde_json::Value = serde_json::from_str(&response).map_err(|_| "应用协作响应无效")?;
    if !matches!(envelope.get("status").and_then(serde_json::Value::as_str), Some("ok" | "error")) {
        return Err("应用协作响应无效".into());
    }
    Ok(response)
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
