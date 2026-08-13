import { describe, expect, it } from "vitest";
import { removeRecentConfirmBody } from "./removeRecentConfirm";

const project = { id: "p0", name: "demo", rootPath: "/demo" };

describe("removeRecentConfirmBody", () => {
  it("mentions open sessions when the directory still has tabs", () => {
    expect(removeRecentConfirmBody(project, 2))
      .toBe("将从最近项目中移除 demo，并关闭该目录下的 2 个会话。目录本身不会被删除。");
  });

  it("omits the session clause when no session is open", () => {
    expect(removeRecentConfirmBody(project, 0))
      .toBe("将从最近项目中移除 demo。目录本身不会被删除。");
  });
});
