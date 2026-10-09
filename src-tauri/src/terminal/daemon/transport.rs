use super::protocol::{Command, Endpoint, MAX_FRAME, Reply, Request, VERSION};
use crate::terminal::AppError;
use serde::{Serialize, de::DeserializeOwned};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

pub const IO_TIMEOUT: Duration = Duration::from_secs(15);

pub fn prepare_peer(stream: &TcpStream) -> Result<(), String> {
    // BSD/macOS accept 会继承非阻塞标志；分帧读取和 write_all 需要带超时的阻塞连接。
    stream.set_nonblocking(false).map_err(io)?;
    stream.set_read_timeout(Some(IO_TIMEOUT)).map_err(io)?;
    stream.set_write_timeout(Some(IO_TIMEOUT)).map_err(io)
}

pub fn read<T: DeserializeOwned>(stream: &mut impl Read) -> Result<T, String> {
    let mut header = [0_u8; 4];
    stream.read_exact(&mut header).map_err(io)?;
    let size = u32::from_be_bytes(header) as u64;
    if size == 0 || size > MAX_FRAME {
        return Err("后台消息大小超出限制".into());
    }
    let mut body = vec![0; size as usize];
    stream.read_exact(&mut body).map_err(io)?;
    serde_json::from_slice(&body).map_err(|_| "后台消息格式不支持".into())
}

pub fn write(stream: &mut impl Write, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(io)?;
    if bytes.len() as u64 > MAX_FRAME {
        return Err("后台消息大小超出限制".into());
    }
    stream
        .write_all(&(bytes.len() as u32).to_be_bytes())
        .map_err(io)?;
    stream.write_all(&bytes).map_err(io)?;
    stream.flush().map_err(io)
}

pub fn connect(port: u16) -> Result<TcpStream, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let stream = TcpStream::connect_timeout(&address, Duration::from_secs(2)).map_err(io)?;
    stream.set_read_timeout(Some(IO_TIMEOUT)).map_err(io)?;
    stream.set_write_timeout(Some(IO_TIMEOUT)).map_err(io)?;
    Ok(stream)
}

pub fn call<T: DeserializeOwned>(endpoint: &Endpoint, command: Command) -> Result<T, String> {
    let mut stream = connect(endpoint.port)?;
    exchange(endpoint, command, &mut stream)
}

pub fn call_app<T: DeserializeOwned>(endpoint: &Endpoint, command: Command) -> Result<T, AppError> {
    let mut stream = connect(endpoint.port).map_err(AppError::io)?;
    write(
        &mut stream,
        &Request {
            version: VERSION,
            token: endpoint.token.clone(),
            command,
        },
    )
    .map_err(AppError::io)?;
    decode_reply(read(&mut stream).map_err(AppError::io)?)
}

fn decode_reply<T: DeserializeOwned>(reply: Reply) -> Result<T, AppError> {
    if let Some(error) = reply.failure {
        return Err(error);
    }
    if let Some(message) = reply.error {
        // Running daemons from older releases only send a string. Keep restoration compatible.
        return Err(if message.starts_with("原后台任务已不存在。") {
            AppError::session_missing()
        } else {
            AppError::io(message)
        });
    }
    serde_json::from_value(reply.result.unwrap_or_default())
        .map_err(|_| AppError::io("后台响应格式不支持"))
}

pub(super) fn exchange<T: DeserializeOwned>(
    endpoint: &Endpoint,
    command: Command,
    stream: &mut TcpStream,
) -> Result<T, String> {
    write(
        stream,
        &Request {
            version: VERSION,
            token: endpoint.token.clone(),
            command,
        },
    )?;
    let reply: Reply = read(stream)?;
    decode_reply(reply).map_err(|error| error.message)
}

fn io(error: impl std::fmt::Display) -> String {
    format!("后台连接失败：{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frames_reject_oversize_truncation_and_invalid_json() {
        let mut large = ((MAX_FRAME + 1) as u32).to_be_bytes().as_slice().to_vec();
        assert!(read::<Reply>(&mut large.as_slice()).is_err());
        large = vec![0, 0, 0, 2, b'{'];
        assert!(read::<Reply>(&mut large.as_slice()).is_err());
        let mut valid = vec![];
        write(&mut valid, &Reply::ok("中文 空格")).unwrap();
        assert_eq!(
            Some(serde_json::json!("中文 空格")),
            read::<Reply>(&mut valid.as_slice()).unwrap().result
        );
    }
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    use crate::terminal::contracts::AppErrorCode;

    #[test]
    fn structured_failures_preserve_code_and_retryability() {
        let reply = Reply::failure(AppError::session_missing());
        let wire = serde_json::to_string(&reply).unwrap();
        let error =
            decode_reply::<serde_json::Value>(serde_json::from_str(&wire).unwrap()).unwrap_err();
        assert_eq!(AppErrorCode::SessionMissing, error.code);
        assert!(!error.retryable);
        // Legacy clients can still read the original string error field.
        assert!(serde_json::from_str::<serde_json::Value>(&wire).unwrap()["error"].is_string());
    }

    #[test]
    fn legacy_missing_session_is_recognized_without_treating_network_errors_as_missing() {
        let old: Reply = serde_json::from_str(
            r#"{"result":null,"error":"原后台任务已不存在。请点击「重启」明确启动新进程"}"#,
        )
        .unwrap();
        assert_eq!(
            AppErrorCode::SessionMissing,
            decode_reply::<serde_json::Value>(old).unwrap_err().code
        );
        let network =
            decode_reply::<serde_json::Value>(Reply::error("后台连接失败：timeout")).unwrap_err();
        assert_eq!(AppErrorCode::IoError, network.code);
        assert!(network.retryable);
    }
}
