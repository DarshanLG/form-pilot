import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ObjectId } from "mongodb";
import { HttpError, oid, wrap, type Ctx } from "../app.js";
import { RunFinish, RunStart, Step, sameAction, type Action } from "../schemas.js";
import { loadProfile } from "./profile.js";

const DECISIONS = ["accepted", "edited", "overridden"] as const;

async function storeScreenshot(ctx: Ctx, b64: string): Promise<ObjectId> {
  const data = Buffer.from(b64.replace(/^data:[^,]*,/, ""), "base64");
  if (!data.length) throw new HttpError(422, "screenshot is not valid base64");
  const stream = ctx.bucket.openUploadStream("screenshot.png", { metadata: { kind: "screenshot" } });
  await pipeline(Readable.from(data), stream);
  return stream.id;
}

/** An application run: the steps the agent proposed on one form and what the user did with each. */
export function runsRouter(ctx: Ctx) {
  const r = Router();
  const runs = ctx.db.collection("runs");
  const steps = ctx.db.collection("steps");
  const corrections = ctx.db.collection("corrections");

  r.post(
    "/",
    wrap(async (req, res) => {
      const body = RunStart.parse(req.body);
      const run = {
        ...body,
        status: "running",
        startedAt: new Date(),
        finishedAt: null,
        counts: { steps: 0, accepted: 0, edited: 0, overridden: 0 },
      };
      const { insertedId } = await runs.insertOne(run);
      res.status(201).json({ _id: insertedId, ...run });
    }),
  );

  r.get(
    "/",
    wrap(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 50, 500);
      res.json(await runs.find().sort({ startedAt: -1 }).limit(limit).toArray());
    }),
  );

  r.get(
    "/:id",
    wrap(async (req, res) => {
      const _id = oid(req.params.id);
      const run = await runs.findOne({ _id });
      if (!run) throw new HttpError(404, "run not found");
      res.json({ ...run, steps: await steps.find({ runId: _id }).sort({ index: 1 }).toArray() });
    }),
  );

  r.post(
    "/:id/steps",
    wrap(async (req, res) => {
      const _id = oid(req.params.id);
      const run = await runs.findOne({ _id });
      if (!run) throw new HttpError(404, "run not found");
      if (run.status !== "running") throw new HttpError(409, `run is ${run.status}`);
      const s = Step.parse(req.body);
      let final: Action;
      if (s.decision === "accepted") final = s.proposed;
      else if (s.decision === "edited") {
        if (!s.final) throw new HttpError(422, "an edited step needs `final`");
        final = s.final;
      } else final = s.final ?? { action: "skip", mark: s.proposed.mark, value: null };
      // Skipping a proposed skip, or "editing" without a change, means the model was right: not a correction.
      const decision = sameAction(final, s.proposed) ? "accepted" : s.decision;

      const step = {
        runId: _id,
        index: run.counts.steps,
        marks: s.marks,
        history: s.history,
        proposed: s.proposed,
        decision,
        final,
        fallback: s.fallback,
        latency_ms: s.latency_ms ?? null,
        createdAt: new Date(),
      };
      const { insertedId } = await steps.insertOne(step);

      let correctionId = null;
      if (decision !== "accepted") {
        // The user's action is the training target for Phase 7; keep what the model saw alongside it.
        const screenshotId = s.screenshot ? await storeScreenshot(ctx, s.screenshot) : null;
        ({ insertedId: correctionId } = await corrections.insertOne({
          runId: _id,
          stepId: insertedId,
          url: run.url,
          platform: run.platform,
          marks: s.marks,
          history: s.history,
          profile: await loadProfile(ctx),
          proposed: s.proposed,
          final,
          decision,
          screenshotId,
          createdAt: step.createdAt,
        }));
      }
      await runs.updateOne({ _id }, { $inc: { "counts.steps": 1, [`counts.${decision}`]: 1 } });
      res.status(201).json({ _id: insertedId, ...step, correctionId });
    }),
  );

  r.post(
    "/:id/finish",
    wrap(async (req, res) => {
      const _id = oid(req.params.id);
      const { status } = RunFinish.parse(req.body);
      const run = await runs.findOneAndUpdate(
        { _id, status: "running" },
        { $set: { status, finishedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (!run) throw new HttpError((await runs.countDocuments({ _id })) ? 409 : 404, "run not found or already finished");
      res.json(run);
    }),
  );
  return r;
}

/** Acceptance rate over time: share of proposed actions the user ran unchanged, per day. */
export function statsRouter(ctx: Ctx) {
  const r = Router();
  r.get(
    "/",
    wrap(async (_req, res) => {
      const daily = await ctx.db
        .collection("steps")
        .aggregate([
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              steps: { $sum: 1 },
              accepted: { $sum: { $cond: [{ $eq: ["$decision", "accepted"] }, 1, 0] } },
            },
          },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, day: "$_id", steps: 1, accepted: 1, rate: { $divide: ["$accepted", "$steps"] } } },
        ])
        .toArray();
      const totals = { steps: 0, ...Object.fromEntries(DECISIONS.map((d) => [d, 0])) } as Record<string, number>;
      for (const row of await ctx.db
        .collection("steps")
        .aggregate([{ $group: { _id: "$decision", n: { $sum: 1 } } }])
        .toArray()) {
        totals[row._id] = row.n;
        totals.steps += row.n;
      }
      res.json({
        totals,
        rate: totals.steps ? totals.accepted / totals.steps : null,
        runs: await ctx.db.collection("runs").countDocuments(),
        corrections: await ctx.db.collection("corrections").countDocuments(),
        daily,
      });
    }),
  );
  return r;
}
