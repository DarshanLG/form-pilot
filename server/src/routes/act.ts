import { Router } from "express";
import { HttpError, wrap, type Ctx } from "../app.js";
import { ActBody } from "../schemas.js";
import { loadProfile } from "./profile.js";

/** Proxy to the model server (`inference/server.py` POST /act), filling in the stored profile. */
export function actRouter(ctx: Ctx) {
  const r = Router();
  r.post(
    "/",
    wrap(async (req, res) => {
      const body = ActBody.parse(req.body);
      const profile = body.profile ?? (await loadProfile(ctx));
      if (!profile) throw new HttpError(409, "save a profile first (PUT /api/profile)");
      let upstream: Response;
      try {
        upstream = await ctx.fetch(`${ctx.inferenceUrl}/act`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, profile }),
          signal: AbortSignal.timeout(120_000), // CPU fallback is ~25 s/step; retries can triple it
        });
      } catch (e) {
        throw new HttpError(502, `model server unreachable at ${ctx.inferenceUrl}: ${(e as Error).message}`);
      }
      // 4xx is about our request (e.g. a bad screenshot): pass it through. 5xx is the model server's fault.
      res.status(upstream.status < 500 ? upstream.status : 502).json(await upstream.json().catch(() => ({ error: "bad upstream response" })));
    }),
  );
  return r;
}
