import { useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

interface FontDropdownOptions {
  optionCount: number;
  selectedIndex: number;
  onCommit: () => void;
  onSelect: (index: number) => void;
}

export function useFontDropdown(options: FontDropdownOptions) {
  const { optionCount, selectedIndex, onCommit, onSelect } = options;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const close = () => setOpen(false);
  const openMenu = () => {
    setOpen(true);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  };
  const select = (index: number) => {
    onSelect(index);
    close();
    inputRef.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 中文字体名（苹方、思源黑体）得打中文来搜。组字时 Enter 是确认候选词、
    // Escape 是取消候选，都不该拿去操作这个下拉。
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") return dismissOnEscape(event, open, close);
    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      return select(activeIndex);
    }
    if (event.key === "Enter") return event.currentTarget.blur();
    const step = arrowStep(event.key);
    if (step === 0) return;
    event.preventDefault();
    setOpen(true);
    setActiveIndex((current) => nextIndex(current, step, optionCount));
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    close();
    onCommit();
  };
  const toggle = () => {
    inputRef.current?.focus();
    if (open) close();
    else openMenu();
  };
  return {
    rootRef, inputRef, open, activeIndex, setActiveIndex, openMenu, onKeyDown, onBlur, toggle, select,
    openForTyping: () => { setOpen(true); setActiveIndex(-1); },
    activeId: (listId: string) => open && activeIndex >= 0
      ? `${listId}-option-${activeIndex}`
      : undefined,
  };
}

function dismissOnEscape(event: KeyboardEvent<HTMLInputElement>, open: boolean, close: () => void) {
  if (!open) return;
  event.preventDefault();
  event.stopPropagation();
  close();
}

function arrowStep(key: string) {
  if (key === "ArrowDown") return 1;
  if (key === "ArrowUp") return -1;
  return 0;
}

function nextIndex(current: number, step: number, count: number) {
  const start = current >= 0 ? current : step > 0 ? -1 : 0;
  return (start + step + count) % count;
}
