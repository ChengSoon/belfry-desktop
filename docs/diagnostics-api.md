# 日志与诊断接口

`app_log_write({ entry }) -> void`：`entry` 包含 `level: "debug" | "info" | "warn" | "error"`、`source: string`、`message: string`，可选 `stack: string`、`context: Record<string, string>`。来源最多 256 字节、正文 8 KiB、堆栈 32 KiB、上下文最多 32 项，条目总计 64 KiB；超限返回结构化错误。调用失败不应再次调用本接口记录该错误，以免递归。

`diagnostics_export() -> { path: string, sizeBytes: number, createdAt: number, summary: string }`：生成应用数据目录下 `diagnostics/belfry-diagnostics.json`，重复导出覆盖上一份。`createdAt` 是 Unix 秒；`summary` 可直接用于“复制诊断”。导出包含版本、操作系统、架构和脱敏日志，不读取配置、环境变量、Provider 密钥库、房间消息或终端内容。

日志位于应用数据目录的 `logs/`，以 UTC 日期滚动，单片最多 1 MiB，总量最多 10 MiB，保留最近七天。敏感上下文字段、常见密钥/token、Authorization、带凭据 URL 和 PEM 私钥在写入及导出时脱敏；调用方仍应仅传错误信息和诊断字段，不传任意配置或用户文本。Rust 启动即安装 panic hook，记录位置与堆栈；错误条目同步刷盘。
