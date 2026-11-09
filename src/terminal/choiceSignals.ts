/** These are widget anchors, not enough evidence by themselves to submit input. */
export const CHOICE_QUESTION = /\bdo you want to\b|\bwould you like to (?:run|make|grant|send|approve|proceed)\b/i;
export const QUESTION_PAGE = /^(?:Question\s+\d+\/\d+(?:\s+\(\d+ unanswered\))?|\d+ of \d+)$/i;
export const RULE = /^[\s─━═\-╭╮╰╯┌┐└┘]+$/u;
export const CHECKBOX_OPTION = /^(\s*)([❯›▶>]\s*)?\[([ xX✓])\]\s+(.+)$/u;
export const NUMBERED_OPTION = /^(\s*)([❯›▶>]\s*)?(\d+)[.)]\s+(.+)$/u;
export const CONFIRM_TAIL = /^(.*\S.*?)\s*[([]([yY])\s*\/\s*([nN])[)\]]\s*[:：]?\s*$/;

export function cleanChoiceLine(line: string): string {
  return line.replace(/^\s*[│┃|]\s?/u, "").replace(/[│┃|]\s*$/u, "").trimEnd();
}

export function isChoiceFooter(line: string): boolean {
  const text = line.trim();
  if (/⇆\s+select/.test(text) && /enter\s+confirm/.test(text)) return true;
  if (!/^(?:Press\s+)?(?:enter\b|space\b|tab\b|esc\b|f\d+\b|option\s+\d+\/|[↵⌃↑↓⇧←→]|回车|空格|方向键)/iu.test(text)) return false;
  return /(?:\b(?:enter|space|tab|esc|f\d+)\b|[↵⌃↑↓⇧]|回车|空格|方向键)/iu.test(line)
    && /\b(?:submit|confirm|select|toggle|save|cancel|skip|notes|interrupt|navigate|back)\b|确认|提交|选择|切换|取消/iu.test(line);
}

export function hasDefaultSubmit(footer: string): boolean {
  return /\benter\s+(?:to\s+)?(?:submit(?: answer)?|confirm|select|save)\b|↵\s*confirm|回车\s*(?:确认|提交|选择)/iu.test(footer);
}

export function isNormalComposer(line: string): boolean {
  return /\?\s+for shortcuts|^[❯›>]\s*(?:$|Ask Codex to do anything\s*$)/iu.test(line.trim());
}
