---
sidebar_position: 30
title: 终端
description: xterm.js、PTY、SSH 与终端内容处理
---

# 终端

Agent 不在场时，Belfry 就是一个完整终端。这一层有不少打磨。

## 渲染

基于 **xterm.js 6 + WebGL renderer**，块字符之间没有横缝，CJK、组合字符和 emoji 按正确宽度显示，不会错位。

## 平台后端

| 平台 | 后端 |
| --- | --- |
| macOS | Unix PTY |
| Windows | ConPTY |

Windows 上 Shell 依次探测 **PowerShell**、`%ComSpec%`、`cmd.exe`。

## SSH 会话

SSH 会话**直接拉起系统 OpenSSH 客户端**，不走任何中间层：

- 密码、主机指纹、2FA 都在终端里**原生交互**
- `~/.ssh/config` 的**别名、密钥和 agent 原样继承**
- 连接时勾选「**记住密码**」，密码存进系统钥匙串（macOS Keychain / Windows 凭据管理器），之后自动填入
- SSH 表单里可随时**清除已保存的密码**

## 终端内容处理

- **`⌘F` 搜索**当前终端内容，支持跨换行匹配
- **HTTP(S) 地址可点击**直接打开
- **密码提示识别**，输入不回显
- 终端输出中的**文件路径可点击跳转**到文件预览窗格

## 一个看不见的细节：OSC 颜色查询

TUI 程序（Codex 就是）会通过 OSC 10/11 序列查询终端的前景/背景色，来决定自己画什么颜色。Belfry 在 **Rust 侧直接应答**，而不是让查询走一圈 `PTY → IPC → xterm.js → IPC → PTY`。

为什么必须绕开这一圈：**Codex 这类 TUI 只给 100 ms 窗口**，走一圈 IPC 经常超时。而在 Windows 上，超时的后果不是「没颜色」，而是**猜错颜色**——Codex 会退回读 ConPTY 的黑色调色板，把输入框画成黑块。
