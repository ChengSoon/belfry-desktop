/** 入口换 URL 后仍失败时，共享 ESM 依赖可能已被当前文档缓存，不能继续承诺原位恢复。 */
export class PanelRecoveryRequired extends Error {
  constructor(cause: unknown) {
    super("面板资源在局部重试后仍未恢复", { cause });
    this.name = "PanelRecoveryRequired";
  }
}
