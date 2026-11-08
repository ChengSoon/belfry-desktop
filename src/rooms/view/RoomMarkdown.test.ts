import { describe, expect, it } from "vitest";
import { linkFilePaths } from "./RoomMarkdown";

describe("linkFilePaths", () => {
  it("turns paths into file links and keeps the line number", () => {
    expect(linkFilePaths("改了 src/a.ts:42")).toBe("改了 [src/a.ts:42](belfry-file:src%2Fa.ts#L42)");
    expect(linkFilePaths("见 README.md")).toBe("见 [README.md](belfry-file:README.md)");
    expect(linkFilePaths("见 pkg/__init__.py"), "下划线转义，不变粗体").toBe("见 [pkg/\\_\\_init\\_\\_.py](belfry-file:pkg%2F__init__.py)");
  });

  it("leaves code, links and urls alone", () => {
    expect(linkFilePaths("```\nsrc/a.ts\n```")).toBe("```\nsrc/a.ts\n```");
    expect(linkFilePaths("`src/a.ts`")).toBe("`src/a.ts`");
    expect(linkFilePaths("[说明](src/a.ts)")).toBe("[说明](src/a.ts)");
    expect(linkFilePaths("https://x.com/a.md")).toBe("https://x.com/a.md");
  });
});
