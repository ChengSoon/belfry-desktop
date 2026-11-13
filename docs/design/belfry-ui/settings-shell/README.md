# T23 / T25 / T26 接续交付（T27）

> 后续更新 T28：用户要求「右侧不允许留白」，设置正文已取消 880px 上限，Provider 已取消空轨道。**当前版本**见 [T28 说明](full-width/README.md) 和 [最新修前 / 修后截图](full-width/index.html)。下文的限宽与空轨道结论是 T27 的历史记录。

入口：[设计稿 / 最终实装、修前 / 修后并排报告](index.html)。

本次从共享工作区接续三项未完成任务，没有回退其他成员的改动。T23 的初版浮起设置外壳、Provider `auto-fill` 网格，以及 T26 的 Rust 命令、hook 和品牌令牌已经存在；本次补齐实现、逐条走查与最终验收。

## 设置外壳（T23）

依据 `obsidian-screens/obsidian.css`、`settings.html`、`settings-sections.html`：

- 导航与窗口背景使用同一 `sidebar/backdrop`，取消导航右边线；桌面导航宽 **240px**。
- 内容面内缩 **8px**，**r12 / shadow-content**。macOS 上沿 8px，交通灯让位留给导航；Windows 内容面从 40px 自绘标题栏下面再留 8px。窗口原生装饰不由浏览器截图模拟。
- 桌面左右内边距 **32px**。稿子的 `.page` 为 `border-box; max-width: 880px`，所以内容正文上限应为 **816px**，已修正原来把 880 当正文宽度的偏差。插件中心的全宽布局保留，不套用设置表单的限宽。
- ≤1024px 保留 196px 导航与 24px 正文留白；≤640px 改为上下布局、正文左右 16px 留白、四周保留浮起面。补了高特异度覆盖，否则原有单列断点会被桌面双列规则压住。
- 壁纸、字体、字号偏好继续沿用现有配置。设置外壳与终端始终分离，打开设置不会卸载终端。
- Provider 网格沿用稿子的 `auto-fill + minmax(260px, 1fr)`：1440 宽只有一张卡时保留其余两条空轨道，实际卡宽 264px，列表宽 816px；窄窗按可用空间减列。

实现：`src/components/obsidianSurfaces.css`、`src/settings/obsidianSections.css`；Provider 网格的既有接续代码在 `src/provider/provider.css`。

## T20 的 10 条偏差走查结论

| # | 结论 | 理由与处理 |
| --- | --- | --- |
| 1 高级配置列表入口 | 保留现有编辑页入口；建议不在本批新增数据流 | 现有原始配置预览绑定 Provider 草稿与显式敏感内容同意。列表页没有草稿对象，直接加按钮会改变读取、保存和未保存保护流程。本次没有自行改行为，已向用户提供两个选择。 |
| 2 已选用徽标和启用按钮 | 接受 | 保留 `provider-card__selection` 的交叉淡入淡出契约；静止后显示正确状态，Provider 卡片翻转和碎裂动效未改。 |
| 3 Hook 行尾短文案 | 符合稿子 | 可见按钮使用「预览启用 / 预览移除」，完整 Agent 名保留在 aria-label，避免每行按钮宽度不齐。 |
| 4 Hook 部分安装时补齐入口 | 接受 | 有缺失或过期事件时必须保留「预览启用」修复能力；不能为静态稿移除原有能力。 |
| 5 后台任务常驻列表 | 符合稿子 | 进入会话状态页只读加载一次，保持原有结束 / 清除操作。 |
| 6 快捷键录制额外动作 | 接受 | 保留「停用 / 恢复此项默认」既有功能，幽灵按钮层级低于保存。 |
| 7 保存后快捷键预览 | 接受 | 「保存后」预览和冲突说明同时保留，属于已有录制反馈；冲突仍禁用保存。 |
| 8 环境检查条目数量 | 数据差异 | 条目由后端报告决定，合成数据只有 1 项，不应写死为稿子的示例条目数。 |
| 9 CLI 发布说明 note | 接受 | 有数据才显示的辅助说明，沿用 faint 文字层级；不改变行尾动作。 |
| 10 外壳不是浮起面 | 已修复 | 见上节及修前 / 修后 16 对截图。额外对齐了导航宽、页面含内边距宽度与 640px 断点。 |

并排报告中的另外两项差异已明确标注：设计稿交通灯为演示图形，生产 macOS 交通灯由原生窗口绘制；外观页保留生产已有的语言、主题插件、字体预览和背景配置，稿子里的侧栏毛玻璃等未实现能力没有新增。外观页表单内部结构的既有差异沿用 T21 的说明，本次 T23 只处理外壳与页面宽度。

## 第二轮审查 UI 修复（T25）

