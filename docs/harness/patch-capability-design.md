# Harness H1.2：补丁预览与受控写入

日期：2026-09-07。状态：执行基线。

## 目标

新增 `project.patch.propose` 与 `project.patch.apply`。Worker 只能提出基于旧内容摘要的文本补丁；宿主生成
结构化预览，用户批准由宿主签发一次性 approval token 后才能 apply。不得提供任意写路径或 shell。

## 安全与一致性

- session 必须声明 project.write 且当前授权；propose 不写盘，apply 前重新检查授权、取消和 session/worker。
- 只支持项目根内既有 UTF-8 普通文件，首期不创建、删除、移动、改二进制或超过512KiB文件。
- 请求含 relativePath、expected content digest、replacement text；宿主计算 diff/行数/最终字节数，拒绝无变化。
- preview 固定 session、worker、path、digest、replacement digest、generation，最多保留100个，10分钟失效。
- approval token 随机不可猜、一次性、仅绑定一个 preview；拒绝/撤权/取消/文件变化后不可使用。
- apply 在同一项目路径锁内重新 canonicalize、验证 digest 和 symlink边界，再写同目录临时文件并原子替换。
- 同项目并发写按规范路径串行；旧 digest 返回 WRITE_CONFLICT，不能静默覆盖。
- 事件必须覆盖 patch.proposed、approval.required、tool.started、tool.completed/failed；正文不得进入审计摘要。
- 写失败不得报成功；临时文件尽力清理。Windows rename 差异须测试或明确未验证。

## 边界与验收

允许修改 `src-tauri/src/harness/**`、共享 `project/resource_path`、`src/harness/**`、假 Worker、实施文档和
最小 Tauri 命令注册。不得接 UI、模型、命令执行、持久授权、legacy plugins、依赖/CI/Git远程。
所有文件≤300行、函数≤50行。

验收覆盖：无授权/无声明；预览零写入；一次性批准；拒绝与过期；撤权/取消；文件内容竞态；symlink替换竞态；
同路径并发；超限/二进制/无变化；成功原子替换与临时文件清理；审计不含正文；假 Worker完整 propose→approve→apply。
运行 Harness 定向、project 回归、pnpm test/build、cargo test，更新 implementation，明确 H1仍未完成。
