import { TranslationError } from "../i18n";
/** 旧入口只保留明确失败语义；生产界面不再调用或加载 Harness。 */
export async function launchAlias(_input?: unknown): Promise<never> {
  throw new TranslationError("plugins.launchAlias.text_7d17fd40b0");
}
