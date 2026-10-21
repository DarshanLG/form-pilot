import { elementFor } from "./fields";
import type { Action, ExecResult } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Best option for a value: exact, then option-contains-value, then value-contains-option (shortest wins). */
export function matchOption(value: string, options: string[]): number {
  const v = norm(value);
  const opts = options.map(norm);
  const exact = opts.indexOf(v);
  if (exact >= 0) return exact;
  const pick = (pred: (o: string) => boolean) =>
    opts.map((o, i) => [o, i] as const).filter(([o]) => o && pred(o)).sort((a, b) => a[0].length - b[0].length)[0]?.[1];
  return pick((o) => o.includes(v)) ?? pick((o) => v.includes(o)) ?? -1;
}

/** Set a value the way a user would, so React/Vue controlled inputs see it (native setter + input/change). */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function pressEnter(el: HTMLElement) {
  for (const type of ["keydown", "keypress", "keyup"])
    el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
}

/** A text input backed by a suggestion list: typing alone is not enough, a suggestion must be picked. */
export function isAutocomplete(el: HTMLElement): boolean {
  return (
    el.getAttribute("role") === "combobox" ||
    !!el.getAttribute("aria-autocomplete") ||
    !!(el as HTMLInputElement).list ||
    !!el.parentElement?.querySelector("[class*=dropdown], [class*=autocomplete], [class*=suggest]")
  );
}

const SUGGESTION = "[role=option], .dropdown-location, [class*=suggestion], [class*=autocomplete] li, .pac-item";

/** Visible suggestion elements laid out just below (or around) the field. */
export function suggestionsFor(doc: Document, el: HTMLElement): HTMLElement[] {
  const box = el.getBoundingClientRect();
  return [...doc.querySelectorAll<HTMLElement>(SUGGESTION)].filter((s) => {
    if (s.closest(".__fp_mark") || s.tagName === "OPTION") return false;
    const r = s.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= box.top - 60 && r.top <= box.bottom + 500 && !!s.textContent?.trim();
  });
}

/** Wait for the site's suggestions (they usually come from a debounced network search) and pick the best one. */
async function pickSuggestion(doc: Document, el: HTMLElement, value: string, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 250));
    const opts = suggestionsFor(doc, el);
    if (!opts.length) continue;
    const i = matchOption(value, opts.map((o) => o.textContent ?? ""));
    const pick = opts[Math.max(i, 0)];
    for (const type of ["mousedown", "mouseup", "click"])
      pick.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    return true;
  }
  return false;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Carry out one action on the marked page. Never submits: `done` and `skip` touch nothing. */
export async function execute(
  doc: Document,
  a: Action,
  file?: { name: string; type: string; b64: string },
  opts: { suggestTimeoutMs: number } = { suggestTimeoutMs: 3000 },
): Promise<ExecResult> {
  if (a.action === "done" || a.action === "skip") return { ok: true };
  if (a.mark == null) return { ok: false, error: `${a.action} needs a mark` };
  const el = elementFor(doc, a.mark);
  if (!el) return { ok: false, error: `mark ${a.mark} is not on the page any more` };
  el.focus?.();

  switch (a.action) {
    case "type": {
      const value = a.value ?? "";
      if (el.isContentEditable) {
        el.textContent = value;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      } else if (el instanceof doc.defaultView!.HTMLInputElement || el instanceof doc.defaultView!.HTMLTextAreaElement) {
        setNativeValue(el, value);
        if (isAutocomplete(el)) {
          // Many typeaheads search on keydown/keyup, not input; and blurring with the list open clears the
          // field (Lever's location box does exactly that), so pick a suggestion instead of blurring.
          for (const type of ["keydown", "keyup"])
            el.dispatchEvent(new KeyboardEvent(type, { key: value.slice(-1) || "a", bubbles: true }));
          if (await pickSuggestion(doc, el, value, opts.suggestTimeoutMs)) return { ok: true };
          if (el.getAttribute("role") === "combobox") pressEnter(el);
          return el.value
            ? { ok: true }
            : { ok: false, error: `mark ${a.mark} wants a choice from its suggestion list; none matched "${value}"` };
        }
      } else return { ok: false, error: `mark ${a.mark} is not a text field` };
      el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      return { ok: true };
    }
    case "select": {
      const value = a.value ?? "";
      if (el instanceof doc.defaultView!.HTMLSelectElement) {
        const i = matchOption(value, [...el.options].map((o) => o.text));
        if (i < 0) return { ok: false, error: `no option like "${value}" in mark ${a.mark}` };
        setNativeValue(el, el.options[i].value);
        return { ok: true };
      }
      if (el instanceof doc.defaultView!.HTMLInputElement) {
        // react-select and friends: type to filter, then pick the matching option (Enter as a fallback).
        setNativeValue(el, value);
        if (!(await pickSuggestion(doc, el, value, opts.suggestTimeoutMs))) pressEnter(el);
        return { ok: true };
      }
      return { ok: false, error: `mark ${a.mark} is not a select` };
    }
    case "click": {
      const input = el as HTMLInputElement;
      if ((input.type === "checkbox" || input.type === "radio") && input.checked) return { ok: true }; // already set
      el.click();
      return { ok: true };
    }
    case "upload": {
      const input = el as HTMLInputElement;
      if (input.type !== "file") return { ok: false, error: `mark ${a.mark} is not a file input` };
      if (!file) return { ok: false, error: `no ${a.value} uploaded in FormPilot` };
      const DT = doc.defaultView!.DataTransfer;
      if (!DT) return { ok: false, error: "this browser cannot set files programmatically" };
      const dt = new DT();
      dt.items.add(new File([b64ToBytes(file.b64)], file.name, { type: file.type }));
      input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }
  }
}

/** The form's final submit control, if there is one. Used only behind the side panel's confirm gate. */
export function findSubmit(doc: Document): HTMLElement | null {
  const typed = doc.querySelector<HTMLElement>("form button[type=submit], form input[type=submit], button[type=submit]");
  if (typed) return typed;
  const buttons = [...doc.querySelectorAll<HTMLElement>("button, [role=button], input[type=button]")];
  return buttons.find((b) => /submit( application)?|send application/i.test(b.innerText || (b as HTMLInputElement).value || "")) ?? null;
}
