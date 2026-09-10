// Electron 的原生 IPC 不受 connect-src 约束；HTTP 桥只开放宿主同源连接。
export function panelHtml(bytes, bridgeUrl) {
  const html = bytes.toString("utf8").replace(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => {
    if (!/http-equiv\s*=\s*["']?Content-Security-Policy(?:["'\s>])/i.test(tag)) return tag;
    return tag.replace(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i, (_match, _quote, policy) => {
      const directives = policy.split(";").map((value) => value.trim()).filter((value) => value && !/^connect-src\b/i.test(value));
      directives.push("connect-src 'self'");
      return `content="${directives.join("; ").replaceAll('"', "&quot;")}"`;
    });
  });
  const script = `<script src="${bridgeUrl}"></script>`;
  return /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, (tag) => tag + script) : script + html;
}
