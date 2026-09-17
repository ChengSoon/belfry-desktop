---
sidebar_position: 3
title: 快速开始
description: 五分钟在 Belfry 里跑起第一个会话
---

# 快速开始

Belfry 不自带 Agent，它托管你机器上已经装好的那些。所以先确认至少有一个能用：

```bash
codex --version
claude --version
```

能看到版本号就行。两个都没有也不影响——Shell 会话不依赖任何 Agent。

## 四步跑起来

### 1. 打开一个项目

启动 Belfry，点击顶部的**项目选择器**，选一个本地目录。这个目录就是你的项目，会话都挂在它下面。

### 2. 新建一个会话

在侧栏的**新会话菜单**里挑选会话类型：Shell、SSH、Codex 或 Claude。

:::info 检测不到的 Agent 会标灰
菜单里检测不到的 Agent 会显示为灰色，鼠标悬停能看到原因（没装、不在 PATH 里、版本太旧等）。
:::

### 3. 跟它说话

会话打开后直接输入。**标签标题会从你的第一句话里提取**，完整原文留在 tooltip 里，鼠标悬停可看。

### 4. 看看花了多少 token

按 `⌘U`（Windows 上是 `Ctrl+Shift+U`）打开用量面板，看 token 花在哪个模型、哪个项目上。详见[用量统计](./usage.md)。

## 同一项目开多个会话

同一个项目下可以并排开多个会话，拖拽标签即可分屏。常见的用法是开一个 Codex 写代码、开一个 Shell 看日志，或者让两个 Agent 分工配合——见[会话协作](./collab.md)。

## 只是当终端用

两个 Agent 都没检测到也无妨。Shell 会话不依赖它们，Belfry 此时就是个普通终端：PowerShell、bash、zsh、fish 都支持，`⌘F` 搜索终端内容，SSH 会话直连系统 OpenSSH。

## 下一步

- [工作区](./workspace.md) — 项目、会话与分屏的组织方式
- [Agent 托管](./agent.md) — 会话状态怎么看
- [快捷键](./shortcuts.md) — 全部快捷键速查
