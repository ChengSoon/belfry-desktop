---
sidebar_position: 21
title: Provider 切换
description: 在官方端点与第三方中转之间切换 Codex / Claude Code 的路由
---

# Provider 切换

在官方端点与第三方中转之间切换 Codex / Claude Code 的路由。

## 关键：改的是 CLI 自己的配置

**Provider 切换修改的是 CLI 自己的配置文件**，不是 Belfry 内部的代理层。这意味着：

- 在 Belfry 里切完，**在 Belfry 之外直接敲 `claude`、`codex` 一样生效**
- API Key 按 CLI 的方式保存在本机配置中

## 精准字段改写

切换时**只动路由相关的字段**：

- `ANTHROPIC_BASE_URL` 这类路由键
- `[model_providers.belfry]` 这张表

你的 **hooks、MCP 定义、项目信任记录逐字不动**。

## 不会静默覆盖

第一次打开时，Belfry 会把配置文件里已有的设置**收编成一条可切回的条目**。切来切去随时能回到原来的配置，不会被悄悄覆盖。

## 登录态保护

切到第三方 provider 之前，Belfry 会**先备份 Codex 的 ChatGPT 登录态**，切回官方时原样还原。不用重新登录。

## 环境变量检测

如果你在环境变量里设了 `ANTHROPIC_*` 或 `OPENAI_*`，检测到它们会**盖过配置文件**时，Belfry 会给出提示，避免你以为是配置文件在生效、其实是环境变量在生效。

:::tip 与插件的关系
可选插件可以通过宿主的模型 API 调用已配置的服务。插件的能力与权限边界属于另一套体系，见[插件](./plugins.md)。
:::
