import { AlertTriangle, Check, Users, X } from "lucide-react";
import { ICON } from "../theme/sizing";
import { useDismiss } from "../workspace/useDismiss";
import type { TaskView } from "./api";
import { activeTasks, awaitingApproval, taskTone } from "./taskTone";
import type { CollabTasksView } from "./useCollabTasks";
import "./collab.css";

interface CollabPanelProps {
  collab: CollabTasksView;
  onClose: () => void;
}

export function CollabPanel({ collab, onClose }: CollabPanelProps) {
  const ref = useDismiss<HTMLElement>(true, onClose);
  const waiting = awaitingApproval(collab.tasks);
  const active = activeTasks(collab.tasks);
  const settled = collab.tasks.filter(
    (task) => !waiting.includes(task) && !active.includes(task),
  );

  return (
    <aside aria-labelledby="collab-panel-title" className="collab-panel" ref={ref}>
      <header className="collab-panel__head">
        <span aria-hidden="true" className="collab-panel__mark"><Users size={ICON.md} /></span>
        <div className="collab-panel__title">
          <strong id="collab-panel-title">会话协作</strong>
          <span>{waiting.length > 0 ? `${waiting.length} 条等你确认` : "Agent 之间互相派活"}</span>
        </div>
        <button aria-label="关闭协作面板" className="icon-button icon-button--sm" onClick={onClose} title="关闭" type="button">
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>

      {collab.error ? (
        <div className="collab-panel__error" role="alert">
          <AlertTriangle aria-hidden="true" size={ICON.sm} />
          <span>{collab.error}</span>
        </div>
      ) : null}

      <div className="collab-panel__body">
        {collab.tasks.length === 0 ? <EmptyHint /> : null}
        {waiting.length > 0 ? (
          <section className="collab-group">
            <h3>等你确认</h3>
            {waiting.map((task) => (
              <TaskCard key={task.id} onApprove={collab.approve} onReject={collab.reject} task={task} />
            ))}
          </section>
        ) : null}
        {active.length > 0 ? (
          <section className="collab-group">
            <h3>进行中</h3>
            {active.map((task) => <TaskCard key={task.id} task={task} />)}
          </section>
        ) : null}
        {settled.length > 0 ? (
          <section className="collab-group collab-group--quiet">
            <h3>已结</h3>
            {settled.map((task) => <TaskCard key={task.id} task={task} />)}
          </section>
        ) : null}
      </div>

      <footer className="collab-panel__foot">
        <span className="collab-panel__count">
          {active.length > 0 ? `${active.length} 条在跑` : "没有在跑的任务"}
        </span>
        {waiting.length + active.length > 0 ? (
          <button className="collab-button collab-button--danger" onClick={() => void collab.stopAll()} type="button">
            全部停下
          </button>
        ) : null}
      </footer>
    </aside>
  );
}

/**
 * 空态要把用法说全。
 *
 * 这个面板只是「看和拦」，派活本身发生在 Agent 会话里——用户第一次打开时最需要知道的
 * 就是那两条命令，否则会在这里找一个不存在的「新建任务」按钮。
 */
function EmptyHint() {
  return (
    <div className="collab-empty">
      <p>还没有派活记录。</p>
      <p>在任一 Agent 会话里：</p>
      <code>belfry peers</code>
      <small>看现在有谁、各自忙不忙</small>
      <code>belfry send reviewer 审一下 auth.ts</code>
      <small>把活派给叫 reviewer 的那条会话</small>
      <p className="collab-empty__note">
        名字在侧栏双击会话来起。同项目的派活会直接投进对方终端，这里看得到每一条的去向和状态；
        要收手就按「全部停下」。
      </p>
    </div>
  );
}

function TaskCard({
  task,
  onApprove,
  onReject,
}: {
  task: TaskView;
  onApprove?: (id: string) => Promise<void>;
  onReject?: (id: string) => Promise<void>;
}) {
  const { label, tone } = taskTone(task.state);
  return (
    <article className={`collab-task collab-task--${tone}`}>
      <div className="collab-task__route">
        <strong>{task.fromLabel}</strong>
        <span aria-hidden="true">→</span>
        <strong>{task.toLabel}</strong>
        <code>{task.shortId}</code>
      </div>
      <p className="collab-task__instruction">{task.instruction}</p>
      <div className="collab-task__foot">
        <span className="collab-task__state">{label}</span>
        {onApprove && onReject ? (
          <span className="collab-task__actions">
            <button className="collab-button collab-button--quiet" onClick={() => void onReject(task.id)} type="button">
              拒绝
            </button>
            <button className="collab-button collab-button--primary" onClick={() => void onApprove(task.id)} type="button">
              <Check aria-hidden="true" size={ICON.xs} />
              <span>批准</span>
            </button>
          </span>
        ) : null}
      </div>
      {task.result ? <p className="collab-task__result">{task.result}</p> : null}
    </article>
  );
}
