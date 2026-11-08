# T14：房间快照、历史分页与容量

`rooms.json` v3 在原有提交点同时保存最近 1000 条消息、`retainedMessages`、任务与成员投影、
outbox 和 `ledgerLengths`。每次房间事务都是一个完整 checkpoint；账本先 append + sync，
原子替换快照后才发布成功，因此不会增加第二个提交点。

启动解析快照并检查账本文件长度，不读取或解析已提交历史。v1/v2 首次升级流式重放一次，
随后写入 v3 快照。完整原文仍保留在账本，未知事件、版本和损坏行不会被压缩删除。
快照解析失败、账本截断、游标与投影不一致时保留文件并按只读报错。

## 返回给前端的字段与接口

`room_get` 的 Room 与 `room_list` 的 RoomSummary 均增加 `ledgerBytes: number`，表示已提交账本字节数。
失败追加的未提交尾部不计入该值。前端类型和展示由房间界面任务接入；普通时间线继续使用 messages，
待回复继续合并 retainedMessages。

```ts
room_history({ id: string, cursor?: string | null, limit?: number })
  -> Promise<{
    entries: {
      offset: string;
      bytes: number;
      event: { v, id, ts, kind, room_id, by, data } | null;
      raw: string | null;
      truncated: boolean;
    }[];
    nextCursor: string | null;
    ledgerBytes: number;
    snapshotBytes: number;
  }>
```

TypeScript 封装在 `src/rooms/history-api.ts`。
首次省略 cursor，获得最新一页；之后原样传回 nextCursor，读取更早的页。每页内部按原账本顺序排列。
游标固定首次查询时的已提交末尾；分页期间新增消息不会造成重复、遗漏或混入已有快照。
limit 默认 50，范围 1–200；游标是 opaque string，前端不要自行计算字节偏移。
event.ts 是 Unix 毫秒，事件信封保持原有 snake_case 字段，未知 kind 和 v 同样返回。

这是只读历史事件流，包含 `chat.message/system.notify/runtime.delivery/chat.reply_request.cancelled`；
当前待回复与投递状态仍以 Room 的投影为准，不根据单页原始 request_reply 事件推断未完成事项。
非法信封返回 raw；超大行返回最后 64 KiB 预览并置 truncated，原文件保持完整。
每页内容最多约 512 KiB，向后读取使用 8 KiB 块，不随账本总量分配内存。

房间信息中的容量说明可写：历史原文会持续保留到删除房间；需要长期保存时先备份应用数据目录。
当前没有“归档旧历史”的写入接口，不能把删除账本当作归档：它会破坏提交游标并使房间只读。
如要提供归档动作，应单独实现带可恢复索引的归档事务。

## 启动测量

2026-11-08，macOS arm64，Rust 默认 unoptimized test profile。
计时只覆盖 `RoomStore::load`，不含应用窗口/终端启动；峰值是独立测试进程的最大 RSS，
用 `/usr/bin/time -l` 取得。夹具准备与加载分进程，文件系统缓存已热；每个规模运行三次，下面为中位数。

每条消息正文约 1 KiB，每 1000 条含一个待回复事项；窗口外分别保留 9 / 99 条待回复。
优化前保存的是 T4 完成、T14 修改之前的测试二进制。完整样本在 `docs/room-startup-benchmark.json`。

| 事件数 | 优化前加载 | 优化后加载 | 优化前峰值 RSS | 优化后峰值 RSS | 启动读取历史字节数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 279.277 ms | 9.204 ms | 49.75 MiB | 18.63 MiB | 12,097,950 → 0 |
| 100,000 | 3,394.642 ms | 9.292 ms | 333.02 MiB | 19.09 MiB | 121,179,480 → 0 |

首次从 v1/v2 升级仍要流式读完历史；上表比较迁移完成后的正常启动。
内存与加载时间仍随活跃投影大小增长：无限积累未回复/未送达事项本身不会被丢弃以换取上限。

基准夹具和加载入口：`rooms::history_test::startup_benchmark_prepare` / `startup_benchmark_load`
（ignored tests，需显式指定 `BELFRY_BENCH_ROOT` 与 prepare 用的 `BELFRY_BENCH_EVENTS`，且 root 必须是新临时目录）。
prepare 生成 v2 历史；当前代码第一次 load 进行迁移，后续 load 测快照启动。

## 回归

`regression_startup_reads_only_the_committed_projection` 在原实现上稳定失败：正常重启读取了 1433 个账本字节，
期望为 0；修复后转绿。另覆盖早期历史分页、分页中追加、未知版本与损坏行、超大行预览、非法游标与条数，
以及快照提交失败后不暴露尾部。T5 的 append/sync/rename 故障、早期待回复和未知事件保留回归继续通过。
