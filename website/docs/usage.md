---
sidebar_position: 40
title: 用量统计
description: 本地聚合 CLI 会话日志，看清 token 花在哪
---

# 用量统计

按 `⌘U`（Windows `Ctrl+Shift+U`）打开用量面板，看 token 花在哪个模型、哪个项目上。

## 数据从哪来

**直接读取本地 CLI 会话数据并聚合，不发任何网络请求。** 支持 Codex、Claude Code，以及新增的 Antigravity CLI、OpenCode、Kimi Code。数据全程留在你机器上。

原生记录没有提供的模型、缓存量和套餐额度保持未知。OpenCode 总量包含辅助请求；无法归属模型的部分单独显示。Kimi 的逐条用量只累计一次，Antigravity 缺少的完整文件内容不会被推算成 diff。

## 四类 token

Belfry 把 token 归一成四个口径，避免不同 CLI 各算各的：

| 口径 | 含义 |
| --- | --- |
| `input` | 输入 token（**不含缓存命中**） |
| `cachedInput` | 命中上下文缓存的部分 |
| `cacheWrite` | 写入上下文缓存 |
| `output` | 输出 token |

把 `input` 和 `cachedInput` 分开，是因为缓存命中的计费往往低很多，混在一起算会高估真实开销。

## 两个维度拆分

- **按模型** — 看哪个模型最烧钱
- **按项目** — 看哪个项目最烧钱

时间窗口可选：**近 7 天 / 近 30 天 / 全部**。

## 配额与套餐

如果日志里带配额窗口与套餐类型，面板会一并展示。**注意：目前只有 Codex 的日志带这些字段，Claude 的不带**，所以 Claude 会话看不到配额信息。

:::caution 只是参考
用量面板的数字来自 Agent 自己写的本地日志，**只能当参考，不是账单**。请以服务商控制台为准。
:::
