# T30：文本预览误判为二进制

根因在 `src-tauri/src/project/files.rs`：原先在识别编码前遇到零字节就拦截，且只按 UTF-8 解码。UTF-16 文本含正常的零字节；GBK 等编码无法按 UTF-8 解码后也被标为 binary。前端只是显示该结果。

修复在 `src-tauri/src/project/preview_text.rs`：

- 先识别 UTF-8 / UTF-16 / UTF-32 BOM，移除 BOM；对有明确字节分布特征的无 BOM UTF-16 文本进行识别。
- 普通 UTF-8 保持直接读取；其他非二进制内容使用 chardetng 与 encoding_rs 检测并解码，包括 GBK、Shift-JIS、Windows-1252 等编码。解码失败不再直接等同于二进制。
- 解码后检查 NUL 和异常控制字符比例；原始非 Unicode 内容仍先经过二进制检查。PNG、ZIP、ELF 等测试样本保持拦截。日志里的 ANSI 转义和分页符可以作为文本显示。
- 保持 512 KiB 读取上限。截断时不把半个 UTF-8 字符、UTF-16 代理对或传统编码字符误判为二进制；不把尾部未读完的字符替换成乱码。
- 空文件或只有 BOM 的文件保持空文本。路径限制、只读行为、文件大小、修改时间与预览响应结构不变。

新增依赖锁定 chardetng 0.1.17 / encoding_rs 0.8.35。无 BOM 的传统编码存在固有歧义，检测采用尽力识别，未添加未经设计的编码选择界面。用户尚未提供具体误判文件，本次修复和验证针对已复现的上述条件。

## 验证

- Rust 项目模块 **15/15**：包含新增 8 项解码/文件读取测试；固定编码字节、中文、emoji、大小端、BOM、截断与真二进制负例。
- 实际写入临时文件后调用生产 `read_file`，验证 UTF-16 / GBK 内容、BOM 空文本、512 KiB 边界、原始字节大小和 truncated 标志。
- 新增用例并行暴露旧测试夹具仅使用时钟命名可能碰撞，已加原子序号确保临时目录唯一。
- `cargo check`、`cargo build`、`pnpm build` 通过。
- 既有生产浏览器回归 **3/3**：英文最小窗口预览、文件树/内容/Git 切换、亮暗与窄窗面板；终端保持挂载，无浏览器异常或未处理 IPC。
- Rust 测试验证真实文件与解码；浏览器用例使用已有合成 IPC，验证预览界面及响应结构，不替代原生文件解码测试。
- `git diff --check` 通过。完整日志在 `logs/`。

复现：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib project:: -- --skip provider:: --skip terminal::
cargo check --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
pnpm build
node --test --test-concurrency=1 --test-name-pattern='English usage and file preview|collaboration waiting result|satellite panels remain reachable' src/components/lazy/testing/analytics-i18n.case.mjs src/components/lazy/testing/production-ui.case.mjs
```

此修改在 Rust 后端，运行中的已安装旧版应用需要使用重新构建的桌面端才能生效。
