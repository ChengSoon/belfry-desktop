---
doc_type: issue-fix
issue: 2026-08-10-macos-app-icon-padding
path: fast-track
fix_date: 2026-08-10
tags: [macos, icon, tauri]
---

# macOS 应用图标留白过大修复记录

## 1. 问题描述

macOS 中的 Belfry 应用图标显示为带有大面积白色方形画布的小图标，主体尺寸明显小于同位置的其他应用图标。

## 2. 根因

- 原始图标使用完全不透明的浅色背景，四角 alpha 为 255，macOS 因此把整张方形画布作为图标内容显示。
- 图标主体只覆盖约 62% 的画布，系统缩放后视觉尺寸进一步变小。
- Tauri 的 `bundle.icon` 为空，生成的 `.app` 没有包含 `icon.icns`，`Info.plist` 也没有 `CFBundleIconFile`。

## 3. 修复方案

- 将 macOS 主图标改为透明外围背景，保留 Belfry 图形和圆角面板，主体覆盖率调整为约 81%。
- 重新生成包含 16px 至 1024px 全部分辨率层的 `icon.icns`。
- 在 Tauri bundle 配置中显式声明 `icons/icon.icns`。

## 4. 改动文件清单

- `src-tauri/icons/belfry-logo-source.png`
- `src-tauri/icons/icon.icns`
- `src-tauri/tauri.conf.json`

## 5. 验证结果

- Tauri 配置通过 JSON 解析。
- `icon.icns` 可由 `iconutil` 正常解包，10 个尺寸层均存在透明通道，四角 alpha 均为 0。
- 主体覆盖率在主要尺寸层稳定为约 81% × 82%。
- 跳过无关前端预构建后，`pnpm tauri build --bundles app --config '{"build":{"beforeBuildCommand":""}}'` 成功生成 `Belfry.app`。
- 最终 `Info.plist` 中 `CFBundleIconFile=icon.icns`，包内图标与仓库图标 SHA-256 完全一致。
- 完整默认构建仍被工作区中与本问题无关的侧栏模块缺失阻断；本次未修改该部分代码。
- 当前环境的 Quick Look 缩略图服务未返回，已终止本次预览进程；需在 Finder / Dock 中进行最终人工视觉确认。

## 6. 遗留事项

- 在 macOS Finder 或 Dock 中打开新构建的 `Belfry.app`，确认系统图标缓存刷新后的视觉尺寸。
