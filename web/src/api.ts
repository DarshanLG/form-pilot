/** Client for the FormPilot server (server/), reached through Vite's /api proxy. */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Profile = { [k: string]: Json };
export type FileKind = "resume" | "cover_letter";

export interface Action {
  action: string;
  mark: number | null;
  value: string | null;
  thought?: string | null;
}
export interface Counts {
  steps: number;
  accepted: number;
  edited: number;
  overridden: number;
}
export interface Run {
  _id: string;
  url: string;
  company: string;
  platform: string;
  status: "running" | "submitted" | "filled" | "abandoned";
  startedAt: string;
  finishedAt: string | null;
  counts: Counts;
}
export interface Step {
  _id: string;
  index: number;
  marks: number[];
  proposed: Action;
  decision: "accepted" | "edited" | "overridden";
  final: Action;
  fallback: boolean;
  latency_ms: number | null;
  createdAt: string;
}
export interface Stats {
  totals: Counts;
  rate: number | null;
  runs: number;
  corrections: number;
  daily: { day: string; steps: number; accepted: number; rate: number }[];
}
export interface StoredFile {
  kind: FileKind;
  filename: string;
  size: number;
  contentType: string;
  uploadedAt: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error || `${res.status} ${res.statusText}`);
  return body as T;
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: () => call<{ ok: boolean }>("/api/health"),
  stats: () => call<Stats>("/api/stats"),
  /** null when no profile has been saved yet. */
  profile: () =>
    call<{ profile: Profile; updatedAt: string }>("/api/profile").catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
  saveProfile: (p: Profile) => call<{ profile: Profile; updatedAt: string }>("/api/profile", json("PUT", p)),
  files: () => call<StoredFile[]>("/api/files"),
  uploadFile: (kind: FileKind, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<StoredFile>(`/api/files/${kind}`, { method: "PUT", body: form });
  },
  deleteFile: (kind: FileKind) => call<void>(`/api/files/${kind}`, { method: "DELETE" }),
  fileUrl: (kind: FileKind) => `/api/files/${kind}`,
  runs: (limit = 100) => call<Run[]>(`/api/runs?limit=${limit}`),
  run: (id: string) => call<Run & { steps: Step[] }>(`/api/runs/${id}`),
  correctionsExportUrl: "/api/corrections/export",
};
