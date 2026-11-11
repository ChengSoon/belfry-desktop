import { formatNumber } from "../i18n";
import { AlertTriangle, Check, Copy, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ICON } from "../theme/sizing";
import { useDismiss } from "../workspace/useDismiss";
import type { TaskView } from "./api";
import { formatTaskTime, formatTaskTimestamp } from "./relativeTime";
import { activeTasks, awaitingApproval, deliveryLabel, taskTone } from "./taskTone";
import type { CollabTasksView } from "./useCollabTasks";
import { DeliveryActions, type DeliveryDecision } from "./DeliveryActions";
import { t, useTranslation } from "../i18n";
import "./collab.css";
import { InboxView } from "../inbox/InboxView";
import type { InboxView as InboxData } from "../inbox/useInbox";

/** 节点里的图标要比常规图标小一档才压得进 10px 的节点位，比 ICON.xs(16) 还小。 */
const NODE_ICON = 12;

interface CollabPanelProps {
  collab: CollabTasksView;
  onClose: () => void;
  onOpenTerminal?: (tabId: string) => void;
  availableTabIds?: readonly string[];
  /** 后端启用协作收件箱时提供：面板顶部切到只读的会话/消息视图。 */
  inbox?: InboxData;
  /** 收件箱支持但启用失败：自动投递已暂停，需要告诉用户。 */
  deliveryHalted?: boolean;
  deliveryError?: string | null;
}