| 项 | 实施 |
| --- | --- |
| L7 | 弹窗所有普通 / 主 / 危险按钮 disabled 均为 opacity .45、default 光标；hover 只匹配非 disabled。生产用例实际挂起 Provider 保存，核对禁用取消按钮悬停前后不变。 |
| L8 | 顶栏会话从不完整的 tablist/tab 改为 `role=group`，组名「同项目会话」；当前按钮 `aria-current=page`，title 只写会话名。中英文文案齐全。分离 HEAD 使用短提交号与本地化标题。 |
| L9 | `obsidianWorkbench.css` 两处 Claude 图标橙色改用既有 `--brand-claude`，与设置分区共用亮暗令牌；对比度脚本通过。 |
| L10 | `styles.css` 唯一定义 `--toolbar-height: 44px`，删除 `:root:root` 重复覆盖。 |
| L11 | 删除 `.workbench-search span/kbd`、`.sidebar-brand*`、`.sidebar-foot__label` 及相应窄窗死规则。 |

## 分支读取性能（T26）

`WorkbenchToolbar.BranchCrumb` 已改用 `useGitBranch`，不再调用 `useGitStatus`。沿用已写好的 `git_branch`：普通分支只执行一次 `symbolic-ref --short -q HEAD`；分离 HEAD 才补一次 `rev-parse --short HEAD`；不调用 status、不扫描 untracked 文件。

| 场景 | 改前 | 改后 |
| --- | --- | --- |
| 只开工作台 | 每 3 秒一路 `git_status`，每轮至少两次 Git 子进程 | 初次与项目目录变化时各读一次分支；窗口获焦或重新可见时刷新；静置没有定时调用 |
| 同时打开 Git 面板 | 面包屑与面板各自每 3 秒轮询 | 只保留 Git 面板自身的状态轮询 |
| 分离 HEAD | 字面量 `(detached)` | 短提交号，例如 `a1b2c3d`，title 为「分离 HEAD · a1b2c3d」 |
| 非仓库 / 失败 | 无完整状态时隐藏 | 隐藏，获焦后可恢复，不产生页面报错 |

生产检查：初次 `git_branch=1 / git_status=0`；静置 6.5 秒后调用数不变；四次显式 focus 刷新后为 `5 / 0`。React hook 的目录依赖是 `project.rootPath`，没有新增终端内部实时 cwd 探测。

## 最终验证和证据

- 最终构建：`index-jjqkZ_uD.js` / `index-CZtyR30e.css`，`pnpm build` 通过。
- `pnpm test`：196 个文件 / 1267 项通过。
- `cargo check` 通过；Rust `branch_reads_named_detached_and_non_repository_without_scanning` 通过（含无提交分支、Unicode 分支、分离 HEAD、非仓库）。
- `obsidian-contrast.mjs` 与 `git diff --check` 通过。
- 定向生产浏览器 5/5：页面限宽、分支刷新与恢复、真实 busy 禁用态、两平台浮起面及三列网格。页面异常、console error、未处理 IPC 均为零。
- 设置截图脚本 3/3：7 分区亮暗 + 录制态 16 张；macOS / Windows 标记、亮暗、720×480、最大字号 20 的 7 分区共 28 张，均无横向溢出，终端保持挂载。
- 全量生产浏览器 **159/159** 通过，31 个用例文件，零失败；最终日志 `logs/browser-full.log`。包含现有设置、Provider 动效 / 未保存保护、Quick Open、插件中心、房间、键盘与终端挂载回归。
- 并排 HTML 实际用隔离 Chrome 打开：**98/98** 图片引用全部解码成功，1280px 和 700px 下无横向溢出；`logs/report-verification.log`。

证据目录：

| 目录 | 内容 |
| --- | --- |
| `before/` | 接手时已有的 16 张 T23 修前截图，保留原文件 |
| `after/` | 最终构建：两平台、亮暗、1440×960 / 720×480 / 640×720，外观与 Provider 共 24 张，另含分离 HEAD / busy 两张 |
| `sections/` | 最终 7 分区与快捷键录制态，亮暗各一张，1440×1200 |
| `stress/` | 两平台标记 720×480 / font20 的 28 张截图 |
| `manifest.json` | PNG 尺寸 / SHA-256、构建资产 SHA-256 |
| `logs/` | 本次实际运行的构建、测试、浏览器与对比度日志 |

复现：

```sh
pnpm build
pnpm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml branch_reads_named_detached_and_non_repository_without_scanning
node docs/design/belfry-ui/obsidian-contrast.mjs
BELFRY_HANDOFF_ARTIFACTS=docs/design/belfry-ui/settings-shell/after node --test --test-concurrency=1 src/components/lazy/testing/ui-handoff.case.mjs src/components/lazy/testing/settings-layout.case.mjs
BELFRY_SECTIONS_OUT=docs/design/belfry-ui/settings-shell/sections node --test scripts/capture-settings-sections.case.mjs scripts/capture-settings-stress.case.mjs
node --test --test-concurrency=2 src/components/lazy/testing/*.case.mjs
```

浏览器截图验证的是同一份生产 dist 与合成 IPC；Windows 标记不等于 Windows WebView2 真机运行。T17 的原生窗口首次显现、阴影、圆角与主题切换仍按 `../code-review.md` 中的真机清单验收，本次没有声称已经完成真机验证。
