# 更新日志

本文件记录 Belfry 面向用户的版本更新，按版本倒序排列。版本日期以 Git 发布节点为准。

当前整理范围：`v0.6.0` 至 `v0.13.0`。

## [0.13.0] - 2026-08-19

### 新增

- **File Preview Pane**：从当前项目浏览目录，打开只读文本预览；文件树按目录优先排序并过滤常见生成目录。
- **安全文件服务**：预览路径由 Rust 校验在项目根目录内，限制单文件读取大小，二进制文件显示不可预览提示。
- **轻量代码高亮**：为常见 Rust、TypeScript、JavaScript、JSON、Markdown、CSS 等文本提供关键词、字符串、数字和注释层次。
- **变更提醒**：文件在磁盘上被修改后，预览区提示重新加载，不会静默覆盖当前阅读位置。
- **工作区入口**：新增文件预览按钮、Quick Open 动作和终端路径链接，预览窗格可独立调整宽度并定位到输出中的行号。

## [0.12.0] - 2026-08-19

### 新增

- **Prompt Composer**：通过 `⌘J`（Windows / Linux 为 `Ctrl+Shift+J`）打开独立编辑器，选择 Codex 或 Claude 会话并提交多行 Prompt。
- **Prompt Queue**：Agent 正在输出或等待确认时，Prompt 按会话分别进入队列；回到 `running + idle` 后按提交顺序逐条发送。
- **队列恢复**：终端目标尚未注册、发送失败或 xterm 重挂时保留未确认 Prompt；关闭会话时自动清理该会话队列。
- **工作区入口**：Quick Open 和快捷指令面板都新增 Prompt Composer 动作。

### 设计边界

- Composer 只驱动 Codex / Claude Agent 会话，不向 Shell 或 SSH 会话注入命令。
- 队列暂存于当前应用内存，关闭 Belfry 后不会恢复；发送仍走 xterm 的 paste + 回车输入链路。

## [0.11.0] - 2026-08-19

### 新增

- **Quick Open**：通过 `⌘K`（Windows / Linux 为 `Ctrl+Shift+K`）打开快速操作面板。
- **统一搜索**：可按会话名、项目路径、Agent 类型和动作关键词模糊搜索，支持中文、大小写不敏感和多词过滤。
- **键盘导航**：上下键循环选择，Home / End 跳转，Enter 执行，Escape 关闭；当前结果会自动滚入可视区域。
- **快速动作**：直接切换会话、打开最近项目、新建 Shell、打开设置 / 历史 / 用量 / 快捷指令，或收起侧栏。

## [0.10.0] - 2026-08-19

### 新增

- **跨平台 Shell Profile**：macOS 支持系统默认、zsh、bash、fish；Windows 支持 PowerShell 7、Windows PowerShell、CMD、WSL、Git Bash，并按固定 allowlist 检测和启动。
- **终端搜索**：`Ctrl/Cmd+F` 打开搜索浮层，支持大小写不敏感、前后匹配、匹配计数、CJK 宽字符和跨 wrapped line 搜索。
- **HTTP(S) 链接**：自动识别终端中的网址，清理句末标点后可点击并在新窗口打开。
- **Unicode 增强**：注册 xterm Unicode provider，改善 CJK、组合字符、emoji、ZWJ emoji 和旗帜显示。
- **会话恢复兼容**：工作区存档保存 Shell Profile，并兼容旧版本存档；SSH 目标继续持久化但不写入密码。

## [0.9.0] - 2026-08-17

### 新增

- **字体与字号管理**：在外观设置中统一调整应用字体和 `10–20px` 字号，并即时预览。
- **字体导入**：支持导入多个 TTF、OTF、WOFF、WOFF2 字体，分别切换、删除，或恢复系统字体。
- **快捷指令系统**：新增全局快捷键注册、会话快速切换、新建 Shell、打开设置和历史面板等操作。
- **快捷指令面板**：通过 `⌘/`（Windows / Linux 为对应的 `Ctrl+Shift` 组合）查看当前平台可用快捷键。

## [0.8.0] - 2026-08-17

### 新增

- **SSH 会话**：从新会话菜单直接启动系统 OpenSSH，继承 `~/.ssh/config`、密钥和 SSH agent。
- **SSH 认证辅助**：支持密码、主机指纹和 2FA 的终端交互；勾选记住密码后，凭据保存到 macOS Keychain 或 Windows 凭据管理器。
- **凭据管理**：可在 SSH 表单中清除已保存的密码。

### 修复

- 修复 Windows 上 OpenSSH 可执行文件的路径解析，避免 SSH 入口检测失败。

## [0.7.0] - 2026-08-16

### 新增

- **历史会话管理**：读取本地 Codex / Claude Code 会话日志，支持列表查看、恢复会话、删除单条或批量清空。
- **Provider 配置编辑器**：在设置中新增 Provider 编辑、配置预览、校验和刷新能力，继续只改写 CLI 配置中的路由字段。
- **背景显示控制**：新增文字衬底调节，并优化背景图片的透明度和模糊效果。
- **透明主题同步**：Codex 透明模式下的终端样式、背景和滚动条跟随应用主题同步。

### 修复

- 修复 Shell 内 Codex 透明主题同步不完整的问题。

## [0.6.0] - 2026-08-15

### 新增

- **Provider 切换**：在官方端点与第三方中转之间切换 Codex / Claude Code，并精准改写 CLI 配置中的路由字段。
- **配置保护**：切换 Codex 第三方 Provider 前备份 ChatGPT 登录态，切回官方时恢复；同时提示会覆盖配置文件的环境变量。
- **活动通知**：Agent 完成任务或等待确认时发送系统通知，并在应用内汇总未读数。

### 修复

- 修复 Windows 构建中错误复用 macOS 专属 Agent 命令路径的问题。

## 版本链接

[0.12.0]: https://github.com/ChengSoon/belfry-desktop/releases/tag/v0.12.0
[0.13.0]: https://github.com/ChengSoon/belfry-desktop/releases/tag/v0.13.0
[0.11.0]: https://github.com/ChengSoon/belfry-desktop/releases/tag/v0.11.0
[0.10.0]: https://github.com/ChengSoon/belfry-desktop/releases/tag/v0.10.0

[0.9.0]: https://github.com/ChengSoon/belfry-desktop/releases/tag/v0.9.0
[0.8.0]: https://github.com/ChengSoon/belfry-desktop/releases/tag/v0.8.0
[0.7.0]: https://github.com/ChengSoon/belfry-desktop/releases/tag/v0.7.0
[0.6.0]: https://github.com/ChengSoon/belfry-desktop/releases/tag/v0.6.0
