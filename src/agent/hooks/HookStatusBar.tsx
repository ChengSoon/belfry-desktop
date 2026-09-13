import type { SessionActivity, TerminalPhase } from "../../terminal/contracts";
import type { HookSnapshot } from "./contracts";
import "./hooks.css";

interface Props { snapshot: HookSnapshot | null; activity: SessionActivity; phase: TerminalPhase }
export function HookStatusBar({ snapshot, activity, phase }: Props) {
  const source = snapshot?.source ?? "screen_heuristic";
  const sourceName = { hook: "Hook", screen_heuristic: "屏幕推断", process: "进程状态" }[source];
  const reason = source === "screen_heuristic"
    ? { idle: "就绪", talking: "正在处理", "awaiting-choice": "等待选择" }[activity]
    : snapshot?.reason;
  const status = phase === "creating" ? "正在启动" : phase === "error" ? "启动失败" : phase === "exited" ? "已退出" : reason;
  const details = [snapshot?.reason ?? "可在设置 → 会话状态中启用 Hook", snapshot?.session ? `原生会话：${snapshot.session.id}` : null]
    .filter(Boolean).join(" · ");
  return <div className="hook-status-bar" data-source={source} role="status" title={details}>
    <span className="hook-status-bar__source">{sourceName}</span><span>{status}</span>
  </div>;
}
