# OTTY Desktop

跨平台（macOS + Windows）的 AI 编程终端。托管 Codex、Claude Code 等现有 CLI Agent，在感知它们运行状态的同时，保持一个完整可用的普通终端。

> **状态：早期开发中。** 当前完成的是「打开项目 → 检测 Agent → 启动可切换的 Agent/Shell 标签」这一垂直切片，距离 roadmap 描述的完整形态还很远。详见 [`.codestable/roadmap/otty-desktop/`](.codestable/roadmap/otty-desktop/)。

## 设计取向

- **不代理模型请求。** OTTY 不内置推理客户端，不保存模型 API Key，只托管你本地已装好的 CLI Agent。
- **Agent 不可用时完整退化为普通终端。** Agent 集成是增强，不是前置条件。
- **共享 UI 与核心，按能力而非操作系统名称分支。** 平台差异收敛在适配器里。

## 当前能力

- 打开本地项目目录，记录最近打开过的项目
- 自动检测 Codex 与 Claude Code 是否可用（可执行文件、版本）
- 在项目目录下启动 Shell / Codex / Claude 标签并自由切换
- 基于 xterm.js 的终端：输入输出、缩放、退出
- 用量面板：从本地 Agent 会话日志聚合 token 统计与配额窗口（⌘U）
- 亮/暗主题切换

快捷键：`⌘B` 折叠侧栏，`⌘U` 开关用量面板。

## 技术栈

Tauri 2 + Rust 后端，React 19 + TypeScript + xterm.js 前端。

最低目标平台：macOS 14，Windows 10 22H2 (Build 19045) / Windows 11。

## 开发

需要 [Rust 工具链](https://rustup.rs)、Node.js 与 pnpm 10。

```bash
pnpm install

pnpm desktop:dev      # 启动桌面应用（开发模式）
pnpm desktop:build    # 打包
pnpm test             # 前端测试（vitest）
pnpm build            # 类型检查 + 前端构建
```

Rust 侧测试：

```bash
cd src-tauri && cargo test
```

## 目录结构

```
src/                  前端
  workspace/          项目工作区、标签、侧栏
  terminal/           PTY 会话与 xterm 控制
  usage/              token 用量聚合展示
  theme/              主题
src-tauri/src/        Rust 后端
  terminal/           PTY 后端与生命周期
  usage/              解析 Codex / Claude 会话日志
.codestable/          需求、路线图、架构决策与 feature 设计
```
