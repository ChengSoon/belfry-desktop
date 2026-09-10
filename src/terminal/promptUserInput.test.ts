import { expect, it, vi } from "vitest";
import { listenForPromptUserInput } from "./promptUserInput";

it("键盘、原生粘贴和输入法通知人工介入，卸载后移除监听", () => {
  const host = new EventTarget();
  const onInput = vi.fn();
  const dispose = vi.fn();
  const onKey = vi.fn((_listener: () => void) => ({ dispose }));
  const remove = listenForPromptUserInput({ terminal: { onKey }, host, onInput });
  onKey.mock.calls[0][0]();
  for (const event of ["beforeinput", "compositionstart", "paste"]) host.dispatchEvent(new Event(event));
  expect(onInput).toHaveBeenCalledTimes(4);
  remove();
  expect(dispose).toHaveBeenCalledOnce();
  host.dispatchEvent(new Event("paste"));
  expect(onInput).toHaveBeenCalledTimes(4);
});
