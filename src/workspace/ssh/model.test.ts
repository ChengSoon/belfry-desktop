import { describe, expect, it } from "vitest";
import { parseHostCatalog, parseRemotePath, saveHost } from "./model";

const host = { id: "qa", name: "开发", group: "测试", target: { host: "jump-alias", user: null, port: null, remotePath: "/项目/with space" } };

describe("SSH 主机档案", () => {
  it("保留远端路径与分组，只输出允许的非敏感字段", () => {
    const raw = JSON.stringify({ version: 1, entries: [{ ...host, password: "private", target: { ...host.target, password: "private" } }] });
    const result = parseHostCatalog(raw);
    expect(result.entries).toEqual([host]);
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("按身份更新同一档案，不混入其他主机", () => {
    const other = { ...host, id: "other", target: { ...host.target, host: "second" } };
    const result = saveHost({ version: 1, entries: [host, other] }, { ...host, group: "生产" });
    expect(result.entries.map((item) => item.group)).toEqual(["生产", "测试"]);
  });
  it("拒绝损坏、新版本、重复身份和不安全 SSH 目标", () => {
    for (const value of ["{", '{"version":2,"entries":[]}', JSON.stringify({ version: 1, entries: [host, host] }),
      JSON.stringify({ version: 1, entries: [{ ...host, target: { ...host.target, host: "-oProxyCommand=x" } }] })]) {
      expect(() => parseHostCatalog(value)).toThrow();
    }
  });
  it("中文、空格与单引号路径保持原文，只接受绝对 POSIX 路径", () => {
    expect(parseRemotePath("/项目/John's folder")).toBe("/项目/John's folder");
    expect(parseRemotePath("")).toBeNull();
    for (const path of ["relative", "~/work", "C:\\work", "/work\nnext", "/work\0x"]) expect(() => parseRemotePath(path)).toThrow();
  });
});
