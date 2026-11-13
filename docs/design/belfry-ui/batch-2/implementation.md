# 批次 2：曜石 Obsidian 前端实施记录

2026-11-12，房间「UI设计」T7。按已选定的 [曜石令牌](../obsidian-tokens.md) 第 9 节顺序 1–3 实施。完整基线对比与原生窗口衔接由后端 T9 继续复核。

## 最终行为

亮、暗两套默认主题改为冷中性表面与靛蓝强调色，正文、辅助文字、状态色和浮层统一采用定稿令牌。画布只修改 `src/theme/canvas.json`，CSS、构建 HTML、startup、React 与 xterm 继续使用 T4 的单一来源。

| 角色 | 暗色 | 亮色 |
| --- | --- | --- |
| 窗口底 / 侧栏 | `#0c0d10` | `#ececef` |
| 内容 / 终端画布 | `#131418` | `#ffffff` |
| 强调 | `#8b93ff` | `#484ed4` |
| 运行 / 成功 | `#5fd4a0` | `#0f6c48` |

工作主区为 12px 圆角内容面，上、右、下内缩 8px，侧栏收起时左侧也补 8px。侧栏右边线移除，选中会话用不占布局的 2px 竖条与 500 字重，保持现有行高。主区尺寸瞬时更新；终端网格、PTY、滚动缓冲与会话节点的生命周期保持原有逻辑。

macOS 主区从 y=8px 开始，内部只补足 28px Overlay 标题栏尚未让出的空间；Windows 主区从 y=48px 开始，即 40px 自绘标题栏下方再留 8px，内部不重复计算标题栏高度。窗控的尺寸与命中区域保留。以上是浏览器中的平台布局验收，原生交通灯、DPI 和系统阴影由 T9 复核。

菜单、popover、toast 使用 `--shadow-md`，对话框和抽屉使用 `--shadow-lg`，移除这些浮层重复的 border。插件中心通过宿主主题桥统一浮层、遮罩和控件颜色，第三方 iframe 的样式保持其自身管理。常用输入框和选择控件使用 `--border-strong`；弱分隔继续使用半透明 `--border`。工具栏菜单与项目弹层按工作主区的可用宽度约束，在 720×480 窗口中可滚动、操作可达。

核对全部 CSS 的 `--success` 用途后，发现均为运行、完成、保存、导入数量、环境正常或 diff 新增。现有选中控件已经引用 accent；保留这些绿色状态，避免将「运行中」误改成「当前选中」。终端 ANSI 蓝改为约 208° 的天蓝，与 UI 靛蓝拉开；亮色对比度兜底仍为 7，暗色仍为 1，white 与 brightBlack 的既有可读性规则保留。Codex 输入区的混色测试更新为新画布的截断结果，算法未改。

## 用户偏好与壁纸

保留字体、字号、导入字体、壁纸、适配方式、透明度、模糊和亮暗各自的 veil；主题切换没有迁移或重置偏好。壁纸开启时，主区背景透明，终端 body 继续使用用户的 veil，主区阴影保留。侧栏、Windows 标题栏及设置导航共用 `--sidebar-translucency`：暗色 90%、亮色 94%；当前会话底保持不透明，竖条在反向壁纸上仍清晰。默认原生材质保持不透明，本批未增加毛玻璃开关。

新增两平台浏览器用例使用真实解码的黑白 PNG 与保存的 JetBrains Mono / 17px 偏好，分别验证亮暗主题、1440×960 / 720×480、长项目列表、工具菜单、侧栏折叠和设置往返。检查了实际表面的 alpha、终端 veil、偏好存储和终端节点连接状态。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 主题 / xterm / Codex 主题同步专项 | 3 文件、52 项通过，包含在全量中 |
| `pnpm test` | **193 文件、1252 项通过** |
| `pnpm build` | **通过**；保留既有大于 500kB 分块提示 |
| 生产 UI 浏览器回归 | **11 组通过，0 失败 / 跳过**；browserErrors、errors、unhandled 均为空 |
| 定稿令牌与源码核对 | **76 个颜色 / 阴影取值逐项一致** |
| `node docs/design/belfry-ui/obsidian-contrast.mjs` | **退出 0，全部达标** |
| 退出动效与生命周期 | **180ms** 与 `Presence.EXIT_MS` 一致；Provider 原有切换动效保留 |
| whitespace / JS 语法 | 通过 |

主题回归覆盖正文、三档文字、强调及四种状态在七类表面上的对比度，控件描边和竖条 ≥3:1，主按钮文字与软强调底文字 ≥4.5:1。生产构建会把纯白 CSS 压成 `#fff`，检测先将三位 hex 展开为六位，再与 meta 的 `#ffffff` 比较；这是相同 RGB 颜色的格式差异。首帧与 xterm 仍由同一份六位画布配置生成。

最终构建：`index-C1gJpsbW.js` / `index-Diatt1Dn.css`。资产与精选截图 SHA-256 见 [manifest](verified/manifest.json)。保存了 [Vitest](verified/vitest.log)、[构建](verified/build.log)、[浏览器](verified/browser.log) 和 [对比度](verified/contrast.log) 日志。

## 精选截图

共 14 张，使用生产 dist、独立 Chrome profile 与合成 IPC；**是平台 CSS 截图，不是原生 Tauri 窗口截图**。完整浏览器截图位于本轮 `/tmp/belfry-ui-t7-browser-final/`。T2 的改前基线与 T4 的最终构建截图均保留，供 T9 的完整 36 张矩阵对比使用。

| 场景 | macOS 布局 | Windows 布局 |
| --- | --- | --- |
| 主工作台 1440×960 | [暗色](verified/macos/workbench-dark-1440x960.png) · [亮色](verified/macos/workbench-light-1440x960.png) | 完整矩阵由 T9 生成 |
| 壁纸 720×480 | [暗色](verified/macos/wallpaper-dark-720x480.png) · [亮色](verified/macos/wallpaper-light-720x480.png) | [暗色](verified/windows/wallpaper-dark-720x480.png) · [亮色](verified/windows/wallpaper-light-720x480.png) |
| 窄窗工具菜单 | [亮色](verified/macos/tools-light-720x480.png) | [亮色](verified/windows/tools-light-720x480.png) |
| 窄窗长项目列表 | [暗色](verified/macos/projects-dark-720x480.png) | [暗色](verified/windows/projects-dark-720x480.png) |
| 侧栏收起 | [亮色](verified/macos/collapsed-light-720x480.png) | [亮色](verified/windows/collapsed-light-720x480.png) |
| 壁纸与字体设置 | [亮色](verified/macos/wallpaper-settings-light.png) | [亮色](verified/windows/wallpaper-settings-light.png) |

## 重跑

```sh
pnpm test
pnpm build
node docs/design/belfry-ui/obsidian-contrast.mjs
BELFRY_PANEL_ARTIFACTS=/tmp/belfry-ui-t7-browser node --test --test-concurrency=1 src/components/lazy/testing/production-ui.case.mjs
```

现有 remote/rooms 未提交功能文件未编辑；测试在当前共享工作区运行，覆盖包含这些并行功能的完整源码。`--canvas` 的 meta 与 xterm 一致性、真实原生窗口首次展示与标题栏衔接是不同层面的检查；本批已完成前者，后者交 T9。
