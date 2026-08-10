import { describe, expect, it } from "vitest";
import { normalizePath, pathKey, shortPath } from "./path";

describe("normalizePath", () => {
  it("剥掉 Windows verbatim 前缀", () => {
    expect(normalizePath("\\\\?\\D:\\ChengSystem\\Project\\otty")).toBe("D:\\ChengSystem\\Project\\otty");
  });

  it("verbatim UNC 还原成普通 UNC，主机段前保留双反斜杠", () => {
    expect(normalizePath("\\\\?\\UNC\\server\\share")).toBe("\\\\server\\share");
  });

  it("普通路径原样返回", () => {
    expect(normalizePath("D:\\work\\otty")).toBe("D:\\work\\otty");
    expect(normalizePath("/Users/cheng/work")).toBe("/Users/cheng/work");
    expect(normalizePath("\\\\server\\share")).toBe("\\\\server\\share");
  });
});

describe("shortPath", () => {
  it("把两个平台的主目录折叠成 ~", () => {
    expect(shortPath("/Users/cheng/work/otty")).toBe("~/work/otty");
    expect(shortPath("/home/cheng/work/otty")).toBe("~/work/otty");
    expect(shortPath("C:\\Users\\cheng\\work\\otty")).toBe("~\\work\\otty");
  });

  it("带 verbatim 前缀的主目录路径也要能折叠", () => {
    // 这是修复前的实际显示：整条 `\\?\C:\Users\...` 原样铺在标题行上。
    expect(shortPath("\\\\?\\C:\\Users\\cheng\\work\\otty")).toBe("~\\work\\otty");
  });

  it("非主目录路径只去前缀", () => {
    expect(shortPath("\\\\?\\D:\\ChengSystem\\Project\\otty")).toBe("D:\\ChengSystem\\Project\\otty");
  });

  it("空值返回空串", () => {
    expect(shortPath(null)).toBe("");
    expect(shortPath(undefined)).toBe("");
  });
});

describe("pathKey", () => {
  it("同一目录的不同写法归到同一个键", () => {
    const canonical = pathKey("D:\\work\\otty");
    expect(pathKey("d:\\work\\otty")).toBe(canonical);
    expect(pathKey("D:/work/otty")).toBe(canonical);
    expect(pathKey("D:\\work\\otty\\")).toBe(canonical);
    expect(pathKey("\\\\?\\D:\\work\\otty")).toBe(canonical);
  });

  it("不同目录不能撞键", () => {
    expect(pathKey("D:\\work\\otty")).not.toBe(pathKey("D:\\work\\otty-backup"));
    expect(pathKey("C:\\work\\otty")).not.toBe(pathKey("D:\\work\\otty"));
  });

  it("Unix 路径保持大小写敏感", () => {
    expect(pathKey("/Users/cheng/Work")).not.toBe(pathKey("/users/cheng/work"));
  });
});
