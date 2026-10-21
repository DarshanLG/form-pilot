import type { Action, FileKind, Proposal } from "./types";

/** Client for the FormPilot server (server/). Base URL lives in chrome.storage.local. */
export const DEFAULT_SERVER = "http://127.0.0.1:4000";

export async function getServer(): Promise<string> {
  const { server } = await chrome.storage.local.get("server");
  return (server as string) || DEFAULT_SERVER;
}
export const setServer = (server: string) => chrome.storage.local.set({ server: server.replace(/\/$/, "") });

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${await getServer()}${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.detail || `${res.status} ${res.statusText}`);
  return body as T;
}
const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export interface SetupStatus {
  server: boolean;
  profile: boolean;
  files: FileKind[];
  error?: string;
}

export async function setupStatus(): Promise<SetupStatus> {
  try {
    await call("/api/health");
  } catch (e) {
    return { server: false, profile: false, files: [], error: (e as Error).message };
  }
  const profile = await call("/api/profile").then(() => true, () => false);
  const files = await call<{ kind: FileKind }[]>("/api/files").then((fs) => fs.map((f) => f.kind), () => []);
  return { server: true, profile, files };
}

export const startRun = (url: string, platform: string) =>
  post<{ _id: string }>("/api/runs", { url, platform, company: new URL(url).hostname });

export const act = (screenshot: string, marks: number[], history: Record<string, unknown>[]) =>
  post<Proposal>("/api/act", { screenshot, marks, history });

export const logStep = (
  runId: string,
  step: {
    marks: number[];
    history: Record<string, unknown>[];
    proposed: Action;
    decision: string;
    final: Action;
    fallback: boolean;
    latency_ms?: number;
    screenshot?: string;
  },
) => post(`/api/runs/${runId}/steps`, step);

export const finishRun = (runId: string, status: "submitted" | "filled" | "abandoned") =>
  post(`/api/runs/${runId}/finish`, { status });

/** The stored resume / cover letter, base64-encoded for the content script. */
export async function fetchFile(kind: FileKind): Promise<{ name: string; type: string; b64: string } | undefined> {
  const res = await fetch(`${await getServer()}/api/files/${kind}`);
  if (!res.ok) return undefined;
  const name = decodeURIComponent(/filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `${kind}.pdf`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name, type: res.headers.get("Content-Type") ?? "application/pdf", b64: btoa(bin) };
}