export function CollabPanel({ collab, onClose, onOpenTerminal, availableTabIds, inbox, deliveryHalted, deliveryError }: CollabPanelProps) {
  useTranslation();
  // Other panel triggers switch on click. Closing on mousedown creates an empty
  // rail between press/release and resizes every terminal twice unnecessarily.
  const ref = useDismiss<HTMLElement>(true, onClose, "click");
  const waiting = awaitingApproval(collab.tasks);
  const active = activeTasks(collab.tasks);
  const settled = collab.tasks.filter(
    (task) => !waiting.includes(task) && !active.includes(task),
  );
  const [filter, setFilter] = useState<"all" | "waiting" | "active" | "settled">("all");
  const [view, setView] = useState<"inbox" | "tasks">("inbox");
  const showInbox = !!inbox && view === "inbox";
  const filters = [
    { id: "all", label: t("collab.CollabPanel.text_5c55a67935"), count: collab.tasks.length },
    { id: "waiting", label: t("collab.CollabPanel.text_a8b0bd9c65"), count: waiting.length },
    { id: "active", label: t("collab.work.open"), count: active.length },
    { id: "settled", label: t("collab.CollabPanel.text_d79b1d0e5c"), count: settled.length },
  ] as const;

  // 每次渲染取一次「现在」，同一批事件共用，相对时长不会互相错开一秒。
  // 不用额外定时器：useCollabTasks 每 1.5s 就换一次 tasks 数组引用，
  // 必定重渲染，「刚刚 → 3 分钟前」自己会跟上。
  const now = Date.now();

  return (
    <aside aria-labelledby="collab-panel-title" className="collab-panel" ref={ref}>
      <header className="collab-panel__head">
        <Users aria-hidden="true" size={ICON.md} />
        <h2 id="collab-panel-title">{t("collab.CollabPanel.text_18a62218d6")}</h2>
        {/* 等确认的条数原先是标题下面的第二行说明文字，那行把头部撑到 56px，
            右侧四个面板的标题行因此对不齐。改成与历史面板同款的计数徽标：
            同一件事（这一列现在有多少条要紧的）用同一种表达。
            没有等确认的活时不显示——"Agent 之间互相派活"那句是功能介绍，
            空态里已经讲得更清楚，头部不必再说一遍。 */}
        {waiting.length > 0 ? (
          <span className="panel-count panel-count--alert">{formatNumber(waiting.length)}</span>
        ) : null}
        <button aria-label={t("collab.CollabPanel.text_29f1d60549")} className="icon-button icon-button--sm" onClick={onClose} title={t("collab.CollabPanel.text_3fd47edce4")} type="button">
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>
      {deliveryHalted ? (
        <div className="collab-panel__error" role="alert"><AlertTriangle aria-hidden="true" size={ICON.sm} /><div><span>{t("inbox.panel.halted")}</span>{deliveryError ? <small>{deliveryError}</small> : null}</div></div>
      ) : null}
      {inbox ? (
        <div className="collab-views" role="tablist" aria-label={t("inbox.panel.views")}>
          <button type="button" role="tab" aria-selected={view === "inbox"} onClick={() => setView("inbox")}>{t("inbox.panel.title")}</button>
          <button type="button" role="tab" aria-selected={view === "tasks"} onClick={() => setView("tasks")}>{t("inbox.panel.tasks")}</button>
        </div>
      ) : null}
      {showInbox ? <InboxView inbox={inbox!} availableTabIds={availableTabIds} onOpenSession={onOpenTerminal} /> : <>
      <div className="collab-panel__context">
        <p>{t("collab.CollabPanel.text_63ac23a22d")}</p>
        <div className="collab-filters" role="group" aria-label={t("collab.CollabPanel.text_c310faf317")}>
          {filters.map(({ id, label, count }) => <button key={id} type="button" aria-pressed={filter === id}
            onClick={() => setFilter(id)}>{label}<span>{formatNumber(count)}</span></button>)}
        </div>
      </div>

      {collab.queryError ? (
        <div className="collab-panel__error" role="alert">
          <AlertTriangle aria-hidden="true" size={ICON.sm} />
          <div><span>{collab.queryError}</span><small>{t("collab.CollabPanel.text_c9bcc7ce48")}</small></div>
        </div>
      ) : null}
      {collab.actionErrors.map(({ action, message }) => (
        <div className="collab-panel__error" role="alert" key={action.kind === "stopAll" ? action.kind : action.id}>
          <AlertTriangle aria-hidden="true" size={ICON.sm} />
          <div><span>{message}</span><small>{action.kind === "resolve" ? t("collab.delivery.changed") : t("collab.actionFailed")}</small>
            {action.kind !== "resolve" ? <button className="collab-button" disabled={collab.pending.size > 0} onClick={() => void collab.retry(action)} type="button">
              {action.kind === "approve" ? t("collab.CollabPanel.text_de30201f78") : action.kind === "reject" ? t("collab.CollabPanel.text_2d11b66a96") : t("collab.CollabPanel.text_f5e08d424e")}
            </button> : null}
          </div>
        </div>
      ))}

      <div className="collab-panel__body">
        {collab.tasks.length === 0 ? <EmptyHint /> : null}
        {collab.tasks.length > 0 && filters.find((item) => item.id === filter)?.count === 0 ?
          <p className="collab-panel__empty-filter" role="status">{t("collab.CollabPanel.text_cede695309")}</p> : null}
        {(filter === "all" || filter === "waiting") && waiting.length > 0 ? (
          <TaskGroup title={t("collab.CollabPanel.text_99e5109f91")} tasks={waiting}>
            {waiting.map((task) => (
              <TaskEvent key={task.id} now={now} onApprove={collab.approve} onReject={collab.reject} task={task}
                pending={collab.pending.has(task.id) || collab.pending.has("stopAll")} />
            ))}
          </TaskGroup>
        ) : null}
        {(filter === "all" || filter === "active") && active.length > 0 ? (
          <TaskGroup title={t("collab.work.open")} tasks={active}>
            {active.map((task) => <TaskEvent key={task.id} now={now} task={task} onResolve={collab.resolve}
              pending={collab.pending.has(task.id) || collab.pending.has("stopAll")}
              onLocate={task.toTabId && (!availableTabIds || availableTabIds.includes(task.toTabId)) ? onOpenTerminal : undefined} />)}
          </TaskGroup>
        ) : null}
        {(filter === "all" || filter === "settled") && settled.length > 0 ? (
          <TaskGroup quiet title={t("collab.CollabPanel.text_d79b1d0e5c")} tasks={settled}>
            {settled.map((task) => <TaskEvent key={task.id} now={now} task={task} />)}
          </TaskGroup>
        ) : null}
      </div>

      <footer className="collab-panel__foot">
        <span className="collab-panel__count">
          {active.length > 0 ? t("collab.work.openCount", { count: active.length }) : t("collab.work.noneOpen")}
        </span>
        {waiting.length + active.length > 0 ? (
          <button className="collab-button collab-button--danger" disabled={collab.pending.size > 0} onClick={() => void collab.stopAll()} type="button">{t("collab.CollabPanel.text_784aaf3360")}</button>
        ) : null}
      </footer>
      </>}
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
  useTranslation();
  return (
    <div className="collab-empty">
      <p className="collab-empty__lead">{t("collab.CollabPanel.text_7d88c6d2bc")}</p>

      <div className="collab-empty__preview">
        <PreviewRow>{t("collab.CollabPanel.text_496a439f66")}</PreviewRow>
        <PreviewRow>{t("collab.CollabPanel.text_61d5a81566")}</PreviewRow>
      </div>

      <div className="collab-empty__howto">
        <p>{t("collab.CollabPanel.text_cd9e7aec5b")}</p>
        <CopyableCommand hint={t("collab.CollabPanel.text_2bebdeab7c")} command="belfry peers" />
        <CopyableCommand hint={t("collab.CollabPanel.text_d3f94a74a0")} command={t("collab.CollabPanel.text_ca0e9340c8")} />
      </div>

      <p className="collab-empty__note">{t("collab.CollabPanel.text_ddb63e3a24")}</p>
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
  useTranslation();
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
  useTranslation();
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
        aria-label={copied ? t("collab.CollabPanel.text_8f6f8d979c") : t("collab.CollabPanel.text_8f19384b76", { command: command })}
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
  useTranslation();
  return (
    <section className={`collab-group${quiet ? " collab-group--quiet" : ""}`}>
      <h3>
        {title}
        {/* 计数让人不用一条条数就知道这组有多少。 */}
        <span className="collab-group__count">{formatNumber(tasks.length)}</span>
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
  onResolve,
  onLocate,
  pending = false,
}: {
  task: TaskView;
  now: number;
  onApprove?: (id: string) => Promise<void>;
  onReject?: (id: string) => Promise<void>;
  onResolve?: (task: TaskView, decision: DeliveryDecision) => Promise<void>;
  onLocate?: (tabId: string) => void;
  pending?: boolean;
}) {
  useTranslation();
  const { label, tone } = taskTone(task.state, task.delivery?.phase);
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
          <span className="collab-event__time" title={t("collab.CollabPanel.text_e6e586c9f4", { stamp: stamp })}>
            {formatTaskTime(task.createdAt, now)}
          </span>
        </div>

        <div className="collab-event__status">
          <span className="collab-event__state">{label}</span>
          {task.delivery && ["done", "failed", "abandoned"].includes(task.state)
            ? <span className="collab-event__receipt">{deliveryLabel(task.delivery.phase)}</span> : null}
          {/* 降权但不删：去 CLI 对表时还得靠它，user-select: all 让双击能整段复制。 */}
          <code className="collab-event__id">{task.shortId}</code>
        </div>

        <p className="collab-event__instruction" title={task.instruction}>{task.instruction}</p>
        {task.delivery?.message ? <p className="collab-event__delivery-message">{task.delivery.message}</p> : null}
        <DeliveryActions task={task} pending={pending} onResolve={onResolve} onLocate={onLocate} />

        {task.result ? (
          <details className="collab-event__result-detail"><summary>{t("collab.CollabPanel.text_bb89790139")}</summary>
            <p className="collab-event__result">{task.result}</p>
          </details>
        ) : null}

        {onApprove && onReject ? (
          <div className="collab-event__actions">
            <button className="collab-button collab-button--quiet" disabled={pending} onClick={() => void onReject(task.id)} type="button">{t("collab.CollabPanel.text_136de7a8c4")}</button>
            <button className="collab-button collab-button--primary" disabled={pending} onClick={() => void onApprove(task.id)} type="button">
              <Check aria-hidden="true" size={ICON.xs} />
              <span>{t("collab.CollabPanel.text_8cbe697b15")}</span>
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
