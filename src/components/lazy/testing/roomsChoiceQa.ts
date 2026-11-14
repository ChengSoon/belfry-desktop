import type { TerminalChoice } from "../../../terminal/choice";
import type { TerminalCommandTarget } from "../../../terminal/contracts";
import type { TerminalInteraction, TerminalInteractionAnswer, TerminalInteractionResult } from "../../../terminal/interaction";
import type { HookSnapshot } from "../../../agent/hooks/contracts";
import { statusReport } from "../../../terminal/fixtures/programStatus";

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

export function createChoiceQaState(scenario: string) {
  const requests = new Map<string, TerminalInteraction | null>([["t2", structuredClone(worktreeInteraction)]]);
  const reports = new Map<string, HookSnapshot>([["t2", statusReport("codex", "blocked", 1, "question")]]);
  const listeners = new Set<(report: HookSnapshot, tabId: string) => void>();
  const reportRequest = (tabId: string) => {
    const request = requests.get(tabId);
    const report = statusReport("codex", request ? "blocked" : "idle", (reports.get(tabId)?.sequence ?? 0) + 1,
      request ? request.kind === "confirmation" ? "permission" : "question" : null);
    reports.set(tabId, report);
    for (const listener of listeners) listener(report, tabId);
  };
  const calls: Array<{ tabId: string; requestId: string; sessionId: string; answer: TerminalInteractionAnswer }> = [];
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
        answerInteraction: async (requestId: string, answer: TerminalInteractionAnswer): Promise<TerminalInteractionResult> => {
          const request = requests.get(tabId);
          calls.push({ tabId, requestId, sessionId: request?.source.sessionId ?? "", answer: structuredClone(answer) });
          if (!request || request.requestId !== requestId) return { status: "changed" };
          if (request.state !== "pending") return { status: "busy" };
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
    qaReadInteraction: (tabId: string) => structuredClone(requests.get(tabId)),
    qaSetInteraction: (tabId: string, request: TerminalInteraction | null) => {
      requests.set(tabId, structuredClone(request)); reportRequest(tabId);
    },
    qaPatchInteraction: (tabId: string, patch: Partial<TerminalInteraction>) => {
      const request = requests.get(tabId); if (request) requests.set(tabId, { ...request, ...structuredClone(patch) });
      reportRequest(tabId);
    },
    qaHoldChoice: (tabId: string) => held.add(tabId),
    qaResolveChoice: (tabId: string, result: TerminalInteractionResult) => { pending.get(tabId)?.(result); pending.delete(tabId); },
    qaChoiceResult: (tabId: string, result: TerminalInteractionResult) => results.set(tabId, result),
    qaDropChoiceTarget: (tabId: string) => targets.delete(tabId),
    qaChoiceSession: (tabId: string, sessionId: string | null) => sessionIds.set(tabId, sessionId),
  });
  return { targets, snapshot: () => reports.get("t2")!,
    subscribeReport(listener: (report: HookSnapshot, tabId: string) => void) {
      listeners.add(listener);
      for (const [tabId, report] of reports) listener(report, tabId);
      return () => { listeners.delete(listener); };
    },
  };
}
