# 好玩功能技术评估：先做「敲钟收工」

2026-10-29 · 首轮静态评估 · 任务 `4nr2yxb3`。建议优先 A，B 留作需要新任务编排的备选。两者均适合 README.md 定义的本地 CLI Agent 工作台，无需账号、云服务或额外模型调用。

**基线与边界。** 开始检查时已有 39 个跟踪文件修改，另有未跟踪的 `src/rooms/`、`src-tauri/src/rooms/` 等；以下房间能力指当前工作树源码，不能当作已发布能力。实测本机 `belfry --help` 只有 peers/send/inbox/done/fail/wait，`belfry rooms` 返回“不认识的命令”；源码协议已有 Rooms/RoomSay/RoomLog（`src-tauri/crates/belfry-protocol/src/lib.rs:65`），上线需同步桌面端与 CLI sidecar。本轮仅新增本文件。

| 方向 | 用户得到的趣味与首版范围 | 复用 / 新增 |
| --- | --- | --- |
| **A · 敲钟收工：房间通关护照（推荐，成本低）** | 每条人工验证通过的任务变成一枚可展开的“收工章”，露出角色、交差回执、验收备注；房间内短暂敲钟动画，点击章回到任务详情。首版只做任务收藏页与一次动画，不设速度榜、积分或连续签到。 | 读 `roomGet` / `RoomTask.stage`、`verifiedAt`、`deliveries`；详情沿用 `RoomView.tsx` 的 TaskDialog 与 `model.ts` 的 `taskRecord`。章按 `(roomId, taskId)` 派生，不新增业务状态或 CLI 协议；仅新增前端显示开关及当前视图的跃迁去重集合，首次加载建立基线、不重播历史。 |
| **B · Bug Boss：三棒接力（中等成本）** | 用户选一个真实问题，依次完成“复现 → 修复 → 验收”，每棒亮一盏灯。每棒均由用户查看证据、验证并点击开启下一棒；首版固定三棒，不做自动接力或后台自主循环。 | 复用 `src/rooms/templates.ts` 的角色模板、`roomDispatch` / `roomVerifyTask` / `roomRejectTask`。需在 Rust 持久化 `ChallengeRun { id, roomId, steps: [{ kind, memberId, taskId }] }`；新增创建及幂等推进的 Tauri 命令，事务内绑定任务再投递；重试与退回的新任务需更新当前步骤引用。同步 `contracts.ts`，旧存档默认空；CLI 的 send/done/fail 无须改。 |

**真实接口与完成语义。** `src/rooms/api.ts` 已封装派发、验证、退回、重派及停止；注册在 `src-tauri/src/lib.rs:112`。`src-tauri/src/rooms/commands.rs:215` 的派发先存房间再写 TaskBoard；`src/collab/useTaskDelivery.ts:11` 表明 dispatched 连“实际注入终端”都不能保证，可能只是 Prompt 队列接管。`idle` 只作在场/投递条件，不能点亮通关灯；`done` 经 `src-tauri/src/collab/task.rs:268` 校验接收者，表示对方声明交差；房间仍需用户调用 `verify_task` 才成为 Verified（`src-tauri/src/rooms/store.rs:917`）。`acceptance` 只是文本清单，当前没有测试执行或逐项证据校验协议。

**会影响设计的风险。**

- `refresh_stage`（`src-tauri/src/rooms/store.rs:248`）在至少一人 Done、无人仍在途且无人 Failed 时即可 Submitted，即使另有人 Unknown/Abandoned；不能把“待验证”画成“全员完成”。A 仅记“用户验收通过”的任务章，角色分别保留真实投递状态；B 首版每棒绑定一人，避免聚合误读。
- TaskBoard 只存内存，重启丢失的在途投递对账为 Unknown；房间 JSON 原子落盘保留已确认历史（`src-tauri/src/rooms/store.rs:1110`）。重启、失败、停止都不得补章或自动开下一棒；停止派活也不能包装成已终止 Agent 正在执行的进程。
- `TaskArtifact` 是交差后对账时采集的房间主根目录差异，最多 32 KB，可能混入先前/他人的未提交改动；不含未跟踪文件，也不覆盖其他成员项目根（`src-tauri/src/rooms/commands.rs:549`、`src-tauri/src/git/diff.rs:81`）。空快照不等于没有产物，更不等于测试通过；首版使用“工作区参考快照”文案，不据此授予个人贡献或代码量奖励。
- 指定成员派发会因忙碌而被拒，广播才有不同的排队路径（`src-tauri/src/rooms/commands.rs:27`、`:289`）。B 下一棒失败时留在原步骤并显示原因，不乐观前进、不自动广播替代。其多窗口重复点击、保存失败及存档兼容成本明显高于 A。

**可验证的首版验收条件。**

1. 会话 talking → idle、以及 dispatched 均不产生章；Done 只显示待验证。Done + Unknown 时仍能看到缺失成员，不能显示全员完成。
2. 人工验证成功才产生一枚任务章；验证失败、反复轮询、双窗口及重启均不增加章数。首次加载不庆祝旧任务，动画仅在操作视图播放，可关闭并遵循减少动态效果设置。
3. Failed/Stopped/Interrupted 不授章；应用重启保留历史章，在途结果如实变未知。退回重做仍显示旧任务的退回状态，不假装原任务通过。
4. 非 Git、空差异、只有未跟踪文件及截断快照均可查看回执与验收备注，明确证据局限；文案不声称自动测试通过或准确归属贡献。
5. 若选 B：上棒未 Verified 时禁止开下一棒；重复点击只创建一条任务；忙碌、离线、落盘失败不推进；退回/重派后绑定正确任务，重启不会自动执行。

验证落点：现有 `src-tauri/src/rooms/store_test.rs` 覆盖提交/验证分离、重启、重派、退回、快照；补足上述混合投递与玩法去重用例，界面扩展 `src/rooms/model.test.ts` 和 `src/components/lazy/testing/rooms-ui.case.mjs`。本轮仅核对源码及本机 CLI，没有运行构建、测试或宣称功能已验收。
