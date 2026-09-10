interface UserInputSource {
  terminal: { onKey: (listener: () => void) => { dispose: () => void } };
  host: Pick<HTMLElement, "addEventListener" | "removeEventListener">;
  onInput: () => void;
}

/** onData 混有设备应答，不能用于识别人工介入；只监听公开键盘事件及原生编辑事件。 */
export function listenForPromptUserInput({ terminal, host, onInput }: UserInputSource) {
  const key = terminal.onKey(onInput);
  // onKey 不涵盖 IME、移动端 beforeinput 或原生菜单粘贴；捕获阶段先于 xterm 处理。
  const events = ["beforeinput", "compositionstart", "paste"] as const;
  for (const event of events) host.addEventListener(event, onInput, { capture: true });
  return () => {
    key.dispose();
    for (const event of events) host.removeEventListener(event, onInput, { capture: true });
  };
}
