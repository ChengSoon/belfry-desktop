import { ArrowRight, Check, Network, OctagonX, X } from "lucide-react";
import { ICON } from "../theme/sizing";
import { useDismiss } from "../workspace/useDismiss";
import type { TaskView } from "./api";
import "./collabPanel.css";

interface CollabPanelProps {
  active: readonly TaskView[];
  pendingApproval: readonly TaskView[];
  shortcutLabel: string;
  tasks: readonly TaskView[];
  onApprove: (id: string) => void;
  onClose: () => void;
  onReject: (id: string) => void;
  onStopAll: () => void;
}

export function CollabPanel({
  active,
  pendingApproval,
  shortcutLabel,
  tasks,
  onApprove,
  onClose,
  onReject,
  onStopAll,
}: CollabPanelProps) {
  // 有待确认时不许点外面关掉：那正是需要用户表态的东西，随手关掉等于默默搁置。
  const panelRef = useDismiss<HTMLDivElement>(pendingApproval.length === 0, onClose);
  const inFlight = active.length + pendingApproval.length;

  return (
    <div aria-label="Agent 协作" className="collab-panel" ref={panelRef} role="region">
      <header className="collab-panel__head">
        <span aria-hidden="true" className="collab-panel__mark">
          <Network size={ICON.md} />
        </span>
        <div className="collab-panel__title">
          <strong>Agent 协作</strong>
          <span>{summary(pendingApproval.length, active.length, tasks.length)}</span>
        </div>
        <button
          className="collab-button collab-button--danger"
          disabled={inFlight === 0}
          onClick={onStopAll}
          title="停掉所有还没结的任务"
          type="button"
        >
          <OctagonX aria-hidden="true" size={ICON.xs} />
          <span>全停</span>
        </button>
        <button
          aria-label="关闭协作面板"
          className="icon-button icon-button--sm"
          onClick={onClose}
          title="关闭"
          type="button"
        >
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>

      {pendingApproval.length > 0 ? (
        <section className="collab-approvals">
          <h3>等你确认</h3>
          {pendingApproval.map((task) => (
            <article className="collab-approval" key={task.id}>
              <Route from={task.fromLabel} to={task.toLabel} />
              <p className="collab-approval__instruction">{task.instruction}</p>
              <div className="collab-approval__actions">
                <button
                  className="collab-button"
                  onClick={() => onReject(task.id)}
                  type="button"
                >
                  <X aria-hidden="true" size={ICON.xs} />
                  <span>不发</span>
                </button>
                <button
                  className="collab-button collab-button--primary"
                  onClick={() => onApprove(task.id)}
                  type="button"
                >
                  <Check aria-hidden="true" size={ICON.xs} />
                  <span>发出去</span>
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <div className="collab-panel__body">
        {tasks.length === 0 ? (
          <p className="collab-panel__empty">
            还没有跨会话的任务。Agent 在自己的终端里敲 <code>belfry send</code> 就能请别的会话干活。
          </p>
        ) : (
          <ul className="collab-list">
            {tasks.map((task) => (
              <li className="collab-row" key={task.id}>
                <span className={`collab-dot is-${task.state}`} aria-hidden="true" />
                <div className="collab-row__main">
                  <Route from={task.fromLabel} to={task.toLabel} />
                  <span className="collab-row__instruction">{task.instruction}</span>
                </div>
                <span className="collab-row__state">{describe(task)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="collab-panel__foot">
        <span>「已送达」只说明指令进了对方终端，做没做完要它自己回话</span>
        <kbd>{shortcutLabel}</kbd>
      </footer>
    </div>
  );
}

function Route({ from, to }: { from: string; to: string }) {
  return (
    <span className="collab-route">
      <span className="collab-route__end">{from}</span>
      <ArrowRight aria-hidden="true" size={ICON.xs} />
      <span className="collab-route__end">{to}</span>
    </span>
  );
}

function summary(pending: number, active: number, total: number) {
  if (pending > 0) return `${pending} 条等你确认`;
  if (active > 0) return `${active} 条进行中`;
  return total > 0 ? `${total} 条记录` : "还没有任务";
}

/**
 * 状态文案。
 *
 * `dispatched` 刻意不叫「进行中」——我们只知道指令进了对方的终端，
 * 它有没有在做、做到哪一步，只有它自己敲 done 才算数。
 */
function describe(task: TaskView) {
  switch (task.state) {
    case "pendingApproval":
      return "等确认";
    case "queued":
      return "等对方空闲";
    case "dispatched":
      return "已送达";
    case "done":
      return task.result ? `完成 · ${task.result}` : "完成";
    case "failed":
      return task.result ? `没做成 · ${task.result}` : "没做成";
    case "abandoned":
      return task.result ?? "已中止";
    default:
      return "";
  }
}
