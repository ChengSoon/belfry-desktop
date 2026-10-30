import { expect, it } from "vitest";
import { composingKey, guardComposingEnter, suppressComposingEnter } from "./keyboard";

it("组字中的按键与输入法消费的按键都算组字，真按键不算", () => {
  // Chrome / Firefox 的规范顺序：确认候选的回车 keydown 仍带 isComposing。
  expect(composingKey({ key: "Enter", keyCode: 13, isComposing: true })).toBe(true);
  // macOS WKWebView：compositionend 先于 keydown，确认回车只剩 keyCode 229 能认
  //（用户报告「打字回车也会触发系统的回车事件」的根因）。
  expect(composingKey({ key: "Enter", keyCode: 229, isComposing: false })).toBe(true);
  expect(composingKey({ key: "Process", keyCode: 229 })).toBe(true);
  expect(composingKey({ key: "Enter", keyCode: 13, isComposing: false })).toBe(false);
  expect(composingKey({ key: "Escape", keyCode: 27 })).toBe(false);
});

it("选词回车（事后 229）的默认动作该被挡；真回车与真组字态都不挡", () => {
  expect(suppressComposingEnter({ key: "Enter", keyCode: 229, isComposing: false })).toBe(true);
  expect(suppressComposingEnter({ key: "Enter", keyCode: 229 })).toBe(true);
  // 真组字态：默认动作归输入法，不能替他挡（可能打断候选词提交）。
  expect(suppressComposingEnter({ key: "Enter", keyCode: 229, isComposing: true })).toBe(false);
  // 真回车：发送 / 提交交给各表单自己。
  expect(suppressComposingEnter({ key: "Enter", keyCode: 13, isComposing: false })).toBe(false);
  // 其他键的 229（方向键翻候选页等）不动。
  expect(suppressComposingEnter({ key: "ArrowDown", keyCode: 229, isComposing: false })).toBe(false);
});

it("表单守卫只对选词回车 preventDefault，真回车放行", () => {
  const prevented: string[] = [];
  const event = (init: { key: string; keyCode: number; isComposing?: boolean }) => ({
    key: init.key,
    preventDefault: () => prevented.push(init.key),
    nativeEvent: init,
  });
  guardComposingEnter(event({ key: "Enter", keyCode: 229, isComposing: false }));
  expect(prevented).toEqual(["Enter"]);
  guardComposingEnter(event({ key: "Enter", keyCode: 13 }));
  expect(prevented).toEqual(["Enter"]);
  guardComposingEnter(event({ key: "a", keyCode: 229 }));
  expect(prevented).toEqual(["Enter"]);
});
