import { useEffect, useRef, type ReactNode } from "react";

const KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "class", "const", "continue", "def", "else",
  "enum", "export", "extends", "fn", "for", "from", "function", "if", "impl", "import",
  "in", "interface", "let", "match", "mod", "new", "pub", "return", "struct", "switch",
  "trait", "try", "type", "use", "var", "where", "while", "with", "yield",
]);

const TOKEN_PATTERN = /(\/\/.*|\/\*[\s\S]*?\*\/|#.*|<!--.*?-->|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;

export function HighlightedCode({ content, focusLine = null, language }: { content: string; focusLine?: number | null; language: string | null }) {
  const codeRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!focusLine) return;
    const frame = window.requestAnimationFrame(() => {
      codeRef.current?.querySelector(`[data-line="${focusLine}"]`)
        ?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [content, focusLine]);

  return (
    <ol className={`file-preview__code file-preview__code--${language ?? "text"}`} ref={codeRef}>
      {content.split("\n").map((line, index) => (
        <li className={focusLine === index + 1 ? "is-focused" : undefined} data-line={index + 1} key={`${index}-${line.slice(0, 8)}`}>
          <code>{highlightLine(line)}</code>
        </li>
      ))}
    </ol>
  );
}

function highlightLine(line: string): ReactNode[] {
  const result: ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > cursor) result.push(line.slice(cursor, start));
    result.push(<span className={tokenClass(token)} key={`${start}-${token}`}>{token}</span>);
    cursor = start + token.length;
  }
  if (cursor < line.length) result.push(line.slice(cursor));
  return result;
}

export function tokenClass(token: string) {
  if (token.startsWith("//") || token.startsWith("/*") || token.startsWith("#") || token.startsWith("<!--")) {
    return "token-comment";
  }
  if (/^["'`]/u.test(token)) return "token-string";
  if (/^\d/u.test(token)) return "token-number";
  if (KEYWORDS.has(token)) return "token-keyword";
  if (/^[A-Z][A-Za-z\d_$]*$/u.test(token)) return "token-type";
  return "token-name";
}
