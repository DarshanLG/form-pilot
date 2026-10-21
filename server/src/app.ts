import cors from "cors";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import { GridFSBucket, ObjectId, type Db } from "mongodb";
import { ZodError } from "zod";
import { actRouter } from "./routes/act.js";
import { correctionsRouter } from "./routes/corrections.js";
import { filesRouter } from "./routes/files.js";
import { profileRouter } from "./routes/profile.js";
import { runsRouter, statsRouter } from "./routes/runs.js";

export interface Deps {
  db: Db;
  inferenceUrl: string;
  fetch?: typeof fetch; // injectable for tests
}

export interface Ctx {
  db: Db;
  bucket: GridFSBucket;
  inferenceUrl: string;
  fetch: typeof fetch;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Express 4 does not catch rejected promises: route them to the error handler. */
export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export function oid(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new HttpError(404, "not found");
  return new ObjectId(id);
}

// Local, single-user app: the extension (chrome-extension://) and the dashboard on localhost may call it.
const ORIGIN = /^(chrome-extension:\/\/[a-p]{32}|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

export function createApp(deps: Deps) {
  const ctx: Ctx = {
    db: deps.db,
    bucket: new GridFSBucket(deps.db, { bucketName: "files" }),
    inferenceUrl: deps.inferenceUrl.replace(/\/$/, ""),
    fetch: deps.fetch ?? fetch,
  };
  const app = express();
  app.use(cors({ origin: ORIGIN }));
  app.use(express.json({ limit: "15mb" })); // steps and /act carry a base64 screenshot

  app.get(
    "/api/health",
    wrap(async (_req, res) => {
      await ctx.db.command({ ping: 1 });
      res.json({ ok: true });
    }),
  );
  app.use("/api/profile", profileRouter(ctx));
  app.use("/api/files", filesRouter(ctx));
  app.use("/api/runs", runsRouter(ctx));
  app.use("/api/stats", statsRouter(ctx));
  app.use("/api/corrections", correctionsRouter(ctx));
  app.use("/api/act", actRouter(ctx));
  app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) return res.status(422).json({ error: "invalid body", issues: err.issues });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "body too large" });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "invalid JSON" });
    if (err?.name === "MulterError") return res.status(413).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "internal error" });
  };
  app.use(onError);
  return app;
}
