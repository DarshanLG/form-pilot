import { describe, expect, it } from "vitest";
import { actionError, autoAcceptable, historyEntry, nextMark, platformOf, radioSiblings, resolveFinal } from "../src/lib/steps";
import type { Proposal } from "../src/lib/types";

const p = (over: Partial<Proposal> = {}): Proposal => ({
  action: "type",
  mark: 3,
  value: "Jane",
  fallback: false,
  attempts: 1,
  latency_ms: 900,
  ...over,
});

describe("step rules", () => {
  it("history entries match the training format", () => {
    expect(historyEntry({ action: "click", mark: 4, value: null, thought: "x" })).toEqual({ action: "click", mark: 4 });
    expect(historyEntry({ action: "done", mark: null, value: null })).toEqual({ action: "done" });
  });

  it("nextMark is the first unhandled mark", () => {
    expect(nextMark([{ action: "type", mark: 1 }, { action: "skip", mark: 3 }], [1, 2, 3, 4])).toBe(2);
    expect(nextMark([{ action: "type", mark: 1 }], [1])).toBeNull();
  });

  it("resolveFinal mirrors the server", () => {
    expect(resolveFinal(p(), "accepted")).toEqual({ action: "type", mark: 3, value: "Jane" });
    expect(resolveFinal(p(), "overridden")).toEqual({ action: "skip", mark: 3, value: null });
    expect(resolveFinal(p(), "edited", { action: "type", mark: 3, value: "J" })).toMatchObject({ value: "J" });
    expect(() => resolveFinal(p(), "edited")).toThrow();
  });

  it("auto-accept stops at done, fallbacks and repeated marks", () => {
    expect(autoAcceptable(p(), [])).toBe(true);
    expect(autoAcceptable(p({ action: "done", mark: null }), [])).toBe(false);
    expect(autoAcceptable(p({ fallback: true }), [])).toBe(false);
    expect(autoAcceptable(p(), [{ action: "type", mark: 3 }])).toBe(false);
  });

  it("a clicked radio answers its unhandled siblings; checkboxes and other groups stay open", () => {
    const f = (mark: number, type: string, name: string) => ({ mark, type, name, tag: "input", label: "", group: "", options: [], bbox: [0, 0, 0, 0] as [number, number, number, number] });
    const fields = [f(9, "radio", "deg"), f(10, "radio", "deg"), f(11, "radio", "deg"), f(12, "radio", "ft"), f(13, "checkbox", "pron"), f(14, "checkbox", "pron")];
    expect(radioSiblings(fields, { action: "click", mark: 10, value: null }, [{ action: "skip", mark: 9 }])).toEqual([11]);
    expect(radioSiblings(fields, { action: "skip", mark: 9, value: null }, [])).toEqual([]);
    expect(radioSiblings(fields, { action: "click", mark: 13, value: null }, [])).toEqual([]);
  });

  it("actionError and platformOf", () => {
    expect(actionError({ action: "select", mark: 2, value: " " })).toMatch(/needs a value/);
    expect(actionError({ action: "upload", mark: 2, value: "photo" })).toMatch(/resume/);
    expect(actionError({ action: "click", mark: 2, value: null })).toBeNull();
    expect(platformOf("https://jobs.lever.co/acme/123/apply")).toBe("lever");
    expect(platformOf("https://job-boards.greenhouse.io/acme/jobs/1")).toBe("greenhouse");
  });
});
