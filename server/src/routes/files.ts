import { Router } from "express";
import multer from "multer";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError, wrap, type Ctx } from "../app.js";
import { FILE_KINDS, type FileKind } from "../schemas.js";

const DOC_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 2 ** 20, files: 1 } });

function kindOf(raw: string): FileKind {
  if (!FILE_KINDS.includes(raw as FileKind)) throw new HttpError(404, `unknown file kind ${raw}`);
  return raw as FileKind;
}

/** Resume and cover letter in GridFS (`files` bucket, metadata.kind); one current file per kind. */
export function filesRouter(ctx: Ctx) {
  const r = Router();
  const latest = (kind: FileKind) =>
    ctx.bucket.find({ "metadata.kind": kind }).sort({ uploadDate: -1 }).limit(1).next();

  r.get(
    "/",
    wrap(async (_req, res) => {
      const out = [];
      for (const kind of FILE_KINDS) {
        const f = await latest(kind);
        if (f) out.push({ kind, filename: f.filename, size: f.length, contentType: f.metadata?.contentType, uploadedAt: f.uploadDate });
      }
      res.json(out);
    }),
  );

  r.put(
    "/:kind",
    upload.single("file"),
    wrap(async (req, res) => {
      const kind = kindOf(req.params.kind);
      const file = req.file;
      if (!file) throw new HttpError(422, 'multipart field "file" is required');
      if (!DOC_TYPES.has(file.mimetype)) throw new HttpError(415, "resume/cover letter must be PDF, DOC or DOCX");
      const old = await ctx.bucket.find({ "metadata.kind": kind }).toArray();
      const stream = ctx.bucket.openUploadStream(file.originalname, { metadata: { kind, contentType: file.mimetype } });
      await pipeline(Readable.from(file.buffer), stream);
      for (const f of old) await ctx.bucket.delete(f._id);
      res.status(201).json({ kind, filename: file.originalname, size: file.size, contentType: file.mimetype });
    }),
  );

  r.get(
    "/:kind",
    wrap(async (req, res) => {
      const kind = kindOf(req.params.kind);
      const f = await latest(kind);
      if (!f) throw new HttpError(404, `no ${kind} uploaded`);
      res.setHeader("Content-Type", f.metadata?.contentType ?? "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(f.filename)}"`);
      await pipeline(ctx.bucket.openDownloadStream(f._id), res);
    }),
  );

  r.delete(
    "/:kind",
    wrap(async (req, res) => {
      const kind = kindOf(req.params.kind);
      const all = await ctx.bucket.find({ "metadata.kind": kind }).toArray();
      for (const f of all) await ctx.bucket.delete(f._id);
      res.status(204).end();
    }),
  );
  return r;
}
