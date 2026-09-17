---
sidebar_position: 2
title: 安装
description: 下载 Belfry 与首次打开的放行说明
---

# 安装

## 下载

安装包在 [GitHub Releases](https://github.com/ChengSoon/belfry-desktop/releases) 页面，三个构建目标：

| 平台 | 产物 |
| --- | --- |
| macOS Apple Silicon | `aarch64` 安装包 |
| macOS Intel | `x64` 安装包 |
| Windows | 安装程序 |

## 系统要求

- **macOS** 14 或更高
- **Windows** 10 22H2 (Build 19045) 或 Windows 11

## 首次打开

macOS 与 Windows 的安装包目前**没有做代码签名与公证**，所以系统会拦一下。这是正常的，按下面放行即可：

### macOS

安装包使用 ad-hoc 签名但未经 Apple 公证，首次打开若被 Gatekeeper 拦截，任选一种：

- 在 Finder 中**右键**点击应用，选择「打开」
- 或去「系统设置 → 隐私与安全性」，在底部点击「仍要打开」

### Windows

SmartScreen 会提示「未知发布者」：点击「**更多信息**」→「**仍要运行**」。

## 自动更新

Belfry 内置自动更新。新版本发布后，应用内会提示，确认后下载安装并重启。你也可以在「关于」设置页查看当前版本与更新状态。

:::tip 想自己管？
不信任自动更新也没关系，随时可以去 [Releases](https://github.com/ChengSoon/belfry-desktop/releases) 手动下载新版本覆盖安装，配置与会话记录不会丢。
:::
