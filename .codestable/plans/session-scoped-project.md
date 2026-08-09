# 项目归属下沉到会话

把 `project` 从全局单例改成每个会话各自持有，并把侧栏的项目切换器与舞台顶部的路径行合并成一个控件。

## 已定的三条语义

1. **换项目 = 重启该会话**。PTY 的 cwd 在 spawn 时定死，改目录只能杀掉旧进程重开。滚屏和前台进程会丢。
2. **新会话继承当前活动会话的项目**。没有活动会话时用最近一次解析到的项目。
3. **侧栏按项目分组**，同项目的会话收在一个标题下。

## 核心数据结构改动

`WorkspaceTab.projectId: string` → `WorkspaceTab.project: ProjectWorkspace`

理由：`SessionTerminal` 需要 `rootUri` 拼 cwd，侧栏分组需要 `name` 和 `rootPath`。存整个对象让 tab 自洽，避免再维护一张 id → project 的映射表。

`projectId` 全仓库只有 3 处引用（contracts / tabs.ts / tabs.test.ts），替换面很小。

## 状态层：useProjectWorkspace

删掉权威的 `project` state，改为：

- `lastProject` —— 最近一次成功解析的项目，仅用于"没有活动会话时新建会话该开在哪"
- `activeProject` —— 派生值：`活动 tab 的 project ?? lastProject`。舞台标题和 `launch` 的继承源都读它

`selectProject(path)` 语义改写（这是行为变化的核心）：

```
解析项目
  ├─ 有活动 tab → 改写该 tab 的 project（触发 PTY 重启）
  └─ 无活动 tab → 在该项目下新建一个 shell 会话
然后更新 lastProject + 写入最近项目历史
```

旧行为是"替换全局项目 + 把所有 tab 重置成一个 shell"，直接删除。

`launch(kind)` 改为从 `activeProject` 取项目。`activeProject` 为空时（首次启动失败等边缘情况）先 `resolveProject(null)` 拿后端默认目录，再建 tab。

会话序号（`Shell 01`）保持**按 kind 全局递增**，不按项目重置——否则两个项目组里会同时出现 `Shell 01`，折叠侧栏或看错误信息时无法区分。

## PTY 重启链路（无需改动，已存在）

`tab.project` 变 → `SessionTerminal` 的 `launch` memo 变（依赖 `project.rootUri`）→ `TerminalViewport` 的 `stableLaunch` 变（依赖 `launch.cwd`）→ `useTerminalSession` 挂载 effect 重跑 → cleanup 关旧会话、mount 开新会话。

`mountTerminal` 挂载时会 `onPhase("creating")` + `onError(null)`，phase 和 error 自动归位，不用手动重置。

## 合并后的控件

侧栏 `.sidebar-top` 整块移除，`ProjectSwitcher` 搬到舞台顶部的 caption 行，成为一个按钮：

```
        [ src-tauri   ~/work/Project/tool/otty-win/src-tauri  ⌄ ]
```

- 项目名用正文色，短路径用 faint 色，右侧 chevron
- 点击展开浮层：最近项目列表 + 「浏览目录…」（原生选择器，已接好 dialog 插件）
- 浮层在触发器下方居中展开（现在的 `left:0;right:0` 会被拉成按钮宽度，要改成居中 + min-width）
- 窄窗口下路径先截断，项目名保留

无会话时 caption 显示 `lastProject` 的路径——它标示"现在点打开 Shell 会开在哪"。

## 侧栏分组

新增纯函数 `groupTabsByProject(tabs)` → `Array<{ project, tabs }>`，按项目首次出现顺序排列，放在 `tabs.ts`（已有 tab 相关纯函数，便于测试）。

只有一个项目时仍显示分组标题——保持结构稳定，避免开第二个项目时布局跳动。

## 改动清单

| 文件 | 改动 |
|---|---|
| `workspace/contracts.ts` | `projectId: string` → `project: ProjectWorkspace` |
| `workspace/tabs.ts` | `createWorkspaceTab` 写入整个 project；新增 `groupTabsByProject` |
| `workspace/tabs.test.ts` | 断言改 `project`；补分组用例 |
| `workspace/useProjectWorkspace.ts` | 删全局 project，加 `lastProject` / `activeProject`，重写 `selectProject` 与 `launch` |
| `App.tsx` | caption 行放合并控件；`SessionTerminal` 只收 tab |
| `workspace/components/ProjectSwitcher.tsx` | 改成 caption 行控件形态，显示名 + 路径 |
| `workspace/components/Sidebar.tsx` | 移除顶部切换器；会话列表按项目分组 |
| `workspace/sidebar.css` | 删 `.sidebar-top`；加分组标题样式 |
| `workspace/workspace.css` | caption 行改成容纳按钮 + 居中浮层 |

## 验证

- `pnpm build` + `pnpm test`（分组函数补单测）
- 浏览器里用 CDP 截图核对两套主题下的 caption 控件、浮层、分组列表
- 真实 Tauri 窗口验证：开两个不同项目的会话，确认各自 cwd 正确、换项目时只重启当前会话、原生目录选择器能正常返回路径
