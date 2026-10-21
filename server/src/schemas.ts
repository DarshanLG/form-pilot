import { z } from "zod";

export const ACTIONS = ["type", "select", "click", "upload", "skip", "done"] as const;
export const FILE_KINDS = ["resume", "cover_letter"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** One agent action, same shape as the model's output (`inference/server.py`). */
export const Action = z
  .object({
    action: z.enum(ACTIONS),
    mark: z.number().int().nullable().default(null),
    value: z.string().nullable().default(null),
    thought: z.string().nullable().optional(),
  })
  .superRefine((a, ctx) => {
    if (a.action !== "done" && a.mark === null) ctx.addIssue({ code: "custom", message: `${a.action} needs a mark` });
    if ((a.action === "type" || a.action === "select") && !a.value?.trim())
      ctx.addIssue({ code: "custom", message: `${a.action} needs a value` });
    if (a.action === "upload" && !FILE_KINDS.includes(a.value as FileKind))
      ctx.addIssue({ code: "custom", message: `upload value must be one of ${FILE_KINDS.join(", ")}` });
  });
export type Action = z.infer<typeof Action>;

/** Same action, mark and value (the thought does not matter). */
export const sameAction = (a: Action, b: Action) =>
  a.action === b.action && (a.mark ?? null) === (b.mark ?? null) && (a.value ?? null) === (b.value ?? null);

/** The profile is free-form JSON (schema: `data/profile.example.json`); only require an object with a name. */
export const Profile = z.object({ name: z.object({ first: z.string(), last: z.string() }).passthrough() }).passthrough();

export const RunStart = z.object({
  url: z.string().url(),
  company: z.string().default(""),
  platform: z.enum(["greenhouse", "lever", "workday", "other"]).default("other"),
});

export const RunFinish = z.object({
  // "submitted" is only ever reported by the extension after the user clicked Submit themselves.
  status: z.enum(["submitted", "abandoned", "filled"]),
});

/**
 * One step: what the model proposed and what the user decided.
 * accepted = ran as proposed; edited = user changed it (final differs); overridden = user skipped/took over.
 */
export const Step = z.object({
  marks: z.array(z.number().int()).default([]),
  history: z.array(z.record(z.unknown())).default([]),
  proposed: Action,
  decision: z.enum(["accepted", "edited", "overridden"]),
  final: Action.optional(),
  fallback: z.boolean().default(false),
  latency_ms: z.number().int().nonnegative().optional(),
  // Viewport screenshot (base64 PNG/JPEG); stored only when the step becomes a correction.
  screenshot: z.string().optional(),
});

export const ActBody = z.object({
  screenshot: z.string().min(1),
  marks: z.array(z.number().int()).default([]),
  history: z.array(z.record(z.unknown())).default([]),
  profile: z.record(z.unknown()).optional(),
});
