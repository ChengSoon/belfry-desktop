import { afterEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Calendar } from "../components/controls/Calendar";
import { FontImportCard } from "../background/components/FontImportCard";
import { setLocalePreference } from "./store";

afterEach(() => setLocalePreference("zh-CN"));
it("renders the complete imported-font sentence with English singular and plural forms", () => {
  setLocalePreference("en");
  const font = { fileName: "font.ttf", displayName: "Font", mime: "font/ttf", byteSize: 100 };
  const render = (count: number) => renderToStaticMarkup(<FontImportCard activeFileName={null} assets={Array.from({ length: count }, () => font)}
    busy={false} error={null} onClear={async () => {}} onPick={async () => {}} />);
  expect(render(1)).toContain("1 font imported");
  expect(render(2)).toContain("2 fonts imported");
});
it("formats the calendar heading in the selected language instead of joining year/month fragments", () => {
  setLocalePreference("en");
  const html = renderToStaticMarkup(<Calendar id="calendar" value="2026-11-08" today="2026-11-08" label="Date" onChange={() => {}} onClose={() => {}} />);
  expect(html).toContain("November 2026");
  expect(html).not.toContain("2026 year");
});
