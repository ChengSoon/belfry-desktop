import { describe, expect, it } from "vitest";
import { checkVersionRange, comparePluginVersions, parsePluginVersion } from "./version";

describe("private plugin version prototype", () => {
  it.each(["0.0.0", "0.19.0", "65535.65535.65535"])("accepts %s", (value) => {
    expect(value.split(".").map(Number)).toEqual(parsePluginVersion(value));
  });

  it.each([
    "01.0.0", "1.00.0", "1.0.01", "1.0", "1.0.0.0", "-1.0.0",
    "1.0.0-rc.1", "1.0.0+build", " 1.0.0", "1.0.0\n", "65536.0.0",
    "1e2.0.0", "1.0.0".repeat(100), "１.0.0", "1.0.NaN",
  ])("rejects an invalid plugin version: %s", (value) => {
    expect(null).toEqual(parsePluginVersion(value));
  });

  it("compares numerically and distinguishes upgrades, equality and downgrades", () => {
    expect(-1).toEqual(comparePluginVersions("1.9.0", "1.10.0"));
    expect(0).toEqual(comparePluginVersions("1.10.0", "1.10.0"));
    expect(1).toEqual(comparePluginVersions("2.0.0", "1.65535.65535"));
    expect(null).toEqual(comparePluginVersions("bad", "1.0.0"));
  });

  it("uses inclusive lower and exclusive upper bounds", () => {
    expect("compatible").toEqual(checkVersionRange({ host: "0.19.0", min: "0.19.0" }));
    expect("too-old").toEqual(checkVersionRange({ host: "0.18.9", min: "0.19.0" }));
    expect("too-new").toEqual(checkVersionRange({
      host: "1.0.0", min: "0.19.0", maxExclusive: "1.0.0",
    }));
    expect("compatible").toEqual(checkVersionRange({
      host: "0.99.0", min: "0.19.0", maxExclusive: "1.0.0",
    }));
  });
});

describe("private host version compatibility", () => {
  it("compares valid host prereleases by their numeric triple", () => {
    expect("compatible").toEqual(checkVersionRange({
      host: "0.19.0-rc.1+build.7", min: "0.19.0",
    }));
    expect("too-new").toEqual(checkVersionRange({
      host: "1.0.0-beta", min: "0.19.0", maxExclusive: "1.0.0",
    }));
  });

  it.each(["0.19.0-", "0.19.0-01", "0.19.0+", "0.19.0-rc..1", "0.19.0 garbage"])(
    "does not strip malformed host suffixes: %s", (host) => {
      expect("invalid-host").toEqual(checkVersionRange({ host, min: "0.19.0" }));
    },
  );

  it.each([
    { min: "bad" }, { min: "0.19.0", maxExclusive: "bad" },
    { min: "0.19.0", maxExclusive: "0.19.0" },
    { min: "1.0.0", maxExclusive: "0.19.0" },
    { min: "0.19.0-rc.1" },
  ])("rejects invalid bounds before compatibility comparison", (range) => {
    expect("invalid-range").toEqual(checkVersionRange({ host: "0.19.0", ...range }));
  });
});
