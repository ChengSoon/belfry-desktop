use super::protocol::{Command, Endpoint, MAX_FRAME, Reply, Request, VERSION};
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
    if let Some(error) = reply.error {
        return Err(error);
    }
    serde_json::from_value(reply.result.unwrap_or_default())
        .map_err(|_| "后台响应格式不支持".into())
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
