import { AlertTriangle, Check, Copy, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ICON } from "../theme/sizing";
import { useDismiss } from "../workspace/useDismiss";
import type { TaskView } from "./api";
import { formatTaskTime, formatTaskTimestamp } from "./relativeTime";
import { activeTasks, awaitingApproval, taskTone } from "./taskTone";
import type { CollabTasksView } from "./useCollabTasks";
import "./collab.css";

/** 节点里的图标要比常规图标小一档才压得进 10px 的节点位，比 ICON.xs(16) 还小。 */
const NODE_ICON = 12;

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

  // 每次渲染取一次「现在」，同一批事件共用，相对时长不会互相错开一秒。
  // 不用额外定时器：useCollabTasks 每 1.5s 就换一次 tasks 数组引用，
  // 必定重渲染，「刚刚 → 3 分钟前」自己会跟上。
  const now = Date.now();

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
          <TaskGroup title="等你确认" tasks={waiting}>
            {waiting.map((task) => (
              <TaskEvent key={task.id} now={now} onApprove={collab.approve} onReject={collab.reject} task={task} />
            ))}
          </TaskGroup>
        ) : null}
        {active.length > 0 ? (
          <TaskGroup title="进行中" tasks={active}>
            {active.map((task) => <TaskEvent key={task.id} now={now} task={task} />)}
          </TaskGroup>
        ) : null}
        {settled.length > 0 ? (
          <TaskGroup quiet title="已结" tasks={settled}>
            {settled.map((task) => <TaskEvent key={task.id} now={now} task={task} />)}
          </TaskGroup>
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
 * 就是那两条命令，否则会在这里找一个不存在的「新建任务」按钮。「在任一 Agent 会话的
 * 终端里敲」那句就是承担这件事的，改文案别把这层意思弄丢。
 *
 * 轨道预演是虚线版的时间轴：空态和有内容时用同一套语言，从这里切到有任务时
 * 节点位置也不跳（左列栅格与 .collab-event 一致）。
 */
function EmptyHint() {
  return (
    <div className="collab-empty">
      <p className="collab-empty__lead">还没有派活记录</p>

      <div className="collab-empty__preview">
        <PreviewRow>派出去的活会一条条长在这里</PreviewRow>
        <PreviewRow>谁派给谁、跑到哪一步</PreviewRow>
      </div>

      <div className="collab-empty__howto">
        <p>在任一 Agent 会话的终端里敲</p>
        <CopyableCommand hint="看现在有谁、各自忙不忙" command="belfry peers" />
        <CopyableCommand hint="把活派给叫 ui 的那条会话" command="belfry send ui 审一下 auth.ts" />
      </div>

      <p className="collab-empty__note">名字要先在侧栏双击会话起</p>
    </div>
  );
}

/**
 * 预演轨道上的一行。
 *
 * 只有节点和线是 `aria-hidden`——它们是示意图。说明文字留在无障碍树里，
 * 读屏用户靠它们知道这个面板将来会显示什么。
 */
function PreviewRow({ children }: { children: ReactNode }) {
  return (
    <div className="collab-empty__row">
      <span aria-hidden="true" className="collab-empty__rail">
        <span className="collab-empty__node" />
      </span>
      <span className="collab-empty__caption">{children}</span>
    </div>
  );
}

/**
 * 一条可点击复制的命令。
 *
 * 每条各自持有自己的 `copied`，两条互不干扰——用一个 index 存在 EmptyHint 里的话，
 * 点第二条会把第一条的勾撤掉。
 */
function CopyableCommand({ command, hint }: { command: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  // 卸载时清掉定时器：面板随时会被关掉，1.5s 内关掉就会在已卸载的组件上 setState。
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // 非安全上下文或权限被拒。静默保持原状——显示一个假的成功勾比没有反馈更糟。
      return;
    }
    setCopied(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="collab-empty__command">
      <button
        aria-label={copied ? "已复制" : `复制命令 ${command}`}
        className="collab-empty__copy"
        onClick={() => void copy()}
        type="button"
      >
        <code>{command}</code>
        {copied ? (
          <Check aria-hidden="true" className="collab-empty__copied" size={ICON.xs} />
        ) : (
          <Copy aria-hidden="true" size={ICON.xs} />
        )}
      </button>
      <small>{hint}</small>
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  quiet,
  children,
}: {
  title: string;
  tasks: readonly TaskView[];
  quiet?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`collab-group${quiet ? " collab-group--quiet" : ""}`}>
      <h3>
        {title}
        {/* 计数让人不用一条条数就知道这组有多少。 */}
        <span className="collab-group__count">{tasks.length}</span>
      </h3>
      {/* 轨道的收口靠 :first-child / :last-child，所以事件必须自己独占一个容器，
          不能和 h3 混在同一个父级里——那样第一个事件就永远不是 first-child。 */}
      <div className="collab-group__track">{children}</div>
    </section>
  );
}

/**
 * 轨道上的一个事件。
 *
 * 左列是节点与轨道线（纯装饰，`aria-hidden`——状态语义全由右列的状态行文字承担），
 * 右列自上而下四行：路由、状态、指令、结果。
 */
function TaskEvent({
  task,
  now,
  onApprove,
  onReject,
}: {
  task: TaskView;
  now: number;
  onApprove?: (id: string) => Promise<void>;
  onReject?: (id: string) => Promise<void>;
}) {
  const { label, tone } = taskTone(task.state);
  const stamp = formatTaskTimestamp(task.createdAt);

  return (
    <article className={`collab-event collab-event--${tone}`}>
      <span aria-hidden="true" className="collab-event__rail">
        <span className="collab-event__node">
          {tone === "done" ? <Check size={NODE_ICON} /> : null}
          {tone === "failed" ? <X size={NODE_ICON} /> : null}
        </span>
      </span>

      <div className="collab-event__body">
        <div className="collab-event__route">
          <span className="collab-event__from">{task.fromLabel}</span>
          <span aria-hidden="true" className="collab-event__arrow">→</span>
          {/* 活在它手上，所以它重。 */}
          <span className="collab-event__to">{task.toLabel}</span>
          {/* 用 span 不用 <time>：<time> 要么得有合法的 datetime 属性、要么正文本身
              就得是合法时间戳，而这里正文是「3 分钟前」。真去拼 datetime 就得
              toISOString()，它在 createdAt 越界时会抛 RangeError，一条脏时间戳能把
              整个面板炸掉——完整时刻挂在 title 上就够了。 */}
          <span className="collab-event__time" title={`派活时间 ${stamp}`}>
            {formatTaskTime(task.createdAt, now)}
          </span>
        </div>

        <div className="collab-event__status">
          <span className="collab-event__state">{label}</span>
          {/* 降权但不删：去 CLI 对表时还得靠它，user-select: all 让双击能整段复制。 */}
          <code className="collab-event__id">{task.shortId}</code>
        </div>

        <p className="collab-event__instruction" title={task.instruction}>{task.instruction}</p>

        {task.result ? (
          <p className="collab-event__result" title={task.result}>{task.result}</p>
        ) : null}

        {onApprove && onReject ? (
          <div className="collab-event__actions">
            <button className="collab-button collab-button--quiet" onClick={() => void onReject(task.id)} type="button">
              拒绝
            </button>
            <button className="collab-button collab-button--primary" onClick={() => void onApprove(task.id)} type="button">
              <Check aria-hidden="true" size={ICON.xs} />
              <span>批准</span>
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
