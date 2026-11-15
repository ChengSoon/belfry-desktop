# A2A 项目连接界面

日期：2026-11-16。用户要求去掉面板下半部分的连接列表，只保留上方链路场，并在顶部加入更有辨识度的交互。

## 界面

入口仍是当前项目工具栏的 **A2A**。面板现在只有五块：标题栏、说明与刷新／新增、链路场、选中节点详情、帮助。

- 链路场：项目居中，本地 Agent 在左、外部连接在右；两侧显示数量，已接通链路带缓慢流动的光点，单侧超过三个节点时折叠为 `+N`。
- 节点是可点选按钮：点击后在地图下方出现单张详情卡，显示名称、状态、地址或 Agent、连接 ID 与编辑／删除；再次点击收起。默认不再渲染常驻列表。
- 空态只显示两个虚线占位节点与 `0`，不显示空列表或大块空状态。
- 新增／编辑连接仍使用原表单与 Agent Card 检测预览；编辑与删除确认期间，地图和详情隐藏。
- 视觉与当前 Rooms / Settings 对齐：扁平表面、1px 边框、圆形软色头像、12px 状态文字、下划线标签页（已移除）、无渐变、无发光、无轨道动画。

## 实现

- [LinkField](../../src/a2a/LinkField.tsx) 负责节点布局、链路、流动光点、点选与焦点状态。
- [peers](../../src/a2a/peers.ts) 统一本地／外部节点、状态、可见数量与翻译；本地适配器原因改为渲染时翻译，切换语言不会残留旧文案。
- [kit](../../src/a2a/kit.tsx) 提供圆形软色头像与状态文字；[A2ASection](../../src/a2a/A2ASection.tsx) 组合地图、详情和编辑器。
- 原 `LocalAgents.tsx` 列表已删除；相关原因文案迁移到 `peers.ts`。

## 验证

生产浏览器回归使用未改写的 `dist` 与合成原生 IPC，覆盖项目入口、编辑保护、凭据保留／替换／清除、检测取消与晚结果、跨 origin 接口、本地发现、协议回报和项目隔离。

| 检查 | 结果 |
| --- | --- |
| 前端单测 | `pnpm test`，209 文件 / 1432 项通过 |
| 中英文文案 | `pnpm check:i18n`，每语言 3830 条，0 legacy strings |
| TypeScript 与生产构建 | `pnpm build` 通过 |
| A2A 生产面板回归 | 6 项通过、0 失败／取消／跳过 |
| 本地发现交互 | 地图节点可点选，详情显示原因与状态；英文切换后无残留中文 |
| 窗口尺寸与主题 | 1440px 桌面、390px 地图与详情；明暗主题 |

```sh
pnpm exec vitest run
pnpm check:i18n
pnpm build
BELFRY_PANEL_ARTIFACTS=/tmp/belfry-a2a-redesign-20261115/panels9 node --test --test-concurrency=1 --test-timeout=300000 --test-force-exit src/components/lazy/testing/a2a-connections.case.mjs
```

界面预览：[空态](/tmp/belfry-a2a-redesign-20261115/panels9/production-ui-a2a-project-empty-desktop.png)、[本地 Agent](/tmp/belfry-a2a-redesign-20261115/panels9/production-ui-a2a-project-local-desktop.png)、[外部连接](/tmp/belfry-a2a-redesign-20261115/panels9/production-ui-a2a-project-external-desktop.png)、[新增连接](/tmp/belfry-a2a-redesign-20261115/panels9/production-ui-a2a-project-editor-desktop.png)、[390px](/tmp/belfry-a2a-redesign-20261115/panels9/production-ui-a2a-project-local-390.png)。

实际原生协议与会话适配边界见 [A2A 验收](a2a-validation.md)。
