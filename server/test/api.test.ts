import { MongoClient, type Db } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

// Needs a local mongod (MONGO_URL); each run uses and drops its own throwaway database.
let client: MongoClient;
let db: Db;
const fakeFetch = vi.fn();
let app: ReturnType<typeof createApp>;

const profile = { name: { first: "Jane", last: "Doe" }, email: "jane@example.com" };
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

beforeAll(async () => {
  client = await MongoClient.connect(process.env.MONGO_URL ?? "mongodb://127.0.0.1:27017", {
    serverSelectionTimeoutMS: 3000,
  });
  db = client.db(`formpilot_test_${process.pid}_${Date.now()}`);
  app = createApp({ db, inferenceUrl: "http://model.test/", fetch: fakeFetch as unknown as typeof fetch });
});
afterAll(async () => {
  await db.dropDatabase();
  await client.close();
});
beforeEach(async () => {
  fakeFetch.mockReset();
  for (const c of await db.collections()) await c.deleteMany({});
});

describe("profile", () => {
  it("404s before one is saved, then round-trips", async () => {
    await request(app).get("/api/profile").expect(404);
    await request(app).put("/api/profile").send(profile).expect(200);
    const res = await request(app).get("/api/profile").expect(200);
    expect(res.body.profile).toEqual(profile);
  });
  it("rejects a profile without a name", async () => {
    await request(app).put("/api/profile").send({ email: "x@y.z" }).expect(422);
  });
});

describe("files", () => {
  it("stores one resume, replaces it, downloads it", async () => {
    await request(app).put("/api/files/resume").attach("file", Buffer.from("%PDF-1 old"), { filename: "old.pdf", contentType: "application/pdf" }).expect(201);
    await request(app).put("/api/files/resume").attach("file", Buffer.from("%PDF-1 new"), { filename: "cv.pdf", contentType: "application/pdf" }).expect(201);
    const list = await request(app).get("/api/files").expect(200);
    expect(list.body).toEqual([expect.objectContaining({ kind: "resume", filename: "cv.pdf" })]);
    const dl = await request(app).get("/api/files/resume").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/pdf");
    expect((dl.body as Buffer).toString()).toBe("%PDF-1 new");
  });
  it("rejects unknown kinds and non-documents", async () => {
    await request(app).get("/api/files/passport").expect(404);
    await request(app).put("/api/files/resume").attach("file", Buffer.from("x"), { filename: "a.png", contentType: "image/png" }).expect(415);
  });
});

describe("runs and corrections", () => {
  const start = () => request(app).post("/api/runs").send({ url: "https://jobs.lever.co/acme/1/apply", company: "acme", platform: "lever" });

  it("logs accepted and edited steps; edits become corrections with the screenshot", async () => {
    await request(app).put("/api/profile").send(profile);
    const run = (await start().expect(201)).body;
    const proposed = { action: "type", mark: 1, value: "Jane" };
    await request(app).post(`/api/runs/${run._id}/steps`).send({ marks: [1, 2], proposed, decision: "accepted" }).expect(201);
    const edited = await request(app)
      .post(`/api/runs/${run._id}/steps`)
      .send({
        marks: [1, 2],
        history: [proposed],
        proposed: { action: "skip", mark: 2 },
        decision: "edited",
        final: { action: "type", mark: 2, value: "Doe" },
        screenshot: `data:image/png;base64,${PNG_B64}`,
      })
      .expect(201);
    expect(edited.body.correctionId).toBeTruthy();

    const full = (await request(app).get(`/api/runs/${run._id}`).expect(200)).body;
    expect(full.counts).toEqual({ steps: 2, accepted: 1, edited: 1, overridden: 0 });
    expect(full.steps.map((s: { index: number }) => s.index)).toEqual([0, 1]);

    const exp = await request(app).get("/api/corrections/export").expect(200);
    const lines = exp.text.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ final: { action: "type", mark: 2, value: "Doe" }, profile, screenshot: PNG_B64 });

    const stats = (await request(app).get("/api/stats").expect(200)).body;
    expect(stats).toMatchObject({ rate: 0.5, corrections: 1, runs: 1, totals: { steps: 2, accepted: 1, edited: 1 } });
  });

  it("skipping a proposed skip or a no-change edit is an accept, not a correction", async () => {
    const run = (await start()).body;
    const skip = { action: "skip", mark: 4 };
    const a = await request(app).post(`/api/runs/${run._id}/steps`).send({ proposed: skip, decision: "overridden" }).expect(201);
    const b = await request(app).post(`/api/runs/${run._id}/steps`).send({ proposed: { action: "type", mark: 5, value: "x" }, decision: "edited", final: { action: "type", mark: 5, value: "x" } }).expect(201);
    expect([a.body.decision, b.body.decision]).toEqual(["accepted", "accepted"]);
    expect([a.body.correctionId, b.body.correctionId]).toEqual([null, null]);
    expect((await request(app).get(`/api/runs/${run._id}`)).body.counts).toMatchObject({ accepted: 2, edited: 0, overridden: 0 });
  });

  it("an override without a final action records a skip", async () => {
    const run = (await start()).body;
    const res = await request(app).post(`/api/runs/${run._id}/steps`).send({ proposed: { action: "click", mark: 7 }, decision: "overridden" }).expect(201);
    expect(res.body.final).toMatchObject({ action: "skip", mark: 7 });
  });

  it("validates actions and refuses steps on a finished run", async () => {
    const run = (await start()).body;
    await request(app).post(`/api/runs/${run._id}/steps`).send({ proposed: { action: "type", mark: 1 }, decision: "accepted" }).expect(422);
    await request(app).post(`/api/runs/${run._id}/steps`).send({ proposed: { action: "upload", mark: 1, value: "passport" }, decision: "accepted" }).expect(422);
    await request(app).post(`/api/runs/${run._id}/steps`).send({ proposed: { action: "skip", mark: 1 }, decision: "edited" }).expect(422);
    await request(app).post(`/api/runs/${run._id}/finish`).send({ status: "submitted" }).expect(200);
    await request(app).post(`/api/runs/${run._id}/finish`).send({ status: "abandoned" }).expect(409);
    await request(app).post(`/api/runs/${run._id}/steps`).send({ proposed: { action: "done" }, decision: "accepted" }).expect(409);
    await request(app).get("/api/runs/not-an-id").expect(404);
  });
});

describe("act proxy", () => {
  const body = { screenshot: PNG_B64, marks: [1], history: [] };

  it("needs a profile, then forwards it to the model server", async () => {
    await request(app).post("/api/act").send(body).expect(409);
    await request(app).put("/api/profile").send(profile);
    fakeFetch.mockResolvedValue(new Response(JSON.stringify({ action: "type", mark: 1, value: "Jane" }), { status: 200 }));
    const res = await request(app).post("/api/act").send(body).expect(200);
    expect(res.body).toMatchObject({ action: "type", mark: 1 });
    const [url, init] = fakeFetch.mock.calls[0];
    expect(url).toBe("http://model.test/act");
    expect(JSON.parse(init.body)).toMatchObject({ profile, marks: [1] });
  });

  it("maps upstream failures", async () => {
    await request(app).put("/api/profile").send(profile);
    fakeFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await request(app).post("/api/act").send(body).expect(502);
    fakeFetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "bad image" }), { status: 422 }));
    await request(app).post("/api/act").send(body).expect(422);
    fakeFetch.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await request(app).post("/api/act").send(body).expect(502);
  });
});
