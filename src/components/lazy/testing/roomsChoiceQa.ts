import type { TerminalChoice } from "../../../terminal/choice";
import type { TerminalCommandTarget } from "../../../terminal/contracts";
import type { TerminalInteraction, TerminalInteractionAnswer, TerminalInteractionOpenResult, TerminalInteractionResult } from "../../../terminal/interaction";

// Representative strings from the user's Codex new-conversation menu. Replies
// here exercise the room UI contract; T35 tests the actual xterm/PTY execution.
export const worktreeInteraction: TerminalInteraction = {
  requestId: "worktree-1", source: { sessionId: "session-t2", agent: "codex" }, kind: "single",
  question: "Where should the new conversation run?", detail: "",
  options: [
    { index: 1, label: "Use current Git worktree", description: "Keep using the current working directory" },
    { index: 2, label: "Create new Git worktree", description: "Create a separate checkout of this repository in another directory" },
  ], selected: 1, selectedIndices: [], input: null, state: "pending",
};

const queuedInteraction: TerminalInteraction = {
  requestId: "queue-1", source: { sessionId: "session-t2", agent: "codex" }, kind: "queued",
  question: "", detail: "", options: [], selected: null, selectedIndices: [], input: null,
  state: "pending", queue: { count: 1 },
};
const openedQuestion: TerminalInteraction = {
  ...worktreeInteraction, requestId: "question-1", question: "Which sample color should the isolated preview use?",
  options: [{ index: 1, label: "Blue sample" }, { index: 2, label: "Green sample" }, { index: 3, label: "Other", action: "input" }],
};

export function createChoiceQaState(scenario: string) {
  const requests = new Map<string, TerminalInteraction | null>([["t2", structuredClone(scenario === "queued" ? queuedInteraction : worktreeInteraction)]]);
  const calls: Array<{ tabId: string; requestId: string; sessionId: string; answer: TerminalInteractionAnswer }> = [];
  const opens: Array<{ tabId: string; requestId: string; sessionId: string; optionIndex?: number }> = [];
  const heldOpens = new Set<string>();
  const pendingOpens = new Map<string, (result: TerminalInteractionOpenResult) => void>();
  const openResults = new Map<string, TerminalInteractionOpenResult>();
  const openedRequests = new Map<string, TerminalInteraction>();
  const held = new Set<string>();
  const pending = new Map<string, (result: TerminalInteractionResult) => void>();
  const results = new Map<string, TerminalInteractionResult>();
  const targets = new Map<string, TerminalCommandTarget>();
  const sessionIds = new Map<string, string | null>();
  const legacyChoice = (): TerminalChoice | null => {
    const request = requests.get("t2");
    if (!request) return null;
    return { question: request.question, detail: request.detail, options: request.options.map(option => ({
      index: option.index, label: [option.label, option.description].filter(Boolean).join(" "),
    })), selected: request.selected ?? 1, signature: request.requestId };
  };
  for (const tabId of ["t1", "t2", "t3", "t4"]) {
    targets.set(tabId, { focus: () => {}, sendText: () => true,
      getSessionId: () => sessionIds.has(tabId) ? sessionIds.get(tabId)! : requests.get(tabId)?.source.sessionId ?? `session-${tabId}`,
      readChoice: () => tabId === "t2" ? legacyChoice() : null,
      answerChoice: (requestId, index) => {
        calls.push({ tabId, requestId, sessionId: requests.get(tabId)?.source.sessionId ?? "", answer: { kind: "single", index } });
        return "sent";
      },
      ...(scenario === "legacy" ? {} : {
        readInteraction: () => structuredClone(requests.get(tabId) ?? null),
        openInteraction: async (requestId: string, optionIndex?: number): Promise<TerminalInteractionOpenResult> => {
          const request = requests.get(tabId);
          opens.push({ tabId, requestId, sessionId: request?.source.sessionId ?? "", ...(optionIndex === undefined ? {} : { optionIndex }) });
          const input = optionIndex !== undefined && request?.options.some(option => option.index === optionIndex && option.action === "input");
          if (!request || request.requestId !== requestId || (!input && request.kind !== "queued")) return { status: "changed" };
          if (request.state !== "pending") return { status: "busy" };
          request.state = "opening";
          const next = structuredClone(input ? { ...request, requestId: `${requestId}-input`, kind: "input" as const, state: "pending" as const,
            options: [], selected: null, input: { label: "Example text" } }
            : openedRequests.get(tabId) ?? { ...openedQuestion, source: request.source });
          const result = heldOpens.delete(tabId)
            ? await new Promise<TerminalInteractionOpenResult>(resolve => pendingOpens.set(tabId, resolve))
            : openResults.get(tabId) ?? { status: "opened" as const, requestId: next.requestId };
          openResults.delete(tabId);
          if (requests.get(tabId) === request) {
            if (result.status === "opened") requests.set(tabId, next);
            else request.state = result.status === "uncertain" ? "uncertain" : "pending";
          }
          return result;
        },
        answerInteraction: async (requestId: string, answer: TerminalInteractionAnswer): Promise<TerminalInteractionResult> => {
          const request = requests.get(tabId);
          calls.push({ tabId, requestId, sessionId: request?.source.sessionId ?? "", answer: structuredClone(answer) });
          if (!request || request.requestId !== requestId) return { status: "changed" };
          if (request.state !== "pending") return { status: "busy" };
          if (answer.kind === "single" && request.options.some(option => option.index === answer.index && option.action === "input")) return { status: "invalid" };
          request.state = "submitting";
          const result = held.delete(tabId) ? await new Promise<TerminalInteractionResult>(resolve => pending.set(tabId, resolve))
            : results.get(tabId) ?? { status: "sent" as const };
          results.delete(tabId);
          if (requests.get(tabId) === request) request.state = result.status === "sent" ? "submitted"
            : result.status === "uncertain" ? "uncertain" : "pending";
          return result;
        },
      }),
    });
  }
  Object.assign(window, {
    qaChoiceCalls: calls,
    qaOpenCalls: opens,
    qaHoldOpen: (tabId: string) => heldOpens.add(tabId),
    qaResolveOpen: (tabId: string, result: TerminalInteractionOpenResult) => { pendingOpens.get(tabId)?.(result); pendingOpens.delete(tabId); },
    qaOpenResult: (tabId: string, result: TerminalInteractionOpenResult) => openResults.set(tabId, result),
    qaSetOpenedInteraction: (tabId: string, request: TerminalInteraction) => openedRequests.set(tabId, structuredClone(request)),
    qaDropOpenHandler: (tabId: string) => { const target = targets.get(tabId); if (target) delete target.openInteraction; },
    qaReadInteraction: (tabId: string) => structuredClone(requests.get(tabId)),
    qaSetInteraction: (tabId: string, request: TerminalInteraction | null) => requests.set(tabId, structuredClone(request)),
    qaPatchInteraction: (tabId: string, patch: Partial<TerminalInteraction>) => {
      const request = requests.get(tabId); if (request) requests.set(tabId, { ...request, ...structuredClone(patch) });
    },
    qaHoldChoice: (tabId: string) => held.add(tabId),
    qaResolveChoice: (tabId: string, result: TerminalInteractionResult) => { pending.get(tabId)?.(result); pending.delete(tabId); },
    qaChoiceResult: (tabId: string, result: TerminalInteractionResult) => results.set(tabId, result),
    qaDropChoiceTarget: (tabId: string) => targets.delete(tabId),
    qaChoiceSession: (tabId: string, sessionId: string | null) => sessionIds.set(tabId, sessionId),
  });
  return { targets };
}
