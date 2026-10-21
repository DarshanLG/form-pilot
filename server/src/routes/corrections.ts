import { Router } from "express";
import { wrap, type Ctx } from "../app.js";

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** User corrections: the training signal for Phase 7 (export -> append to train set -> retrain). */
export function correctionsRouter(ctx: Ctx) {
  const r = Router();
  const col = ctx.db.collection("corrections");

  r.get(
    "/",
    wrap(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 100, 1000);
      res.json(await col.find({}, { projection: { profile: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray());
    }),
  );

  // NDJSON, one correction per line with its screenshot inlined (base64), oldest first.
  // Contains the user's real profile: write it under data/ (gitignored), never commit it.
  r.get(
    "/export",
    wrap(async (_req, res) => {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Content-Disposition", 'attachment; filename="corrections.jsonl"');
      for await (const c of col.find().sort({ createdAt: 1 })) {
        const screenshot = c.screenshotId
          ? (await readAll(ctx.bucket.openDownloadStream(c.screenshotId))).toString("base64")
          : null;
        const { _id, runId, stepId, screenshotId: _s, ...rest } = c;
        res.write(JSON.stringify({ id: String(_id), runId: String(runId), stepId: String(stepId), ...rest, screenshot }) + "\n");
      }
      res.end();
    }),
  );
  return r;
}
