import { describe, expect, it } from "vitest";
import { diffContributions } from "./differences";
import { directoryFixture } from "./testing/fixtures";

describe("private contribution differences", () => {
  it("distinguishes additions, removals and changed contents", () => {
    expect({ added: ["new"], removed: ["old"], changed: ["same"] }).toEqual(diffContributions({
      before: [{ id: "old", text: "old" }, { id: "same", text: "before" }],
      after: [{ id: "same", text: "after" }, { id: "new", text: "new" }],
    }));
  });

  it("ignores object key order but preserves meaningful step order and whitespace", () => {
    const template = directoryFixture().templates[0];
    const reordered = { steps: template.steps, description: template.description,
      name: template.name, id: template.id };
    expect([]).toEqual(diffContributions({ before: [template], after: [reordered] }).changed);
    const steps = [{ id: "a", text: "first" }, { id: "b", text: "second" }];
    expect(["review"]).toEqual(diffContributions({
      before: [{ ...template, steps }], after: [{ ...template, steps: [...steps].reverse() }],
    }).changed);
    expect(["review"]).toEqual(diffContributions({
      before: [template], after: [{ ...template, steps: [{ id: "inspect", text: " changed " }] }],
    }).changed);
  });

  it("reports changed action targets and keywords", () => {
    const action = directoryFixture().actions[0];
    expect(["open-review"]).toEqual(diffContributions({
      before: [action], after: [{ ...action, templateId: "other" }],
    }).changed);
    expect(["open-review"]).toEqual(diffContributions({
      before: [action], after: [{ ...action, keywords: ["audit"] }],
    }).changed);
  });

  it("does not treat contribution ordering as a content change", () => {
    const before = [{ id: "a", text: "a" }, { id: "b", text: "b" }];
    expect({ added: [], removed: [], changed: [] }).toEqual(diffContributions({
      before, after: [...before].reverse(),
    }));
    expect(["a", "b"]).toEqual(before.map((entry) => entry.id));
  });

  it("rejects ambiguous identity in either snapshot", () => {
    const entries = [{ id: "a" }, { id: "a" }];
    expect(() => diffContributions({ before: entries, after: [] })).toThrow();
    expect(() => diffContributions({ before: [], after: entries })).toThrow();
  });
});
