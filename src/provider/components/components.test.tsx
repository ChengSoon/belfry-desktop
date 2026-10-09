import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProviderCard } from "./ProviderCard";
import { ProviderOfficial } from "./ProviderOfficial";
import { ProviderForm } from "./ProviderForm";
import { ProviderConfigEditor } from "./ProviderConfigEditor";
import { ModelInput } from "./ProviderModelField";
import { EMPTY_DRAFT } from "../contracts";

const noop = () => {};
const card = { label: "团队服务", endpoint: "https://example.invalid/v1", model: "test-model", hasApiKey: true, onSelect: noop, onEdit: noop, onRemove: noop };

it("服务卡片只展示密钥配置状态，分别提供编辑和显式启用入口", () => {
  const html = renderToStaticMarkup(<ProviderCard {...card} active={false} busy={false} />);
  expect(html).toContain("已配置密钥");
  expect(renderToStaticMarkup(<ProviderCard {...card} hasApiKey={false} active={false} busy={false} />)).toContain("未配置密钥");
  expect(html).toContain(card.endpoint);
  expect(html).toContain(card.model);
  expect(html).toContain('aria-label="启用 团队服务"');
  expect(html).toContain('aria-label="删除 团队服务"');
  expect(html).toContain("编辑");
});

it("已选用的服务不提供重复启用入口，操作进行中禁用修改动作", () => {
  const active = renderToStaticMarkup(<ProviderCard {...card} active busy={false} />);
  expect(active).toContain("已选用");
  expect(active).not.toContain('aria-label="启用 团队服务"');
  const busy = renderToStaticMarkup(<ProviderCard {...card} active={false} busy />);
  expect(busy.match(/disabled=""/g)).toHaveLength(3);
});

it("表单默认隐藏密钥，错误关联到对应输入框", () => {
  const html = renderToStaticMarkup(<ProviderForm kind="claude" busy={false} draft={EMPTY_DRAFT}
    issue={{field:"baseUrl",message:"请输入有效地址"}} onCancel={noop} onChange={noop} onSubmit={noop} />);
  expect(html).toContain('type="password"');
  expect(html).toContain('aria-label="显示 API Key"');
  expect(html).toContain('aria-invalid="true" aria-describedby="provider-baseUrl-hint"');
  expect(html).toContain('id="provider-baseUrl-hint" class="provider-form__issue" role="alert"');
});

it("保存期间锁定所有表单字段，防止保存旧值后丢失继续输入的内容", () => {
  const html = renderToStaticMarkup(<ProviderForm kind="claude" busy draft={EMPTY_DRAFT}
    issue={null} onCancel={noop} onChange={noop} onSubmit={noop} />);
  expect(html.match(/<fieldset disabled="">/g)).toHaveLength(2);
  expect(html).toContain("保存中…");
});

it("官方登录独立展示，加载时不能切回，选中后不提供重复操作", () => {
  const busy = renderToStaticMarkup(<ProviderOfficial active={false} busy onSelect={noop} />);
  expect(busy).toContain('disabled=""');
  expect(busy).toContain("切回官方");
  const active = renderToStaticMarkup(<ProviderOfficial active busy={false} onSelect={noop} />);
  expect(active).toContain("已选用");
  expect(active).not.toContain("<button");
});

it("删除操作默认收起在更多操作中", () => {
  const html = renderToStaticMarkup(<ProviderCard {...card} active={false} busy={false} />);
  expect(html).toContain('<details class="provider-card__more">');
  expect(html).toContain('aria-label="团队服务 的更多操作"');
  expect(html).not.toContain('<details open');
});

