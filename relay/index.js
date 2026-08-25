import express from "express";
import Redis from "ioredis";
import pg from "pg";

const CHANNEL = "lane.orders";
const PORT = Number(process.env.PORT || 8001);
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://lane:lane@postgres:5432/lane";
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379/0";
const FAIL_RATE = Number(process.env.RELAY_FAIL_RATE || "0");
const MAX_ATTEMPTS = 5;

const pool = new pg.Pool({ connectionString: DATABASE_URL });

function messageFor(event) {
  const id = event.order_id;
  const rider = event.rider_user_id;
  if (event.payment_event_id) return `Payment recorded for order #${id}`;
  if (event.status === "accepted") return `Store accepted order #${id}`;
  if (event.status === "rejected") return `Store rejected order #${id}`;
  if (event.status === "preparing" && rider) return `Rider ${rider} claimed order #${id}`;
  if (event.status === "preparing") return `Kitchen is preparing order #${id}`;
  if (event.status === "out_for_delivery") return `Order #${id} is out for delivery`;
  if (event.status === "delivered") return `Order #${id} was delivered`;
  return `Order #${id} is ${event.status}`;
}

function shouldNotify(event) {
  if (event.payment_event_id) return true;
  return ["accepted", "rejected", "preparing", "out_for_delivery", "delivered"].includes(event.status);
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_jobs (
      id SERIAL PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      order_id INTEGER NOT NULL,
      customer_user_id INTEGER,
      store_id INTEGER,
      rider_user_id INTEGER,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      body TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function enqueue(event) {
  if (!shouldNotify(event)) return;
  const rider = event.rider_user_id ?? 0;
  const key = `order:${event.order_id}:status:${event.status}:rider:${rider}:email`;
  const body = `${messageFor(event)} - to ${event.customer_email || "customer"}`;
  await pool.query(
    `INSERT INTO relay_jobs (
        idempotency_key, order_id, customer_user_id, store_id, rider_user_id,
        channel, status, body
      ) VALUES ($1,$2,$3,$4,$5,'email',$6,$7)
      ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      key,
      event.order_id,
      event.customer_user_id ?? null,
      event.store_id ?? null,
      event.rider_user_id ?? null,
      event.status,
      body,
    ],
  );
}

function mockProviderSend(job) {
  if (Math.random() < FAIL_RATE) {
    throw new Error("mock provider timeout");
  }
  console.log(`[relay] sent ${job.channel} job=${job.id} order=${job.order_id} ${job.body}`);
}

async function processOne() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const picked = await client.query(
      `SELECT * FROM relay_jobs
       WHERE state IN ('pending', 'retrying') AND next_attempt_at <= NOW()
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    if (!picked.rowCount) {
      await client.query("COMMIT");
      return false;
    }
    const job = picked.rows[0];
    const attempts = job.attempts + 1;
    try {
      mockProviderSend(job);
      await client.query(
        `UPDATE relay_jobs
         SET state = 'sent', attempts = $2, last_error = NULL, updated_at = NOW()
         WHERE id = $1`,
        [job.id, attempts],
      );
    } catch (err) {
      const dead = attempts >= MAX_ATTEMPTS;
      const delaySec = 2 ** attempts;
      await client.query(
        `UPDATE relay_jobs
         SET state = $2, attempts = $3, last_error = $4,
             next_attempt_at = NOW() + ($5 * INTERVAL '1 second'),
             updated_at = NOW()
         WHERE id = $1`,
        [job.id, dead ? "dead" : "retrying", attempts, String(err.message), delaySec],
      );
      console.log(`[relay] ${dead ? "dead" : "retry"} job=${job.id} attempt=${attempts} ${err.message}`);
    }
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function workerLoop() {
  for (;;) {
    try {
      const worked = await processOne();
      if (!worked) await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.error("[relay] worker", err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const app = express();
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "relay", fail_rate: FAIL_RATE });
});

app.get("/jobs", async (req, res) => {
  const customerUserId = req.query.customer_user_id ? Number(req.query.customer_user_id) : null;
  const storeId = req.query.store_id ? Number(req.query.store_id) : null;
  const riderUserId = req.query.rider_user_id ? Number(req.query.rider_user_id) : null;
  const params = [];
  const clauses = [];
  if (customerUserId) {
    params.push(customerUserId);
    clauses.push(`customer_user_id = $${params.length}`);
  }
  if (storeId) {
    params.push(storeId);
    clauses.push(`store_id = $${params.length}`);
  }
  if (riderUserId) {
    params.push(riderUserId);
    clauses.push(`rider_user_id = $${params.length}`);
  }
  if (!clauses.length) {
    return res.json({ relay: "live", jobs: [] });
  }
  const result = await pool.query(
    `SELECT id, order_id, channel, status, body, state, attempts, last_error, created_at
     FROM relay_jobs
     WHERE ${clauses.join(" OR ")}
     ORDER BY id DESC
     LIMIT 20`,
    params,
  );
  res.json({ relay: "live", jobs: result.rows });
});

async function main() {
  await ensureSchema();
  const sub = new Redis(REDIS_URL);
  sub.on("error", (err) => console.error("[relay] redis", err));
  await sub.subscribe(CHANNEL);
  sub.on("message", async (_channel, raw) => {
    try {
      await enqueue(JSON.parse(raw));
    } catch (err) {
      console.error("[relay] enqueue", err);
    }
  });
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[relay] http://0.0.0.0:${PORT} fail_rate=${FAIL_RATE}`);
  });
  workerLoop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
