/** 旧入口只保留明确失败语义；生产界面不再调用或加载 Harness。 */
export async function launchAlias(_input?: unknown): Promise<never> {
  throw new Error("Harness 功能已移除，请使用插件中心。");
}
