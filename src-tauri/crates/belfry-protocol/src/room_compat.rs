//! 房间命令穿过尚未升级的常驻后台。
//!
//! 旧后台会按自己的枚举重编码请求和响应，连新增的 peers 能力字段也会丢掉。
//! 保留 v1 的 TaskState 外壳，把房间命令和回执放进原有的字符串字段；这里只是
//! 传输封装，不创建或查询点对点任务。前缀不会与真实的 ULID 任务号冲突。
//! CLI 先用封装后的 Peers 做只读探测，确认往返兼容后才发送一次房间操作。
//! 应用必须先校验外层身份，再解封并走原来的房间权限和投递逻辑。

use crate::{Command, Response, ResponseData};

const PREFIX: &str = "belfry:rooms:v1:";
const MARKER: &str = "belfry:rooms:v1";

fn allowed(command: &Command) -> bool {
    matches!(command, Command::Peers) || command.is_room()
}

pub fn wrap_command(command: &Command) -> Result<Command, String> {
    if !allowed(command) {
        return Err("房间兼容通道只接受能力探测和房间命令".into());
    }
    let payload = serde_json::to_string(command).map_err(|err| format!("请求序列化失败：{err}"))?;
    Ok(Command::TaskState {
        task: format!("{PREFIX}{payload}"),
    })
}

/// 普通任务查询不参与解封；不接受嵌套封装或其他协作命令。
pub fn unwrap_command(command: &Command) -> Option<Result<Command, String>> {
    let Command::TaskState { task } = command else {
        return None;
    };
    let payload = task.strip_prefix(PREFIX)?;
    Some(
        serde_json::from_str::<Command>(payload)
            .map_err(|_| "房间兼容请求格式无效".to_string())
            .and_then(|command| {
                if allowed(&command) {
                    Ok(command)
                } else {
                    Err("房间兼容通道只接受能力探测和房间命令".into())
                }
            }),
    )
}

pub fn wrap_response(response: &Response) -> Response {
    match serde_json::to_string(response) {
        Ok(result) => Response::Ok {
            data: ResponseData::TaskState {
                task: MARKER.into(),
                state: MARKER.into(),
                settled: true,
                result: Some(result),
            },
        },
        Err(_) => Response::error("房间兼容响应编码失败"),
    }
}

pub fn unwrap_response(response: Response) -> Result<Response, String> {
    match response {
        Response::Ok {
            data:
                ResponseData::TaskState {
                    task,
                    state,
                    settled: true,
                    result: Some(result),
                },
        } if task == MARKER && state == MARKER => serde_json::from_str(&result)
            .map_err(|err| format!("回应看不懂：房间兼容回执无效：{err}")),
        Response::Error { message } => Err(message),
        _ => Err("回应看不懂：房间兼容回执标记不匹配".into()),
    }
}
