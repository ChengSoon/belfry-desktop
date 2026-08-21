import {
  Clock3,
  CornerDownLeft,
  MessageSquareText,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ICON } from "../theme/sizing";
import type { WorkspaceTab } from "../workspace/contracts";
import { useDismiss } from "../workspace/useDismiss";
import {
  canDispatchPrompt,
  isAgentKind,
  promptPreview,
  promptTargetLabel,
  type PromptQueueItem,
  type PromptSubmitResult,
} from "./contracts";
import "./promptComposer.css";

interface PromptComposerProps {
  activeTabId: string | null;
  items: readonly PromptQueueItem[];
  shortcutLabel: string;
  tabs: readonly WorkspaceTab[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onSendNow: (tabId: string) => boolean;
  onSubmit: (tabId: string, text: string) => PromptSubmitResult;
}

export function PromptComposer({
  activeTabId,
  items,
  shortcutLabel,
  tabs,
  onClose,
  onRemove,
  onSendNow,
  onSubmit,
}: PromptComposerProps) {
  const agentTabs = useMemo(() => tabs.filter((tab) => isAgentKind(tab.kind)), [tabs]);
  const activeAgent = agentTabs.find((tab) => tab.id === activeTabId) ?? null;
  const [targetTabId, setTargetTabId] = useState(activeAgent?.id ?? agentTabs[0]?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");
  const userPickedTargetRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const panelRef = useDismiss<HTMLDivElement>(true, onClose);
  const target = agentTabs.find((tab) => tab.id === targetTabId) ?? null;
  const draft = target ? drafts[target.id] ?? "" : "";

  useEffect(() => {
    if (!userPickedTargetRef.current && activeAgent) setTargetTabId(activeAgent.id);
    else if (!agentTabs.some((tab) => tab.id === targetTabId)) {
      userPickedTargetRef.current = false;
      setTargetTabId(agentTabs[0]?.id ?? "");
    }
  }, [activeAgent, agentTabs, targetTabId]);

  useEffect(() => {
    textareaRef.current?.focus();
    const returnFocus = returnFocusRef.current;
    return () => returnFocus?.focus();
  }, []);

  const updateDraft = (value: string) => {
    if (!target) return;
    setDrafts((current) => ({ ...current, [target.id]: value }));
    setFeedback("");
  };

  const submit = () => {
    if (!target) return;
    const result = onSubmit(target.id, draft);
    setFeedback(feedbackLabel(result));
    if (result !== "unavailable") {
      setDrafts((current) => ({ ...current, [target.id]: "" }));
    }
  };

  return (
    <div className="prompt-composer" ref={panelRef} role="region" aria-label="Prompt Composer">
      <header className="prompt-composer__head">
        <span className="prompt-composer__mark" aria-hidden="true">
          <MessageSquareText size={ICON.md} />
        </span>
        <div className="prompt-composer__title">
          <strong>Prompt Composer</strong>
          <span>{items.length > 0 ? `队列 ${items.length}` : "队列为空"}</span>
        </div>
        <select
          aria-label="目标 Agent 会话"
          disabled={agentTabs.length === 0}
          onChange={(event) => {
            userPickedTargetRef.current = true;
            setTargetTabId(event.target.value);
            setFeedback("");
          }}
          value={targetTabId}
        >
          {agentTabs.length === 0 ? <option value="">没有 Agent 会话</option> : null}
          {agentTabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {promptTargetLabel(tab.kind)} · {tab.title}
            </option>
          ))}
        </select>
        <span
          aria-live="polite"
          className={`prompt-composer__status prompt-composer__status--${statusTone(target)}`}
        >
          {targetStatus(target)}
        </span>
        <button
          aria-label="关闭 Prompt Composer"
          className="icon-button icon-button--sm"
          onClick={onClose}
          title="关闭"
          type="button"
        >
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>

      <div className="prompt-composer__editor">
        <textarea
          aria-label="Prompt 内容"
          disabled={!target}
          onChange={(event) => updateDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={target ? "输入要发送给 Agent 的内容" : "先打开 Codex 或 Claude 会话"}
          ref={textareaRef}
          spellCheck={false}
          value={draft}
        />
        <div className="prompt-composer__send">
          <span aria-live="polite">{feedback}</span>
          <button
            aria-label={target && canDispatchPrompt(target) ? "发送提示词" : "将提示词加入队列"}
            disabled={!target || !draft.trim() || target.phase === "exited" || target.phase === "error"}
            onClick={submit}
            type="button"
          >
            <Send aria-hidden="true" size={ICON.sm} />
            <span>{target && canDispatchPrompt(target) ? "发送" : "加入队列"}</span>
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <div aria-label="Prompt Queue" className="prompt-queue">
          {items.map((item) => {
            const itemTarget = agentTabs.find((tab) => tab.id === item.tabId);
            return (
              <div className="prompt-queue__item" key={item.id}>
                <Clock3 aria-hidden="true" size={ICON.sm} />
                <span className="prompt-queue__copy">
                  <strong>{itemTarget?.title ?? "已关闭会话"}</strong>
                  <small title={item.text}>{promptPreview(item.text)}</small>
                </span>
                <button
                  aria-label={`立即发送到 ${itemTarget?.title ?? "目标会话"}`}
                  disabled={!itemTarget}
                  onClick={() => setFeedback(onSendNow(item.tabId) ? "已发送" : "目标暂不可用")}
                  title="立即发送"
                  type="button"
                >
                  <Send aria-hidden="true" size={ICON.xs} />
                </button>
                <button
                  aria-label="从队列移除"
                  onClick={() => onRemove(item.id)}
                  title="从队列移除"
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={ICON.xs} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <footer className="prompt-composer__foot">
        <span><kbd>⌘/Ctrl</kbd><kbd><CornerDownLeft size={ICON.xs} /></kbd> 发送</span>
        <span><kbd>Esc</kbd> 关闭</span>
        <span>{shortcutLabel}</span>
      </footer>
    </div>
  );
}

function targetStatus(tab: WorkspaceTab | null) {
  if (!tab) return "未选择";
  if (tab.phase === "creating" || tab.phase === "idle") return "启动中";
  if (tab.phase === "exited" || tab.phase === "error") return "不可用";
  if (tab.activity === "talking") return "处理中";
  if (tab.activity === "awaiting-choice") return "等待输入";
  return "可发送";
}

function statusTone(tab: WorkspaceTab | null) {
  if (!tab || tab.phase === "exited" || tab.phase === "error") return "muted";
  if (tab.phase !== "running" || tab.activity !== "idle") return "busy";
  return "ready";
}

function feedbackLabel(result: PromptSubmitResult) {
  if (result === "sent") return "已发送";
  if (result === "queued") return "已加入队列";
  return "目标暂不可用";
}
