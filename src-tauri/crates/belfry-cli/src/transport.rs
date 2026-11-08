//! 每次系统调用都扣除已用时间，半行/持续滴流不能延长整次 IPC 截止时间。
use std::{io::{self, Read, Write}, time::{Duration, Instant}};

pub const IPC_TIMEOUT: Duration = Duration::from_secs(5);
pub const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;
const READINESS_INTERVAL: Duration = Duration::from_millis(2);

enum Socket {
    #[cfg(unix)]
    Unix(std::os::unix::net::UnixStream),
    Tcp(std::net::TcpStream),
}
pub struct Transport { socket: Socket, deadline: Instant }

fn remaining(deadline: Instant) -> io::Result<Duration> {
    deadline.checked_duration_since(Instant::now()).filter(|duration| !duration.is_zero())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "IPC deadline exceeded"))
}

impl Transport {
    pub fn connect(endpoint: &str, deadline: Instant) -> io::Result<Self> {
        let socket = if let Some(path) = endpoint.strip_prefix("unix:") {
            #[cfg(unix)] {
                let socket = socket2::Socket::new(socket2::Domain::UNIX, socket2::Type::STREAM, None)?;
                socket.connect_timeout(&socket2::SockAddr::unix(path)?, remaining(deadline)?)?;
                let socket: std::os::fd::OwnedFd = socket.into();
                Socket::Unix(socket.into())
            }
            #[cfg(not(unix))] {
                let _ = path;
                return Err(io::Error::new(io::ErrorKind::Unsupported, "Unix socket is not supported on this platform"));
            }
        } else if let Some(address) = endpoint.strip_prefix("tcp:") {
            // Belfry 只发布数值 loopback 地址；不在截止时间外执行 DNS。
            let address: std::net::SocketAddr = address.parse().map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Invalid numeric IPC address"))?;
            Socket::Tcp(std::net::TcpStream::connect_timeout(&address, remaining(deadline)?)?)
        } else {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Unknown IPC endpoint format"));
        };
        // Kernel socket timeouts are not the operation deadline. Keep reads and
        // writes nonblocking so every readiness retry checks our absolute clock.
        match &socket {
            #[cfg(unix)]
            Socket::Unix(stream) => stream.set_nonblocking(true)?,
            Socket::Tcp(stream) => stream.set_nonblocking(true)?,
        }
        Ok(Self { socket, deadline })
    }
}
impl Read for Transport {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        until_deadline(self.deadline, || match &mut self.socket {
            #[cfg(unix)]
            Socket::Unix(stream) => stream.read(bytes),
            Socket::Tcp(stream) => stream.read(bytes),
        })
    }
}
impl Write for Transport {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        until_deadline(self.deadline, || match &mut self.socket {
            #[cfg(unix)]
            Socket::Unix(stream) => stream.write(bytes),
            Socket::Tcp(stream) => stream.write(bytes),
        })
    }
    fn flush(&mut self) -> io::Result<()> { remaining(self.deadline).map(|_| ()) }
}

fn until_deadline<T>(deadline: Instant, mut operation: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    loop {
        remaining(deadline)?;
        match operation() {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                std::thread::sleep(remaining(deadline)?.min(READINESS_INTERVAL));
            }
            result => return result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regression_a_temporarily_unready_socket_waits_for_the_reply_within_its_deadline() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let endpoint = format!("tcp:{}", listener.local_addr().unwrap());
        let mut transport = Transport::connect(&endpoint, Instant::now() + Duration::from_secs(1)).unwrap();
        match &transport.socket {
            Socket::Tcp(socket) => socket.set_nonblocking(true).unwrap(),
            #[cfg(unix)]
            Socket::Unix(_) => unreachable!(),
        }
        let (mut peer, _) = listener.accept().unwrap();
        let writer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(25));
            peer.write_all(b"reply").unwrap();
        });
        let mut reply = [0; 5];
        let result = transport.read_exact(&mut reply);
        writer.join().unwrap();
        result.expect("WouldBlock is temporary readiness, not a failed response");
        assert_eq!(&reply, b"reply");
    }
}
