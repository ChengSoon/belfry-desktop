import { useCallback, useRef, useState } from "react";
import type { TerminalCommandTarget } from "./contracts";

/** 记录每个常驻 xterm 的命令入口，供 Composer 按会话 id 精确投递。 */
export function useTerminalTargets() {
  const [targets, setTargets] = useState<Map<string, TerminalCommandTarget>>(() => new Map());
  const targetsRef = useRef(targets);
  const waiters = useRef(new Map<string, Set<(target: TerminalCommandTarget | null) => void>>());
  const register = useCallback((id: string, target: TerminalCommandTarget | null) => {
    const current = targetsRef.current;
    if (target && current.get(id) === target) return;
    if (!target && !current.has(id)) return;
    const next = new Map(current);
    if (target) next.set(id, target);
    else next.delete(id);
    targetsRef.current = next;
    setTargets(next);
    if (target) {
      const pending = waiters.current.get(id);
      if (pending) {
        waiters.current.delete(id);
        for (const resolve of pending) resolve(target);
      }
    }
  }, []);
  const waitForTarget = useCallback((id: string, timeoutMs = 12_000) => {
    const current = targetsRef.current.get(id);
    if (current) return Promise.resolve(current);
    return new Promise<TerminalCommandTarget | null>((resolve) => {
      const pending = waiters.current.get(id) ?? new Set();
      const timer = window.setTimeout(() => {
        pending.delete(done);
        if (pending.size === 0) waiters.current.delete(id);
        resolve(null);
      }, timeoutMs);
      const done = (target: TerminalCommandTarget | null) => {
        window.clearTimeout(timer);
        resolve(target);
      };
      pending.add(done);
      waiters.current.set(id, pending);
    });
  }, []);
  return { register, targets, waitForTarget };
}
