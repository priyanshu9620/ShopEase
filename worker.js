// BullMQ worker for post-checkout jobs (experiment 07). Scaled with `--scale worker=N`.
//   node worker.js      env: REDIS_URL, MONGO_URL, POST_ORDER_WORK_MS, WORKER_CONCURRENCY (default 1)
// Exposes /metrics on :9100 (jobs processed, job duration) and /healthz.
import dotenv from "dotenv";
import http from "node:http";
import mongoose from "mongoose";
import { Worker } from "bullmq";
import client from "prom-client";
import { QUEUE_NAME, doPostOrderWork } from "./lib/postorder.js";

dotenv.config();
const registry = new client.Registry();
registry.setDefaultLabels({ worker: process.env.HOSTNAME || "local", experiment: process.env.LAB_EXPERIMENT || "", arm: process.env.LAB_ARM || "" });
client.collectDefaultMetrics({ register: registry });
const jobs = new client.Counter({ name: "worker_jobs_total", help: "jobs by result", labelNames: ["result"], registers: [registry] });
const jobLag = new client.Histogram({ name: "worker_job_wait_seconds", help: "time a job waited in the queue before a worker picked it up", buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60], registers: [registry] });

await mongoose.connect(process.env.MONGO_URL, { dbName: "ecommerce" });
const u = new URL(process.env.REDIS_URL || "redis://localhost:6379");
const worker = new Worker(QUEUE_NAME, async (job) => {
  jobLag.observe((Date.now() - job.timestamp) / 1000);
  await doPostOrderWork({ buyer: job.data.buyer, via: "queue" });
}, { connection: { host: u.hostname, port: Number(u.port || 6379) }, concurrency: Number(process.env.WORKER_CONCURRENCY || 1) });
worker.on("completed", () => jobs.labels("ok").inc());
worker.on("failed", () => jobs.labels("failed").inc());

http.createServer(async (req, res) => {
  if (req.url === "/metrics") { res.setHeader("Content-Type", registry.contentType); return res.end(await registry.metrics()); }
  res.end(JSON.stringify({ status: "ok", worker: process.env.HOSTNAME }));
}).listen(9100, () => console.log(`worker up: queue=${QUEUE_NAME} concurrency=${process.env.WORKER_CONCURRENCY || 1} metrics :9100`));
