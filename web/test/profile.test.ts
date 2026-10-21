import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Json, Profile } from "../src/api";
import { layout } from "../src/chart";
import { TEMPLATE, blankLike, getIn, profileError, setIn, withTemplate } from "../src/profile";

const keysDeep = (v: Json, prefix = ""): string[] =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.entries(v).flatMap(([k, x]) => [`${prefix}${k}`, ...keysDeep(x, `${prefix}${k}.`)])
    : [];

describe("profile template", () => {
  it("has exactly the keys of data/profile.example.json (the model reads them by name)", () => {
    const example = JSON.parse(readFileSync(new URL("../../data/profile.example.json", import.meta.url), "utf-8"));
    expect(keysDeep(TEMPLATE).sort()).toEqual(keysDeep(example).sort());
  });

  it("withTemplate fills missing keys and keeps unknown ones", () => {
    const p = withTemplate({ name: { first: "A", last: "B" }, custom: "kept" } as Profile);
    expect(getIn(p, ["name", "first"])).toBe("A");
    expect(getIn(p, ["name", "preferred"])).toBe("");
    expect(getIn(p, ["links", "linkedin"])).toBe("");
    expect(p.custom).toBe("kept");
  });
});

describe("setIn / blankLike / profileError", () => {
  it("sets nested values immutably, through arrays", () => {
    const before = withTemplate({ name: { first: "A", last: "B" } } as Profile);
    const after = setIn(before, ["education", 0, "school"], "CSULB") as Profile;
    expect(getIn(after, ["education", 0, "school"])).toBe("CSULB");
    expect(getIn(before, ["education", 0, "school"])).toBe("");
    expect(after.name).toBe(before.name); // untouched branches are shared
  });

  it("blankLike copies the shape with empty values", () => {
    expect(blankLike({ school: "X", gpa: "4", current: true, tags: ["a"] })).toEqual({ school: "", gpa: "", current: false, tags: [] });
  });

  it("requires a first and last name like the server", () => {
    expect(profileError(TEMPLATE)).toMatch(/first and last/);
    expect(profileError({ name: { first: "A", last: "B" } })).toBeNull();
  });
});

describe("chart layout", () => {
  it("maps 0% to the bottom, 100% to the top, one day to the middle", () => {
    const day = (rate: number, d: string) => ({ day: d, steps: 10, accepted: rate * 10, rate });
    const pts = layout([day(0, "2026-10-20"), day(1, "2026-10-21")], 640, 220);
    expect(pts.map((p) => [p.x, p.y])).toEqual([[28, 192], [612, 28]]);
    expect(layout([day(0.5, "2026-10-20")], 640, 220)[0].x).toBe(320);
  });
});
