import { useCallback, useEffect, useRef, useState } from "react";
import { isAgentKind } from "../agent/contracts";
import { canDispatchPrompt } from "../prompt/contracts";
import type { PromptDeliveryResult, TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import {
  abortPrepared, activateInbox, beginSubmit, bindTarget, inboxCapabilities, inboxPending, offerInput,
  prepareBatch, revokeOffer, sendReceipt,
} from "./api";
import { batchRequest, INBOX_CAPABILITY, type Capabilities } from "./contracts";
import { InboxRuntime, type GuardedResult, type InputSlot } from "./runtime";

const TICK_MS = 750;

/**
 * "probing"：还没决定；"legacy"：后端没有收件箱命令，沿用旧路径；"inbox"：新协议是唯一 owner；
 * "halted"：后端支持但启用失败。此时两条路径都不自动投递，避免部分切换后出现两个 owner。
 */
export type DeliveryMode = "probing" | "legacy" | "inbox" | "halted";

/**
 * 决定投递 owner 并驱动新运行时。顺序：
 * 1. 查 capabilities。命令不存在/不支持 → legacy（旧 DeliveryCoordinator 照旧）。
 * 2. 支持但未启用 → 旧循环此时从未启动过，没有旧项可能写入，直接 activate。
 * 3. 启用后只跑 InboxRuntime；旧循环保持关闭，避免双重投递。
 * 4. activate 失败 → halted：不回退旧路径，下次启动再试。
 * 决定之前两条路径都不跑。
 */
export function useInboxDelivery(options: {
  tabs: readonly WorkspaceTab[];
  targets: ReadonlyMap<string, TerminalCommandTarget>;
  promptQueueEmpty: (tabId: string) => boolean;
  probe?: () => Promise<Capabilities>;
  activate?: (operationId: string) => Promise<Capabilities>;
}) {
  const [mode, setMode] = useState<DeliveryMode>("probing");
  const tabsRef = useRef(options.tabs); tabsRef.current = options.tabs;
  const targetsRef = useRef(options.targets); targetsRef.current = options.targets;
  const emptyRef = useRef(options.promptQueueEmpty); emptyRef.current = options.promptQueueEmpty;
  const runtimeRef = useRef<InboxRuntime | null>(null);
  const probe = options.probe ?? inboxCapabilities;
  const activate = options.activate ?? activateInbox;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let caps: Capabilities;
      try { caps = await probe(); }
      catch {
        // 只有“命令不存在”（旧后端）才走旧路径。
        if (!cancelled) setMode("legacy");
        return;
      }
      if (!caps.capabilities.includes(INBOX_CAPABILITY)) { if (!cancelled) setMode("legacy"); return; }
      if (caps.enabled) { if (!cancelled) setMode("inbox"); return; }
      try {
        const next = await activate(crypto.randomUUID());
        if (!cancelled) setMode(next.enabled ? "inbox" : "halted");
      } catch {
        if (!cancelled) setMode("halted");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const slot = useCallback((tabId: string): InputSlot | null => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    const target = targetsRef.current.get(tabId);
    const sessionId = target?.getSessionId?.() ?? null;
    if (!tab || !isAgentKind(tab.kind) || !target || !sessionId) return null;
    const interaction = target.readInteraction?.() ?? null;
    return {
      tabId, terminalSessionId: sessionId,
      running: tab.phase === "running",
      idle: canDispatchPrompt(tab),
      composerEmpty: target.composerEmpty?.() ?? false,
      awaitingInput: tab.activity === "awaiting-choice" || interaction !== null,
      promptQueueEmpty: emptyRef.current(tabId),
      inputRevision: target.inputRevision?.() ?? -1,
    };
  }, []);

  const write = useCallback((tabId: string, payload: string, guard: Parameters<NonNullable<TerminalCommandTarget["sendText"]>>[1] extends infer O
    ? O extends { inboxGuard?: infer G } ? NonNullable<G> : never : never, expectedInputRevision: number) =>
    new Promise<GuardedResult>((resolve) => {
      const target = targetsRef.current.get(tabId);
      if (!target) { resolve("not-written"); return; }
      const accepted = target.sendText(payload, {
        background: true, inboxGuard: guard, expectedInputRevision,
        onResult: (result: PromptDeliveryResult) => resolve(result === "submitted" ? "submitted" : result === "not-written" ? "not-written" : "uncertain"),
      });
      if (!accepted) resolve("not-written");
    }), []);

  useEffect(() => {
    if (mode !== "inbox") return;
    const runtime = new InboxRuntime({
      newId: () => crypto.randomUUID(),
      pending: inboxPending,
      bind: bindTarget,
      offer: offerInput,
      revoke: revokeOffer,
      prepare: prepareBatch,
      begin: (batch, offer) => beginSubmit({ batch: batchRequest(batch), offer }),
      receipt: sendReceipt,
      abort: (batch) => abortPrepared(batchRequest(batch)),
      slot,
      write,
    });
    runtimeRef.current = runtime;
    let running = false;
    const timer = window.setInterval(() => {
      if (running) return;
      running = true;
      void runtime.tick().catch(() => undefined).finally(() => { running = false; });
    }, TICK_MS);
    return () => { runtime.stop(); runtimeRef.current = null; window.clearInterval(timer); };
  }, [mode, slot, write]);

  return { mode };
}
