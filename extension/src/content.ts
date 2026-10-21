import { execute, findSubmit } from "./lib/exec";
import { clearMarks, collectFields, drawMarks, focusMark } from "./lib/fields";
import type { FieldInfo, Msg } from "./lib/types";

// Injected on demand by the side panel (chrome.scripting); guard against double injection.
declare global {
  interface Window {
    __formpilot?: boolean;
  }
}

if (!window.__formpilot) {
  window.__formpilot = true;
  let fields: FieldInfo[] = [];

  const handle = async (msg: Msg): Promise<unknown> => {
    switch (msg.kind) {
      case "fp:mark":
        // Re-collect every step: conditional questions and dropdowns move things around.
        clearMarks(document);
        fields = collectFields(document);
        drawMarks(document, fields);
        return { fields };
      case "fp:focus":
        return { visible: focusMark(document, fields, msg.mark) };
      case "fp:highlight":
        drawMarks(document, fields, msg.mark);
        return { ok: true };
      case "fp:exec":
        return execute(document, msg.action, msg.file);
      case "fp:submitTarget": {
        const b = findSubmit(document);
        return { found: !!b, label: b ? (b.innerText || (b as HTMLInputElement).value || "Submit").trim() : undefined };
      }
      case "fp:submit": {
        // Only sent after the user confirmed twice in the side panel.
        const b = findSubmit(document);
        if (!b) return { ok: false, error: "no submit button found" };
        clearMarks(document);
        b.click();
        return { ok: true };
      }
      case "fp:clear":
        clearMarks(document);
        document.querySelectorAll("[data-fp]").forEach((n) => n.removeAttribute("data-fp"));
        return { ok: true };
    }
  };

  chrome.runtime.onMessage.addListener((msg: Msg, _sender, reply) => {
    if (typeof msg?.kind !== "string" || !msg.kind.startsWith("fp:")) return false;
    handle(msg).then(reply, (e) => reply({ ok: false, error: String(e) }));
    return true; // async reply
  });
}
