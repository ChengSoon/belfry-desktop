# 开发3：前端加载、工作区模块与交付验证

## 目标

直接实现可选面板按需加载、工作区 Hook 职责拆分、CI 补齐和 README 修正。
基线 `pnpm build` 只有一个约 1,591.64 kB 的 JS 包；useProjectWorkspace.ts 为 503 行；
只有 tag/手动 release workflow，未显式执行 Rust/Node 插件回归。

## 所有权

- scope_write：`src/components/AppOverlays.tsx`、新增按需加载辅助组件及其测试、
  `src/workspace/**`、`.github/workflows/**`、`README.md`、`README.en.md`；
  本目录 `developer-3-result.md`、`developer-3-acceptance.md`。
- scope_read：全仓库，尤其 src/main.tsx、App.tsx、SettingsPanel、插件测试支持和现有验收记录。
- 不编辑 `src/App.tsx`、`src/main.tsx`、`src-tauri/src/lib.rs`、usage、terminal、依赖/锁文件、Vite/TS 配置。
  需要扩大范围时在结果文件写清，由项目经理整合。
- CI 仅你编辑，根入口仅项目经理编辑。三人同目录，不覆盖其他人的在途修改。

## 实现要求

1. 设置、历史、用量等可选面板使用动态导入，保留加载状态和失败后的明确恢复入口。
   常驻终端不能因面板加载/失败而被卸载；Escape、焦点返回、尺寸、持久化与开关行为不回退。
2. 用实际构建说明主包/异步 chunk 大小；目标是按需加载真实生效，不仅调整警告阈值。
   不新增依赖；必要的错误边界限定在可选面板。
3. 按启动恢复、持久化、会话动作等职责拆分 useProjectWorkspace.ts，保持公开 API 和存档格式。
   不把旧 Hook 整体搬到另一个超长文件；新/修改生产文件 <= 300 行，尽量函数 <= 50 行。
4. 增加 PR/分支检查，至少显式包含 pnpm test、pnpm build、Rust workspace tests、Node 插件回归。
   配置 macOS/Windows，使用现有 pnpm 与 Rust 版本约定；无效环境不得悄悄跳过关键浏览器测试。
   核对 sidecar/bundle 前置、插件上游/浏览器环境需求与 Windows 命令兼容性。
5. 发布需要在检查与各平台产物就绪后统一进行，避免第一平台通过后即暴露不完整更新。
   可调整 release workflow，但禁止推送/tag/触发发布；报告本地可验证与必须远端验证的边界。
6. 修正两种 README：移除不存在的 .codestable 引用及与实际插件/工作流相矛盾的描述，
   让开发和测试命令可用；保留明确产品范围，不写未经实现的宣传。
7. 整理 `developer-3-acceptance.md`，对照既有实施记录列出 Hook/统计、Worktree、Windows 剩余
   原生验收步骤和能由新 CI 覆盖的部分。既有 CM-13 已验收仅待勾选，不能说它尚未实现。
   不改写/勾选正式插件待办，不把 CI 配置完成当作 Windows 实测通过。

## 可验收证据

- 按需加载与失败边界定向验证，工作区恢复/启动一次/持久化/切换回归通过。
- pnpm test / pnpm build 实际结果与拆包大小。
- CI YAML 与命令前置检查；能本机执行的 Node 插件回归按实际运行，说明缺失浏览器/上游等条件。
- README 路径/命令复核，记录不能在 macOS 模拟证明的 Windows/原生行为。
- UI 验证只能使用任务专用浏览器/QA 实例，不关闭、重新加载或更改正式 Belfry/其他开发会话。

## 交付

更新 `developer-3-result.md`：文件、拆包数据、测试、CI 设计与限制，附待验收清单入口。
必须执行 `belfry done <收到的任务号> <摘要>` 回报；真实阻塞记录具体情况并 `belfry fail`。
不提交、不推送、无需安装新依赖；不要修改或删除其他开发的文件。
