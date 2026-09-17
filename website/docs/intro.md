---
sidebar_position: 1
title: Belfry 是什么
description: 托管 CLI Agent 的跨平台终端工作台
---

# Belfry 是什么

Belfry 是一个桌面应用，在 macOS 和 Windows 上用同一套界面运行 [Codex](https://github.com/openai/codex)、Claude Code、Pi CLI 这类命令行 Agent，同时它本身也是一个完整的终端。

简单说：**它托管你机器上已经装好的 CLI Agent，帮你看清它们在忙什么、在等谁。**

## 它解决什么问题

直接在系统终端里跑 CLI Agent 有几个不方便：

- **开多个会话要开多个终端窗口**，切来切去容易迷失
- **不知道哪条会话已经跑完、哪条在等你确认**，只能逐个翻窗口
- **token 花在哪了没数**，得自己去翻日志
- **想让两个 Agent 互相配合**，只能靠人肉复制粘贴

Belfry 把这些收进一个工作台：分屏并排、状态一目了然、通知只在真正需要你的时候响、用量自动统计，还能让会话之间直接派活。

## 设计取向

理解这几个取舍，能帮你判断 Belfry 适不适合你：

- **CLI 请求由 Agent 直接发送。** Provider 切换改的是 CLI 自己的配置文件，API Key 按 CLI 的方式存在本机。Belfry 的主界面以终端和会话管理为中心，不做中间层代理。
- **Agent 不可用时完整退化为普通终端。** Agent 集成是增强，不是前置条件。检测失败不该让你打不开一个 Shell。
- **平台差异收敛在适配器里。** 业务代码里不写 `if (windows)`，但菜单、快捷键、窗口行为跟随各自平台习惯，不追求逐像素相同。

## 产品边界

Belfry 是 **macOS / Windows 的本地终端与 CLI Agent 工作台**。以下不在范围内：

- iOS / Android / Web 版
- 云同步、账号体系、云端团队协作
- LSP 或调试器
- 静默提权

:::note 权限提醒
Belfry 是终端与会话的托管层，不对 Agent 在你机器上执行的命令负责。Agent 的权限就是你 Shell 的权限：给它读写文件、跑构建、装依赖的能力，它就有能力删掉不该删的东西。**请在有版本控制的目录里用它**，重要操作自己过一眼。
:::

## 下一步

- [安装](./install.md) — 下载与首次打开的放行说明
- [快速开始](./quickstart.md) — 五分钟跑起第一个会话
