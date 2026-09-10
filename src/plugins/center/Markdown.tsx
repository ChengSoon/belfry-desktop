// Uses PI-Desktop's react-markdown / remark-gfm rendering stack.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { centerApi } from "./api";
import { pluginNotice } from "../PluginRuntimeBridge";

const components: Components = {
  a: ({ href, children }) => href && /^https?:\/\//i.test(href)
    ? <a href={href} rel="noopener noreferrer" onClick={(event) => {
      event.preventDefault(); void centerApi.openExternal(href).catch((error) => pluginNotice(String(error)));
    }}>{children}</a> : <span>{children}</span>,
  img: ({ src, alt }) => typeof src === "string" && /^https:\/\//i.test(src)
    ? <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" /> : <span>{alt}</span>,
  table: ({ children }) => <div className="plugins-readme-table"><table>{children}</table></div>,
};
export function Markdown({ source }: { source: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{source}</ReactMarkdown>;
}
