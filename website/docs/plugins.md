---
sidebar_position: 41
title: 插件
description: 用 .piplug 扩展 Belfry
---

# 插件

Belfry 支持可选插件，能力边界由插件自己声明。

## 三种装法

在**设置**中：

- 安装 `.piplug` 包
- 加载本地开发目录（开发阶段直接指向源码目录）
- 从**插件市场**选择安装

## 插件能做什么

插件可以提供：

- **面板**（Panel）
- **命令**（Command）
- **Agent 工具**（Agent tool）
- **Skill**
- **设置**（Settings）
- **主题**（Theme）

:::info 可执行插件需要 Node.js
可执行插件需要本机 **Node.js 20 或更新版本**。只提供纯静态资源（主题、样式）的插件不需要。
:::

## 开发与分发

Belfry 为插件开发者提供：

- **模板创建** — 快速起一个插件骨架
- **校验** — 打包前检查清单与权限
- **打包** — 生成可分发的 `.piplug`
- **本地「我的插件市场」** — 把做好的插件放到自己的本地市场
- 也可使用**独立的在线目录**

## 深入了解

插件的具体能力与权限边界，以及自有市场的搭建，见仓库内的 `docs/plugins/pi-runtime-guide.md` 与 `docs/plugins/own-market-guide.md`（随源码分发）。
