import { MongoClient, type Db } from "mongodb";
import { createApp } from "./app.js";

/**
 * Env: MONGO_URL (default mongodb://127.0.0.1:27017), MONGO_DB (formpilot), PORT (4000),
 * INFERENCE_URL (http://127.0.0.1:8000, the FastAPI model server). Binds to 127.0.0.1 only: local, single user.
 */
export async function ensureIndexes(db: Db) {
  await db.collection("runs").createIndex({ startedAt: -1 });
  await db.collection("steps").createIndex({ runId: 1, index: 1 });
  await db.collection("steps").createIndex({ createdAt: 1 });
  await db.collection("corrections").createIndex({ createdAt: 1 });
}

const client = await MongoClient.connect(process.env.MONGO_URL ?? "mongodb://127.0.0.1:27017");
const db = client.db(process.env.MONGO_DB ?? "formpilot");
await ensureIndexes(db);
const app = createApp({ db, inferenceUrl: process.env.INFERENCE_URL ?? "http://127.0.0.1:8000" });
const port = Number(process.env.PORT ?? 4000);
app.listen(port, "127.0.0.1", () => console.log(`formpilot server on http://127.0.0.1:${port}`));
