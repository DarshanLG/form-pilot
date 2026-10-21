// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, findSubmit, matchOption } from "../src/lib/exec";
import { collectFields, drawMarks, focusMark } from "../src/lib/fields";

const FORM = `
<form>
  <label for="first">First name ✱</label><input id="first" name="first">
  <input type="hidden" name="token">
  <div class="field"><label>Resume/CV</label><div><input type="file" id="resume"></div></div>
  <select id="country" aria-label="Country"><option value="">Select…</option><option value="us">United States</option><option value="ca">Canada</option></select>
  <fieldset><legend>Are you authorized to work in the US?</legend>
    <label><input type="radio" name="auth" value="yes"> Yes</label>
    <label><input type="radio" name="auth" value="no"> No</label>
  </fieldset>
  <textarea aria-label="Cover letter"></textarea>
  <input aria-hidden="true" name="shadow">
  <button type="submit">Submit application</button>
</form>`;

// jsdom lacks CSS.escape (Chrome has it); ids in these fixtures need no escaping.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };

const visible = () => true; // jsdom has no layout; visibility is the crawler's rule, tested via the page
const at = (i: number) => document.querySelector(`[data-fp="${i}"]`) as HTMLElement;

beforeEach(() => {
  document.body.innerHTML = FORM;
});

describe("collectFields (mirrors crawler COLLECT_JS)", () => {
  it("numbers fillable controls in DOM order, skipping hidden, buttons and aria-hidden shadows", () => {
    const fields = collectFields(document, visible);
    expect(fields.map((f) => [f.mark, f.type])).toEqual([
      [1, "text"],
      [2, "file"],
      [3, "select-one"],
      [4, "radio"],
      [5, "radio"],
      [6, "textarea"],
    ]);
    expect(fields[0].label).toBe("First name ✱");
    expect(fields[2]).toMatchObject({ label: "Country", options: ["Select…", "United States", "Canada"] });
    expect(fields[3]).toMatchObject({ label: "Yes", group: "Are you authorized to work in the US?" });
    expect(at(1).id).toBe("resume");
  });

  it("puts radio/checkbox numbers left of the box, others right", () => {
    const fields = collectFields(document, visible);
    drawMarks(document, fields);
    const tags = [...document.querySelectorAll<HTMLElement>(".__fp_mark > div")];
    expect(tags.map((t) => t.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(tags[0].style.left).toBe("calc(100% + 4px)");
    expect(tags[3].style.right).toBe("calc(100% + 4px)");
    expect(collectFields(document, visible)).toHaveLength(6); // marks themselves are never collected
  });

  it("focus scrolls the mark to mid-viewport; null scrolls to the bottom", () => {
    const fields = collectFields(document, visible).map((f, i) => ({ ...f, bbox: [0, i * 500, 100, 20] as [number, number, number, number] }));
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    focusMark(document, fields, 3);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000 + 10 - window.innerHeight / 2, behavior: "instant" });
    focusMark(document, fields, null);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: document.documentElement.scrollHeight, behavior: "instant" });
  });
});

describe("execute", () => {
  beforeEach(() => void collectFields(document, visible));

  it("types through the native setter and fires input/change", async () => {
    const input = at(0) as HTMLInputElement;
    const seen: string[] = [];
    input.addEventListener("input", () => seen.push("input"));
    input.addEventListener("change", () => seen.push("change"));
    expect(await execute(document, { action: "type", mark: 1, value: "Jane" })).toEqual({ ok: true });
    expect(input.value).toBe("Jane");
    expect(seen).toEqual(["input", "change"]);
  });

  it("selects the closest option and reports a miss", async () => {
    const select = at(2) as HTMLSelectElement;
    expect(await execute(document, { action: "select", mark: 3, value: "united states" })).toEqual({ ok: true });
    expect(select.value).toBe("us");
    const miss = await execute(document, { action: "select", mark: 3, value: "Mars" });
    expect(miss.ok).toBe(false);
  });

  it("clicks a radio once and leaves a checked one alone", async () => {
    const no = at(4) as HTMLInputElement;
    const clicks = vi.fn();
    no.addEventListener("click", clicks);
    await execute(document, { action: "click", mark: 5, value: null });
    await execute(document, { action: "click", mark: 5, value: null });
    expect(no.checked).toBe(true);
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("refuses wrong targets and missing files; skip/done touch nothing", async () => {
    expect((await execute(document, { action: "upload", mark: 1, value: "resume" })).ok).toBe(false);
    expect((await execute(document, { action: "upload", mark: 2, value: "resume" })).error).toMatch(/no resume/);
    expect((await execute(document, { action: "type", mark: 99, value: "x" })).error).toMatch(/not on the page/);
    expect(await execute(document, { action: "done", mark: null, value: null })).toEqual({ ok: true });
    expect((at(0) as HTMLInputElement).value).toBe("");
  });
});

describe("autocomplete (Lever location box)", () => {
  // Mimics jobs.lever.co/js/retrieveLocations.js: search on keydown, pick on mousedown, blur clears an open list.
  function leverLocation() {
    document.body.innerHTML = `<div class="application-field"><label for="loc">Current location</label>
      <input id="loc" class="location-input" name="location"><input type="hidden" id="selected">
      <div class="dropdown-container" style="display:none"><div class="dropdown-results"></div></div></div>`;
    const input = document.getElementById("loc") as HTMLInputElement;
    const box = document.querySelector<HTMLElement>(".dropdown-container")!;
    input.addEventListener("input", () => (box.style.display = "block"));
    input.addEventListener("keydown", () =>
      setTimeout(() => {
        box.querySelector(".dropdown-results")!.innerHTML = ["Long Beach, CA, USA", "Long Beach, NY, USA"]
          .map((t, i) => `<div class="dropdown-location" id="location-${i}">${t}</div>`)
          .join("");
      }, 50),
    );
    input.addEventListener("blur", () => {
      if (box.style.display !== "none") input.value = "";
    });
    document.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement;
      if (!t.classList?.contains("dropdown-location")) return;
      box.style.display = "none";
      input.value = t.textContent!;
      (document.getElementById("selected") as HTMLInputElement).value = t.id;
    });
    return input;
  }

  it("picks a suggestion instead of blurring the typed text away", async () => {
    const input = leverLocation();
    // jsdom has no layout: give everything a box so suggestions count as visible.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 20, right: 100, width: 100, height: 20, toJSON: () => ({}) });
    collectFields(document, visible);
    const res = await execute(document, { action: "type", mark: 1, value: "Long Beach" }, undefined, { suggestTimeoutMs: 1000 });
    input.dispatchEvent(new FocusEvent("blur"));
    expect(res).toEqual({ ok: true });
    expect(input.value).toBe("Long Beach, CA, USA");
    expect((document.getElementById("selected") as HTMLInputElement).value).toBe("location-0");
    vi.restoreAllMocks();
  });
});

describe("helpers", () => {
  it("matchOption prefers exact, then the shortest containing option", () => {
    expect(matchOption("Yes", ["No", "Yes", "Yes, with sponsorship"])).toBe(1);
    expect(matchOption("master", ["Bachelor's Degree", "Master's Degree", "Master's Degree or higher"])).toBe(1);
    expect(matchOption("Glassdoor", ["LinkedIn", "Indeed"])).toBe(-1);
  });
  it("findSubmit finds the submit button", () => {
    expect(findSubmit(document)?.textContent).toBe("Submit application");
  });
});
