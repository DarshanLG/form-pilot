import type { Action, FieldInfo, Proposal } from "./types";

export type Decision = "accepted" | "edited" | "overridden";

export function platformOf(url: string): "greenhouse" | "lever" | "workday" | "other" {
  const host = new URL(url).hostname;
  if (host.includes("greenhouse")) return "greenhouse";
  if (host.includes("lever.co")) return "lever";
  if (host.includes("myworkdayjobs") || host.includes("workday")) return "workday";
  return "other";
}

/** History entries look like the training data: {action, mark, value} with nulls dropped, no thought. */
export function historyEntry(a: Action): Record<string, unknown> {
  const e: Record<string, unknown> = { action: a.action };
  if (a.mark != null) e.mark = a.mark;
  if (a.value != null) e.value = a.value;
  return e;
}

/** The first mark not yet handled, which the page is scrolled to before each screenshot; null = all done. */
export function nextMark(history: Record<string, unknown>[], marks: number[]): number | null {
  const handled = new Set(history.map((h) => h.mark));
  return marks.find((m) => !handled.has(m)) ?? null;
}

/**
 * After a radio option is clicked, the other options of that question are answered (`skip`, exactly what the
 * training labels say for unchosen options): no need to ask the model about each. Checkboxes are multi-choice,
 * so they are still asked one by one.
 */
export function radioSiblings(fields: FieldInfo[], final: Action, history: Record<string, unknown>[]): number[] {
  if (final.action !== "click") return [];
  const f = fields.find((x) => x.mark === final.mark);
  if (!f || f.type !== "radio" || !f.name) return [];
  const handled = new Set(history.map((h) => h.mark));
  return fields.filter((x) => x.type === "radio" && x.name === f.name && x.mark !== f.mark && !handled.has(x.mark)).map((x) => x.mark);
}

export const sameAction = (a: Action, b: Action) =>
  a.action === b.action && (a.mark ?? null) === (b.mark ?? null) && (a.value ?? null) === (b.value ?? null);

/** A Skip of a proposed skip, or an Edit that changed nothing, is an accept (the server applies the same rule). */
export function effectiveDecision(p: Action, decision: Decision, final: Action): Decision {
  return sameAction(final, p) ? "accepted" : decision;
}

/** Same rules as server/src/routes/runs.ts: what actually runs for a decision. */
export function resolveFinal(p: Action, decision: Decision, edited?: Action): Action {
  if (decision === "accepted") return { action: p.action, mark: p.mark, value: p.value };
  if (decision === "edited") {
    if (!edited) throw new Error("an edited step needs the edited action");
    return edited;
  }
  return { action: "skip", mark: p.mark, value: null };
}

/**
 * Auto-accept only routine proposals. Always stop for the user on: `done` (submit gate), model fallbacks
 * (it produced no valid action), and repeats of an already-handled mark (a sign it is looping).
 */
export function autoAcceptable(p: Proposal, history: Record<string, unknown>[]): boolean {
  if (p.action === "done" || p.fallback) return false;
  return !(p.mark != null && history.some((h) => h.mark === p.mark));
}

/** Validation the server will apply anyway; checked here so the Edit form can show it inline. */
export function actionError(a: Action): string | null {
  if (a.action !== "done" && a.mark == null) return `${a.action} needs a mark`;
  if ((a.action === "type" || a.action === "select") && !a.value?.trim()) return `${a.action} needs a value`;
  if (a.action === "upload" && a.value !== "resume" && a.value !== "cover_letter") return "upload needs resume or cover_letter";
  return null;
}
