import { Library, Pin, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ICON } from "../theme/sizing";
import type { WorkspaceTab } from "../workspace/contracts";
import { useDismiss } from "../workspace/useDismiss";
import { contextReference, type ContextItem, type ContextKind } from "./contracts";
import "./contextPanel.css";

interface ContextPanelProps {
  activeTabId: string | null;
  failure: string | null;
  items: readonly ContextItem[];
  loading: boolean;
  /** 有项目才能存：索引落在项目目录里。 */
  hasProject: boolean;
  shortcutLabel: string;
  tabs: readonly WorkspaceTab[];
  onAddNote: (title: string, body: string) => void;
  onCaptureSelection: (tabId: string) => void;
  onClose: () => void;
  onInsert: (item: ContextItem) => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
}

export function ContextPanel({
  activeTabId,
  failure,
  items,
  loading,
  hasProject,
  shortcutLabel,
  tabs,
  onAddNote,
  onCaptureSelection,
  onClose,
  onInsert,
  onRemove,
  onTogglePin,
}: ContextPanelProps) {
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  // 写笔记时点外面会吞掉正在填的内容，和 Recipe 编辑视图同一个理由。
  const panelRef = useDismiss<HTMLDivElement>(draft === null, onClose);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs],
  );
  const pinnedCount = items.filter((item) => item.pinned).length;

  return (
    <div aria-label="共享上下文" className="context-panel" ref={panelRef} role="region">
      <header className="context-panel__head">
        <span aria-hidden="true" className="context-panel__mark">
          <Library size={ICON.md} />
        </span>
        <div className="context-panel__title">
          <strong>共享上下文</strong>
          <span>{summary(items.length, pinnedCount, loading, hasProject)}</span>
        </div>
        {draft === null ? (
          <button
            className="context-button"
            disabled={!hasProject}
            onClick={() => setDraft({ title: "", body: "" })}
            type="button"
          >
            <Plus aria-hidden="true" size={ICON.xs} />
            <span>写一条</span>
          </button>
        ) : null}
        <button
          aria-label="关闭共享上下文"
          className="icon-button icon-button--sm"
          onClick={onClose}
          title="关闭"
          type="button"
        >
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>

      {failure ? <p className="context-panel__failure">{failure}</p> : null}

      {draft !== null ? (
        <form
          className="context-draft"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.body.trim().length === 0) return;
            onAddNote(draft.title, draft.body);
            setDraft(null);
          }}
        >
          <input
            aria-label="标题"
            className="context-draft__title"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            placeholder="标题（留空则取正文首行）"
            value={draft.title}
          />
          <textarea
            aria-label="正文"
            className="context-draft__body"
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            placeholder="这个项目里所有 Agent 都该知道的约定、决策或结论"
            rows={4}
            value={draft.body}
          />
          <div className="context-draft__actions">
            <button className="context-button" onClick={() => setDraft(null)} type="button">
              取消
            </button>
            <button
              className="context-button context-button--primary"
              disabled={draft.body.trim().length === 0}
              type="submit"
            >
              存下
            </button>
          </div>
        </form>
      ) : null}

      {draft === null ? (
        <>
          <div className="context-panel__subhead">
            <span>{captureHint(activeTab)}</span>
            <button
              className="context-button"
              disabled={!hasProject || !activeTab}
              onClick={() => activeTab && onCaptureSelection(activeTab.id)}
              type="button"
            >
              存入选区
            </button>
          </div>
          <div className="context-panel__body">
            {items.length === 0 ? (
              <p className="context-panel__empty">
                {hasProject
                  ? "还没有共享上下文。存进来的约定和片段，任何 Agent 会话都能引用。"
                  : "先打开一个项目：共享上下文存在项目目录里。"}
              </p>
            ) : (
              <ul className="context-list">
                {items.map((item) => (
                  <li className="context-row" key={item.id}>
                    <button
                      className="context-row__main"
                      onClick={() => onInsert(item)}
                      title={`插入引用：${contextReference(item)}`}
                      type="button"
                    >
                      <strong>{item.title}</strong>
                      <span>{describe(item)}</span>
                    </button>
                    <button
                      aria-label={item.pinned ? "取消置顶" : "置顶"}
                      aria-pressed={item.pinned}
                      className={`icon-button icon-button--sm context-pin${item.pinned ? " is-on" : ""}`}
                      onClick={() => onTogglePin(item.id)}
                      title={item.pinned ? "取消置顶" : "置顶：新会话自动带上"}
                      type="button"
                    >
                      <Pin aria-hidden="true" size={ICON.xs} />
                    </button>
                    <button
                      aria-label={`删除 ${item.title}`}
                      className="icon-button icon-button--sm"
                      onClick={() => onRemove(item.id)}
                      title="删除"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={ICON.xs} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      <footer className="context-panel__foot">
        <span>正文长的存成文件，引用时只给路径——让 Agent 自己去读，省 token</span>
        <kbd>{shortcutLabel}</kbd>
      </footer>
    </div>
  );
}

function summary(total: number, pinned: number, loading: boolean, hasProject: boolean) {
  if (!hasProject) return "未打开项目";
  if (loading) return "读取中…";
  if (total === 0) return "还没有条目";
  return pinned > 0 ? `${total} 条 · ${pinned} 条置顶` : `${total} 条`;
}

/** 存不了的时候要说清为什么，别只把按钮点灰。 */
function captureHint(tab: WorkspaceTab | null) {
  if (!tab) return "没有活动会话";
  return `从「${tab.title}」抓取当前选中的终端内容`;
}

function describe(item: ContextItem) {
  const parts = [KIND_LABEL[item.kind], sourceLabel(item)];
  if (item.path) parts.push("已落盘");
  if (item.tags.length > 0) parts.push(item.tags.join(" / "));
  return parts.filter(Boolean).join(" · ");
}

const KIND_LABEL: Record<ContextKind, string> = {
  note: "笔记",
  excerpt: "片段",
  artifact: "产物",
  digest: "摘要",
};

/** 来路决定可信度：手敲的和从屏幕上抓的不是一回事，列表里要看得出来。 */
function sourceLabel(item: ContextItem) {
  switch (item.source.from) {
    case "user":
      return "手写";
    case "terminal":
      return "终端选区";
    case "agent":
      return "Agent 产出";
    case "history":
      return "会话日志";
    default:
      return "";
  }
}
