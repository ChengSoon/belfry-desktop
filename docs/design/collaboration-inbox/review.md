# 协作收件箱 · 设计验收

2026-11-10。整合分支 `design/collaboration-inbox-review`，包含后端设计 `697f3fa` 与只读原型 `bf7a63d`。本轮交付设计与示例原型，生产调度尚未接入。

## 交付范围

默认界面只有会话列表和消息详情，可筛选会话、查看原文及必要状态。后续消息继续汇集到稳定会话，后台另按明确议题组织投递。合并、发送和批次管理不进入人类默认界面。

原文、投递状态、问题答复和任务交差分别表达。任务送达不能冒充完成，未投递问题不能计成“已投递待回复”。“打开会话”目前仅为示例定位提示。

## 已完成检查

| 检查 | 结果 |
| --- | --- |
| 后端四份文档与人类读模型 | 会话列表/消息详情边界一致，内部调度接口保留在协议文档 |
| 原型自带 Chromium 检查 | 17/17 通过，覆盖只读界面、身份区分、状态文案、示例状态变化、主题及窄窗阅读 |
| HTTP 预览与字体 | 从仓库根加载，资源失败 0，字体完成加载，脚本异常 0 |
| 1440×960、720×480、390×844 | 会话列表没有横向溢出；长角色名“资深全栈开发工程”可显示 |
| 小窗口真实点击 | 能进入消息详情并返回会话列表 |

检查命令（在仓库根运行）：

```sh
node --experimental-websocket docs/design/collaboration-inbox/prototype/tools/verify.mjs /tmp/belfry-inbox-review-final-ui
```

验证环境为 macOS、Node 20、本机无头 Chrome。Node 20 需要上述 WebSocket 参数。HTTP 检查使用临时本地端口，逐个尺寸加载最终原型，并通过真实鼠标点击验证返回。

证据：[原型检查日志](screenshots/review-ui.txt)、[HTTP 与布局记录](screenshots/review-http.json)、[桌面截图](screenshots/1440-sessions.png)、[小窗口详情](screenshots/720-detail.png)、[390 宽长名称检查](screenshots/390-long-name.png)。

## 后续生产实现

演示控制仅驱动本地示例状态，不是持久化、输入仲裁、不可变批次或恢复协议的实现依据。真实任务与多 Agent 协商的调度仍按 [投递协议](dispatch-protocol.md) 后续实现和验收。本轮没有运行生产迁移、真实 Agent 投递或全量 CI；Windows/WebView2 和英文文案尚未验证。
