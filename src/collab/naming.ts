import type { WorkspaceTab } from "../workspace/contracts";

/**
 * 会话名字的形状：字母开头（中文、日文这些也算字母），其后字母、数字、下划线、连字符，最长 32。
 *
 * 用白名单而不是黑名单，是因为这个名字要被 Agent 原样敲进命令行（`belfry send 审查 …`）。
 * 汉字本身不是 shell 元字符，裸写没问题；真正会出事的是空格、引号、`$`、`|` 这类——
 * 它们会让 shell 先做一次解释，而转义错了的表现是「派活莫名失败」，很难查。
 *
 * 首字符必须是字母：`-lead` 会被命令行当成选项，纯数字开头又容易和任务短 id 混起来。
 */
export const AGENT_NAME_PATTERN = /^\p{L}[\p{L}\p{N}_-]{0,31}$/u;

/** 输入框里的原文规整成候选名字。空串表示「清掉名字」，是合法操作。 */
export function normalizeAgentName(raw: string): string | null {
  // 顺手小写：UI 里打字带大写太常见，为此拒绝一次输入不值得，
  // 而寻址那侧本来就是大小写不敏感的。中文不受影响。
  const value = raw.trim().toLowerCase();
  return value === "" ? null : value;
}

/**
 * 校验一个候选名字，返回给用户看的理由；`null` 表示可用。
 *
 * 唯一性只在**活着的**会话之间要求：会话关掉后名字应当能被下一条会话接手，
 * 否则用户开开关关几轮就没有短名字可用了。
 */
export function agentNameError(
  name: string,
  tabs: readonly WorkspaceTab[],
  selfTabId: string,
): string | null {
  if (!AGENT_NAME_PATTERN.test(name)) {
    return "名字要以字母开头（中文也算），之后可用字母、数字、下划线、连字符，不能带空格，最长 32 个字";
  }
  const taken = tabs.find(
    (tab) => tab.id !== selfTabId && tab.agentName === name && isLiveSession(tab),
  );
  return taken ? `「${name}」已经是另一条会话的名字了` : null;
}

/**
 * 名字还被占着吗。
 *
 * 只看进程是否还活着，不看忙闲：一条正在干活的会话当然占着自己的名字，
 * 而已经退出的会话不该继续占用。
 */
function isLiveSession(tab: WorkspaceTab) {
  return tab.phase !== "exited" && tab.phase !== "error";
}

export type AgentRenameOutcome = { name: string | null } | { error: string };

/**
 * 把输入框里的原文变成一次改名结果：可用的名字，或者一句给用户看的理由。
 *
 * 规整、校验、判重合并成一步，是为了让 UI 侧只剩「拿到 error 就显示，否则落库」，
 * 不必自己记住三者的顺序（先 trim 再判空，空是清除而不是格式错）。
 */
export function resolveAgentRename(
  raw: string,
  tabs: readonly WorkspaceTab[],
  selfTabId: string,
): AgentRenameOutcome {
  const name = normalizeAgentName(raw);
  // 清空是合法操作：这条会话退出协作，别人就寻址不到它了。
  if (name === null) return { name: null };
  const error = agentNameError(name, tabs, selfTabId);
  return error ? { error } : { name };
}
