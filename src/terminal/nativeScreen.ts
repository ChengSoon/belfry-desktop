import type { AgentKind } from "../agent/contracts";

function lastLine(lines: string[], matches: (line: string) => boolean): number {
  for (let at = lines.length - 1; at >= 0; at--) if (matches(lines[at])) return at;
  return -1;
}

/** Verified against OpenCode 2.2 and Kimi Code 2.5. Unknown layouts stay unconfirmed. */
export function nativeComposerEmpty(tail: string, agent: AgentKind): boolean {
  const lines = tail.split("\n").map(line => line.trim());
  if (agent === "kimi") {
    const bottom = lastLine(lines, line => /^╰─+╯$/.test(line));
    if (bottom < 2 || !lines.slice(bottom + 1).some(line => /^context:\s*\d+%/.test(line))) return false;
    let top = bottom - 1;
    while (top >= 0 && !/^╭─+╮$/.test(lines[top])) top--;
    const content = lines.slice(top + 1, bottom);
    return top >= 0 && content.length > 0 && /^│\s*>\s*│$/.test(content[0])
      && content.slice(1).every(line => /^│\s*│$/.test(line));
  }
  if (agent === "opencode") {
    const bottom = lastLine(lines, line => /^╹▀+$/.test(line));
    if (bottom < 3 || !lines.slice(bottom + 1).some(line => /ctrl\+p\s+commands/i.test(line))) return false;
    let top = bottom - 1;
    while (top >= 0 && lines[top].startsWith("┃")) top--;
    const content = lines.slice(top + 1, bottom).map(line => line.slice(1).trim());
    // The last row names the active agent and model. All editor rows must be empty.
    return content.length >= 3 && /\S\s+·\s+\S/.test(content.at(-1) ?? "")
      && content.slice(0, -1).every(line => line === "");
  }
  return false;
}

export function nativeTalking(tail: string, agent?: AgentKind | null): boolean {
  if (agent === "opencode") return /(?:^|\s)esc\s+interrupt(?:\s|$)/im.test(tail);
  if (agent === "kimi" && nativeComposerEmpty(tail, agent)) {
    // “thinking” in Kimi's model footer is a capability, not an activity signal.
    return /^\s*[🌑🌒🌓🌔🌕🌖🌗🌘⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏](?:\s+.*)?$/mu.test(tail);
  }
  return false;
}
