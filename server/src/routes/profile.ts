import { Router } from "express";
import { HttpError, wrap, type Ctx } from "../app.js";
import { Profile } from "../schemas.js";

/** Single-user app: one profile document, `_id: "me"`. */
export async function loadProfile(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const doc = await ctx.db.collection<{ _id: string; profile: Record<string, unknown> }>("profiles").findOne({ _id: "me" });
  return doc?.profile ?? null;
}

export function profileRouter(ctx: Ctx) {
  const r = Router();
  const col = ctx.db.collection<{ _id: string; profile: unknown; updatedAt: Date }>("profiles");

  r.get(
    "/",
    wrap(async (_req, res) => {
      const doc = await col.findOne({ _id: "me" });
      if (!doc) throw new HttpError(404, "no profile yet");
      res.json({ profile: doc.profile, updatedAt: doc.updatedAt });
    }),
  );

  r.put(
    "/",
    wrap(async (req, res) => {
      const profile = Profile.parse(req.body);
      const updatedAt = new Date();
      await col.updateOne({ _id: "me" }, { $set: { profile, updatedAt } }, { upsert: true });
      res.json({ profile, updatedAt });
    }),
  );
  return r;
}
