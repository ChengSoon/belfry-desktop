import { apiError } from "./errors.mjs";

const ALT_MODIFIER = 1, SHORTCUT_MODIFIERS = 2 | 4;
const ENTER_SHORTCUT_MODIFIERS = ALT_MODIFIER | SHORTCUT_MODIFIERS;
const STANDARD_KEY_LOCATIONS = new Set([0, 1, 2]), NUMPAD_LOCATION = 3;
const MAX_KEY_CODE = 255, MAX_KEY_TEXT = 8;

export async function browserInput(target, input) {
  if (["text", "paste"].includes(input?.kind)) {
    if (typeof input.text !== "string" || input.text.length > 64 * 1024) throw apiError("INVALID_ARGUMENT", "输入文本无效或超额");
    if (input.kind === "paste") { await target.process.clipboard.paste(target, input.text); return null; }
    await target.send("Input.insertText", { text: input.text }); return null;
  }
  if (input?.kind === "key") return keyInput(target, input);
  return pointerInput(target, input);
}
async function keyInput(target, input) {
  if (!["keyDown", "keyUp"].includes(input.type) || typeof input.key !== "string" || input.key.length > 64) throw apiError("INVALID_ARGUMENT", "键盘事件无效");
  const commands = editingCommands(input);
  const dispatch = () => target.send("Input.dispatchKeyEvent", { type: input.type, key: input.key, commands,
    ...keyDetails(input), ...keyText(input) });
  if (target.options.writeClipboard && commands.some((command) => ["copy", "cut"].includes(command))) {
    await target.process.clipboard.copy(target, dispatch);
  } else await dispatch();
  return null;
}
function keyDetails(input) {
  return { code: typeof input.code === "string" ? input.code.slice(0, 64) : "", modifiers: Number(input.modifiers) & 15,
    windowsVirtualKeyCode: Math.max(0, Math.min(MAX_KEY_CODE, Number(input.keyCode) || 0)),
    autoRepeat: input.type === "keyDown" && input.repeat === true,
    location: STANDARD_KEY_LOCATIONS.has(input.location) ? input.location : 0,
    isKeypad: input.location === NUMPAD_LOCATION };
}
function keyText(input) {
  if (input.type !== "keyDown") return {};
  if (typeof input.text === "string") return { text: input.text.slice(0, MAX_KEY_TEXT) };
  // Chromium 通过字符事件执行表单提交和换行；仍由网页的 keydown 处理器决定是否取消。
  if (input.key === "Enter" && !(input.modifiers & ENTER_SHORTCUT_MODIFIERS)) return { text: "\r" };
  return optionText(input);
}
function optionText(input) {
  const option = process.platform === "darwin" && (input.modifiers & ALT_MODIFIER) && !(input.modifiers & SHORTCUT_MODIFIERS);
  return option && Array.from(input.key).length === 1 ? { text: input.key } : {};
}
function editingCommands(input) {
  const primary = 2 | 4, shift = 8, alt = 1;
  if (input.type !== "keyDown" || !(input.modifiers & primary) || input.modifiers & alt) return [];
  const commands = { a: "selectAll", c: "copy", x: "cut", v: "paste", y: "redo", z: input.modifiers & shift ? "redo" : "undo" };
  const command = commands[input.key.toLowerCase()];
  return command ? [command] : [];
}
async function pointerInput(target, input) {
  if (!["mouseMoved", "mousePressed", "mouseReleased", "mouseWheel"].includes(input?.type)
    || ![input.x, input.y].every(Number.isFinite)) throw apiError("INVALID_ARGUMENT", "指针事件无效");
  await target.send("Input.dispatchMouseEvent", { type: input.type, x: Math.max(0, Math.min(target.viewport.width, input.x)),
    y: Math.max(0, Math.min(target.viewport.height, input.y)), button: ["left", "middle", "right"].includes(input.button) ? input.button : "none",
    clickCount: Math.max(0, Math.min(3, Number(input.clickCount) || 0)), modifiers: Number(input.modifiers) & 15,
    ...(input.type === "mouseWheel" ? { deltaX: Math.max(-10_000, Math.min(10_000, Number(input.deltaX) || 0)),
      deltaY: Math.max(-10_000, Math.min(10_000, Number(input.deltaY) || 0)) } : {}) });
  return null;
}
