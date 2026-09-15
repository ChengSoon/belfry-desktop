import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

export async function capturePanel(view, name) {
  const directory = process.env.BELFRY_PANEL_ARTIFACTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const { data } = await view.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(directory, `${name}.png`), Buffer.from(data, "base64"));
}
