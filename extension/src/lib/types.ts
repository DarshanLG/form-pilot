export type ActionName = "type" | "select" | "click" | "upload" | "skip" | "done";
export const ACTIONS: ActionName[] = ["type", "select", "click", "upload", "skip", "done"];
export type FileKind = "resume" | "cover_letter";

/** One agent action, as the model emits it and the server stores it. */
export interface Action {
  action: ActionName;
  mark: number | null;
  value: string | null;
  thought?: string | null;
}

/** POST /api/act response (inference/server.py ActResponse). */
export interface Proposal extends Action {
  fallback: boolean;
  attempts: number;
  latency_ms: number;
}

export interface FieldInfo {
  mark: number;
  tag: string;
  type: string;
  name: string; // input name: radios sharing it are one single-choice question
  label: string;
  group: string;
  options: string[];
  bbox: [number, number, number, number]; // page coordinates
}

/** Side panel → content script messages. */
export type Msg =
  | { kind: "fp:mark" }
  | { kind: "fp:focus"; mark: number | null }
  | { kind: "fp:highlight"; mark: number | null }
  | { kind: "fp:exec"; action: Action; file?: { name: string; type: string; b64: string } }
  | { kind: "fp:submitTarget" }
  | { kind: "fp:submit" }
  | { kind: "fp:clear" };

export interface MarkResult {
  fields: FieldInfo[];
}
export interface FocusResult {
  visible: number[];
}
export interface ExecResult {
  ok: boolean;
  error?: string;
}
export interface SubmitTarget {
  found: boolean;
  label?: string;
}
