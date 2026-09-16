import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProviderCard } from "./ProviderCard";
import { ProviderOfficial } from "./ProviderOfficial";
import { ProviderForm } from "./ProviderForm";
import { ModelInput } from "./ProviderModelField";
import { EMPTY_DRAFT } from "../contracts";

const noop = () => {};
const card = { label: "团队服务", endpoint: "https://example.invalid/v1", model: "test-model", apiKey: "sk-test-never-display-the-full-key", onSelect: noop, onEdit: noop, onRemove: noop };

it("服务卡片隐藏完整密钥，分别提供编辑和显式启用入口", () => {
  const html = renderToStaticMarkup(<ProviderCard {...card} active={false} busy={false} />);
  expect(html).not.toContain(card.apiKey);
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
