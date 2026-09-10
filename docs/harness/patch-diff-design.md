# H1.7 宿主有界 Diff 预览

`project.patch.propose` 的 diff 仅由 Rust 宿主根据已读取的旧内容和 replacement 计算。Worker 只能提供 replacement 与 expected digest，不能提交 hunks 或渲染 HTML。

- 单文件 replacement 上限 512 KiB；预览最多 32 个 hunk、每个 hunk 200 行、总预览文本 64 KiB。
- 返回旧/新行号、`context/add/delete`、hunk 起点、总旧/新行数、最终字节数和 `truncated/omittedHunks/omittedLines/previewBytes`。
- 超限只截断预览，完整 replacement 仍保存在宿主 pending store，并由 replacement digest、session/worker、preview/token 绑定；apply 仍执行完整内容校验。
- CRLF 按逻辑行比较，空文件和末尾换行保持稳定计数；超长行、控制字符和 bidi 标记在宿主预览中转义/截断。
- 审计只记录摘要和 digest 元数据，不记录旧文、replacement 或 diff 正文。UI 使用 React 文本节点渲染，不使用 `innerHTML`。
