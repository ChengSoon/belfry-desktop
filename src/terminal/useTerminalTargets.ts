import { useCallback, useState } from "react";
import type { TerminalCommandTarget } from "./contracts";

/** 记录每个常驻 xterm 的命令入口，供 Composer 按会话 id 精确投递。 */
export function useTerminalTargets() {
  const [targets, setTargets] = useState<Map<string, TerminalCommandTarget>>(() => new Map());
  const register = useCallback((id: string, target: TerminalCommandTarget | null) => {
    setTargets((current) => {
      if (target && current.get(id) === target) return current;
      if (!target && !current.has(id)) return current;
      const next = new Map(current);
      if (target) next.set(id, target);
      else next.delete(id);
      return next;
    });
  }, []);
  return { register, targets };
}
