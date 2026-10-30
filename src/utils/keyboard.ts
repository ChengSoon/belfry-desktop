/**
 * 事件的按键形状：DOM KeyboardEvent 与 React 合成事件的 nativeEvent 都满足。
 */
interface ComposingKeyEvent {
  isComposing?: boolean;
  keyCode?: number;
  key?: string;
}

/**
 * 这一下按键是否属于输入法组字：正在组字，或是输入法消费的按键。
 *
 * 不能只查 isComposing：macOS WKWebView（Tauri 的宿主）上按回车「选词确认」时，
 * compositionend 先于 keydown 派发（WebKit bug 165004），事件到达处理器时
 * isComposing 已是 false，只有 keyCode === 229（VK_PROCESS）能认出这一下不是真回车。
 * 漏认的后果：中文打字按回车选词，消息 / 名字就被半截发了出去。
 */
export function composingKey(event: ComposingKeyEvent) {
  return event.isComposing === true || event.keyCode === 229 || event.key === "Process";
}

/**
 * WebKit bug 165004 的「事后 229」形状（compositionend 已先行，isComposing 为 false）：
 * 候选词其实已经确认，这一下回车的默认动作——多补一个换行、触发表单隐式提交——都不该发生，
 * 该由调用方 preventDefault 挡掉。真正组字态（isComposing 为 true）不动：那时默认动作归
 * 输入法，preventDefault 反而可能打断候选词提交。
 */
export function suppressComposingEnter(event: ComposingKeyEvent) {
  return event.key === "Enter" && event.keyCode === 229 && event.isComposing !== true;
}

/** 表单层守卫：挡住选词回车的隐式提交；真回车照常提交（由表单自己的提交逻辑处理）。 */
export function guardComposingEnter(event: { key: string; preventDefault: () => void; nativeEvent: ComposingKeyEvent }) {
  if (suppressComposingEnter(event.nativeEvent)) event.preventDefault();
}
