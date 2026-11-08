import { t, useTranslation } from "../../i18n";
import { FileCode } from "lucide-react";
import { memo, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/utils";
import { openExternal } from "../../utils/openExternal";
import { FILE_PATH, projectFile } from "../model";

/**
 * 消息正文按 Markdown 渲染（react-markdown + GFM：代码块、列表、表格、链接）。
 *
 * - 正文里的文件路径变成可点的链接，点开在文件预览里看；项目外的路径不给点。
 * - 不渲染 HTML，不加载远程图片：消息来自 Agent，不能让它往界面里塞东西。
 * - 链接只开 http/https，走系统浏览器。
 */

const FILE_SCHEME = "belfry-file:";

/** 不在代码里的文字才找路径：代码块、行内代码原样保留（行内代码整段是路径时另外处理）。 */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

export function linkFilePaths(text: string): string {
  return text.split(CODE).map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(FILE_PATH, (match, path: string, line: string | undefined, offset: number) => {
      // 已经写在 Markdown 链接里的（`[说明](src/a.ts)`、`[src/a.ts](...)`）不再包一层。
      const before = part.slice(Math.max(0, offset - 2), offset);
      if (before.endsWith("](") || before.endsWith("[")) return match;
      const href = `${FILE_SCHEME}${encodeURIComponent(path)}${line ? `#L${line}` : ""}`;
      // 链接文字不套反引号：套了会再被行内代码那条规则认成路径，包出第二个链接。
      // 转义 Markdown 符号，`__init__.py` 这种文件名不会变成粗体。
      return `[${match.replace(/[\\`*_[\]]/g, "\\$&")}](${href})`;
    });
  }).join("");
}

function parseFileHref(href: string): { raw: string; line: number | null } | null {
  if (!href.startsWith(FILE_SCHEME)) return null;
  const [encoded, hash] = href.slice(FILE_SCHEME.length).split("#");
  try {
    return { raw: decodeURIComponent(encoded), line: hash?.startsWith("L") ? Number(hash.slice(1)) || null : null };
  } catch {
    return null;
  }
}

function FileLink({ projectRoot, raw, line, onOpenFile, children }: {
  projectRoot: string; raw: string; line: number | null; onOpenFile?: (path: string, line: number | null) => void; children: ReactNode;
}) {
  useTranslation();
  const file = projectFile(projectRoot, raw, line);
  if (!file || !onOpenFile) return <>{children}</>;
  return (
    <button className="room-md-file inline-flex items-baseline gap-0.5 align-baseline font-mono text-[0.9em] text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
      onClick={() => onOpenFile(file.path, file.line)} title={t("rooms.RoomMarkdown.text_cd3f87b471", { path: file.path, status: file.line ? `:${file.line}` : "" })} type="button">
      <FileCode className="size-3 shrink-0 translate-y-0.5" />
      {children}
    </button>
  );
}

export const RoomMarkdown = memo(function RoomMarkdown({ text, projectRoot, onOpenFile, className }: {
  text: string; projectRoot: string; onOpenFile?: (path: string, line: number | null) => void; className?: string;
}) {
  useTranslation();
  const components: Components = {
    a: ({ href, children }) => {
      const file = href ? parseFileHref(href) : null;
      if (file) return <FileLink line={file.line} onOpenFile={onOpenFile} projectRoot={projectRoot} raw={file.raw}>{children}</FileLink>;
      if (href && /^https?:\/\//i.test(href)) {
        return (
          <a className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary" href={href}
            onClick={(event) => { event.preventDefault(); void openExternal(href); }} rel="noopener noreferrer" title={href}>
            {children}
          </a>
        );
      }
      return <span>{children}</span>;
    },
    // 不加载远程图片：只留替代文字。附件里的图片走附件卡片。
    img: ({ alt }) => <span className="text-muted-foreground">{alt ? t("rooms.markdown.imageAlt", { alt }) : t("rooms.markdown.image")}</span>,
    code: ({ className: language, children }) => {
      const value = String(children ?? "");
      const block = Boolean(language) || value.includes("\n");
      if (block) return <code className={cn("font-mono text-xs", language)}>{children}</code>;
      // 行内代码整段是一个路径（`src/a.ts:12`）：也给点。
      const match = /^(.+?)(?::(\d+))?$/.exec(value.trim());
      const linked = match && new RegExp(`^(?:${FILE_PATH.source})$`).test(value.trim());
      const inline = <code className="rounded-sm bg-muted px-1 py-px font-mono text-[0.85em]">{children}</code>;
      return linked && match
        ? <FileLink line={match[2] ? Number(match[2]) : null} onOpenFile={onOpenFile} projectRoot={projectRoot} raw={match[1]}>{inline}</FileLink>
        : inline;
    },
    pre: ({ children }) => (
      <pre className="my-1.5 max-h-80 overflow-auto rounded-md border border-border bg-background px-3 py-2 leading-relaxed">{children}</pre>
    ),
    p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
    li: ({ children }) => <li className="pl-0.5">{children}</li>,
    blockquote: ({ children }) => <blockquote className="my-1 border-l-2 border-border pl-2.5 text-muted-foreground">{children}</blockquote>,
    h1: ({ children }) => <p className="mt-2 mb-1 font-semibold first:mt-0">{children}</p>,
    h2: ({ children }) => <p className="mt-2 mb-1 font-semibold first:mt-0">{children}</p>,
    h3: ({ children }) => <p className="mt-2 mb-1 font-semibold first:mt-0">{children}</p>,
    hr: () => <hr className="my-2 border-border" />,
    table: ({ children }) => (
      <div className="my-1.5 overflow-x-auto"><table className="border-collapse text-xs">{children}</table></div>
    ),
    th: ({ children }) => <th className="border border-border bg-muted px-2 py-1 text-left font-medium">{children}</th>,
    td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
    input: ({ checked }) => <input checked={!!checked} className="mr-1 align-middle" disabled type="checkbox" />,
  };
  return (
    <div className={cn("room-md leading-relaxed break-words", className)}>
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]} skipHtml
        urlTransform={(url) => (url.startsWith(FILE_SCHEME) ? url : defaultUrlTransform(url))}>
        {linkFilePaths(text)}
      </ReactMarkdown>
    </div>
  );
});