it("模型获取不提交表单，未填写端点时禁止请求，手动模型输入始终保留", () => {
  const empty = renderToStaticMarkup(<ProviderForm kind="claude" busy={false} draft={EMPTY_DRAFT}
    issue={null} onCancel={noop} onChange={noop} onSubmit={noop} />);
  expect(empty).toContain('<button type="button" disabled="">');
  expect(empty).toContain('id="provider-model"');
  expect(empty).toContain("获取模型");
  const ready = renderToStaticMarkup(<ProviderForm kind="codex" busy={false}
    draft={{ ...EMPTY_DRAFT, baseUrl: "https://example.invalid/v1", model: "custom-model" }}
    issue={null} onCancel={noop} onChange={noop} onSubmit={noop} />);
  expect(ready).toContain('value="custom-model"');
  expect(ready).not.toContain('<button type="button" disabled="">');
});

it("获取模型后原位置使用自定义可输入选择框，不生成原生下拉框", () => {
  const html = renderToStaticMarkup(<ModelInput models={["model-a", "model-b"]} value="custom-model" busy={false} onChange={noop} />);
  expect(html).toContain('role="combobox"');
  expect(html).toContain('value="custom-model"');
  expect(html).toContain('aria-autocomplete="list"');
  expect(html).not.toContain("<select");
  expect(html.match(/<input /g)).toHaveLength(1);
});

it("原始配置必须显式查看，未授权时即使收到原文或错误也不渲染", () => {
  const props = { kind: "claude" as const, draft: EMPTY_DRAFT, hasApiKey: true,
    files: [{ path: "/cli/config.json", format: "json" as const, content: "external-cli-secret" }],
    loading: false, failure: "sensitive-preview-error", edits: {}, dirtyPaths: new Set<string>(),
    savingPath: null, saveFailure: "sensitive-save-error", savedPath: null, copiedPath: null,
    onReload: noop, onChange: noop, onCopy: noop, onSave: noop, onRevert: noop, onRevealSecrets: noop };
  const hidden = renderToStaticMarkup(<ProviderConfigEditor {...props} revealSecrets={false} />);
  expect(hidden).toContain("查看含密钥的原始配置");
  expect(hidden).toContain("外部 CLI 的完整密钥");
  expect(hidden).toContain("剪贴板");
  expect(hidden).not.toContain("external-cli-secret");
  expect(hidden).not.toContain("sensitive-preview-error");
  expect(hidden).not.toContain("sensitive-save-error");
  expect(hidden).not.toContain("textarea");
  const revealed = renderToStaticMarkup(<ProviderConfigEditor {...props} revealSecrets />);
  expect(revealed).toContain("external-cli-secret");
  expect(revealed).toContain("textarea");
  expect(revealed).toContain("复制");
});

it("密钥操作显式提供保留、替换、清除，并说明存储边界", () => {
  const html = renderToStaticMarkup(<ProviderForm kind="claude" busy={false}
    draft={{ ...EMPTY_DRAFT, id: "saved", apiKeyAction: "keep" }} hasApiKey
    issue={null} onCancel={noop} onChange={noop} onSubmit={noop} />);
  expect(html).toContain('<option value="keep" selected="">保留现有密钥</option>');
  expect(html).toContain('<option value="replace">替换密钥</option>');
  expect(html).toContain('<option value="clear">清除密钥（无需认证）</option>');
  expect(html).toContain("已配置密钥");
  expect(html).toContain("系统凭据存储保护");
  expect(html).toContain("外部 CLI 配置仍可能以明文");
});

it("服务卡片仅展示密钥配置状态，不引入额外 Graphite 作用域文案", () => {
  const configured = renderToStaticMarkup(<ProviderCard {...card} active={false} busy={false} />);
  expect(configured).toContain("已配置密钥");
  expect(configured).not.toContain("全局 · 自定义");
  expect(configured).not.toContain("连接未验证");
  const selected = renderToStaticMarkup(<ProviderCard {...card} hasApiKey={false} active busy={false} />);
  expect(selected).toContain("未配置密钥");
  expect(selected).toContain("已选用");
  const official = renderToStaticMarkup(<ProviderOfficial active busy={false} onSelect={noop} />);
  expect(official).toContain("官方登录");
  expect(official).not.toContain("全局 · CLI 登录");
});
