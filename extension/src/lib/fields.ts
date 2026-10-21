import type { FieldInfo } from "./types";

/*
 * Field collection and set-of-marks drawing. KEEP IN SYNC with COLLECT_JS / MARK_JS in crawler/capture.py:
 * the model was trained on screenshots marked by that code, so the live page must look the same.
 */

export const FIELD_SELECTOR =
  "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [role=combobox], [role=listbox], [contenteditable=true]";
const GENERIC = /^(attach|upload|browse|choose file|enter manually|dropbox|select\.*)?$/i;
const MARK_CLASS = "__fp_mark";
const RED = "#e11d48";

const txt = (n: Element | null | undefined) =>
  ((n as HTMLElement | null)?.innerText || n?.textContent || "").replace(/\s+/g, " ").trim();

export function defaultVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const fileOk = (el as HTMLInputElement).type === "file"; // file inputs are often hidden behind a button
  return fileOk || (r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none");
}

function groupLabel(el: Element): string {
  const lg = el.closest("fieldset")?.querySelector("legend");
  if (lg) return txt(lg);
  let p = el.parentElement;
  for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
    for (const l of p.querySelectorAll("legend, label, .label, [class*=label]")) {
      if (l.contains(el) || l.querySelector("input, select, textarea")) continue;
      const t = txt(l);
      if (!GENERIC.test(t)) return t;
    }
  }
  return "";
}

function labelFor(el: HTMLInputElement): string {
  const doc = el.ownerDocument;
  if (el.id) {
    const l = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l) return txt(l);
  }
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const lb = el.getAttribute("aria-labelledby");
  if (lb) return lb.split(/\s+/).map((id) => txt(doc.getElementById(id))).join(" ");
  const wrap = el.closest("label");
  if (wrap) return txt(wrap);
  let p = el.parentElement;
  for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
    const l = p.querySelector("label, legend, .label, [class*=label]");
    if (l && !l.contains(el)) return txt(l);
  }
  return el.placeholder || el.name || "";
}

/** The element a mark's box is drawn around (and scrolled to). */
export function boxTarget(el: Element): Element {
  const role = el.getAttribute("role") || "";
  if ((el as HTMLInputElement).type === "file") return el.closest("div") || el;
  if (role === "combobox") return el.closest("[class*=control]") || el; // react-select: the visible control
  return el;
}

/** Number every fillable control on the page (1-based, DOM order) and tag it with data-fp=<index>. */
export function collectFields(doc: Document, isVisible: (el: Element) => boolean = defaultVisible): FieldInfo[] {
  const win = doc.defaultView!;
  const out: FieldInfo[] = [];
  doc.querySelectorAll(`[data-fp]`).forEach((n) => n.removeAttribute("data-fp"));
  doc.querySelectorAll<HTMLInputElement>(FIELD_SELECTOR).forEach((el) => {
    if (el.closest(`.${MARK_CLASS}`) || !isVisible(el)) return;
    if (el.getAttribute("aria-hidden") === "true" && el.type !== "file") return; // react-select shadow input
    const role = el.getAttribute("role") || "";
    const r = boxTarget(el).getBoundingClientRect();
    const isOption = el.type === "radio" || el.type === "checkbox";
    let label = labelFor(el);
    const group = isOption ? groupLabel(el) : "";
    if (!isOption && GENERIC.test(label)) label = groupLabel(el) || label;
    el.setAttribute("data-fp", String(out.length));
    out.push({
      mark: out.length + 1,
      tag: el.tagName.toLowerCase(),
      type: ["combobox", "listbox"].includes(role) ? role : el.type || role,
      name: el.name || "",
      label: label.slice(0, 300),
      group: group.slice(0, 300),
      options:
        el.tagName === "SELECT"
          ? [...(el as unknown as HTMLSelectElement).options].map((o) => o.text.trim()).filter(Boolean).slice(0, 60)
          : [],
      bbox: [r.x + win.scrollX, r.y + win.scrollY, r.width, r.height],
    });
  });
  return out;
}

export function clearMarks(doc: Document) {
  doc.querySelectorAll(`.${MARK_CLASS}`).forEach((n) => n.remove());
}

/** 2px red box + white-on-red number; radio/checkbox numbers on the left so option text stays readable. */
export function drawMarks(doc: Document, fields: FieldInfo[], highlight: number | null = null) {
  clearMarks(doc);
  for (const f of fields) {
    const [x, y, w, h] = f.bbox;
    const box = doc.createElement("div");
    box.className = MARK_CLASS;
    Object.assign(box.style, {
      position: "absolute",
      left: `${x}px`,
      top: `${y}px`,
      width: `${w}px`,
      height: `${h}px`,
      border: `2px solid ${RED}`,
      zIndex: "2147483647",
      pointerEvents: "none",
      boxSizing: "border-box",
    });
    const tag = doc.createElement("div");
    tag.textContent = String(f.mark);
    const side = f.type === "radio" || f.type === "checkbox" ? "right" : "left";
    Object.assign(tag.style, {
      position: "absolute",
      [side]: "calc(100% + 4px)",
      top: "0",
      background: RED,
      color: "#fff",
      font: "bold 12px/16px monospace",
      padding: "0 4px",
      borderRadius: "3px",
    });
    box.appendChild(tag);
    doc.body.appendChild(box);
    // Highlight is drawn only after the screenshot (the model never saw it): an outer glow on the proposed mark.
    if (f.mark === highlight) box.style.boxShadow = "0 0 0 4px rgba(37, 99, 235, 0.6)";
  }
}

/** Element for a mark number, or null if the page changed under us. */
export function elementFor(doc: Document, mark: number): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`[data-fp="${mark - 1}"]`);
}

/**
 * Scroll so the mark sits mid-viewport, like the training crops; `null` (every field handled) scrolls to the
 * page bottom, where the `done` examples are cropped. Returns the marks now on screen.
 */
export function focusMark(doc: Document, fields: FieldInfo[], mark: number | null): number[] {
  const win = doc.defaultView!;
  const f = fields.find((x) => x.mark === mark);
  const top = f ? f.bbox[1] + f.bbox[3] / 2 - win.innerHeight / 2 : doc.documentElement.scrollHeight;
  win.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  return visibleMarks(win, fields);
}

function visibleMarks(win: Window, fields: FieldInfo[]): number[] {
  const top = win.scrollY;
  const bottom = top + win.innerHeight;
  return fields.filter((x) => x.bbox[1] + x.bbox[3] > top && x.bbox[1] < bottom).map((x) => x.mark);
}
