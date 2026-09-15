import { expect, it } from "vitest";
import { panelRetryUrl } from "./retryImport";

const baseUrl = "http://tauri.localhost/";
const failed = (url: string) => new TypeError(`Failed to fetch dynamically imported module: ${url}`);

it("retries only the same-origin panel entry, retaining the compiled URL", () => {
  expect(panelRetryUrl(failed("http://tauri.localhost/assets/SettingsPanel-abc.js"), {
    baseUrl, exportName: "SettingsPanel", attempt: 2,
  })).toBe("http://tauri.localhost/assets/SettingsPanel-abc.js?belfryPanelRetry=2");
});

it.each([
  "https://example.test/SettingsPanel.js",
  "https://tauri.localhost/SettingsPanel.js",
  "http://tauri.localhost/assets/SettingsPanel.css",
  "http://tauri.localhost/assets/another-dependency.js",
])("does not import an unrelated or external URL: %s", (url) => {
  expect(panelRetryUrl(failed(url), { baseUrl, exportName: "SettingsPanel", attempt: 2 })).toBeNull();
});

it("does not turn rendering failures into URL requests", () => {
  expect(panelRetryUrl(new Error("render failed"), { baseUrl, attempt: 2 })).toBeNull();
});

it("recovers failed same-origin CSS separately from JavaScript modules", () => {
  const error = new Error("Unable to preload CSS for http://tauri.localhost/assets/SettingsPanel-abc.css");
  expect(panelRetryUrl(error, { baseUrl, attempt: 2, exportName: "SettingsPanel", resource: "style" }))
    .toBe("http://tauri.localhost/assets/SettingsPanel-abc.css?belfryPanelRetry=2");
  expect(panelRetryUrl(error, { baseUrl, attempt: 2 })).toBeNull();
});

it("recovers a shared stylesheet without importing an unrelated JavaScript entry", () => {
  const error = new Error("Unable to preload CSS for http://tauri.localhost/assets/shared-abc.css");
  expect(panelRetryUrl(error, { baseUrl, attempt: 2, exportName: "SettingsPanel", resource: "style" }))
    .toBe("http://tauri.localhost/assets/shared-abc.css?belfryPanelRetry=2");
});
