import express from "express";
import colors from "colors";
import dotenv from "dotenv";
import morgan from "morgan";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoute.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import cors from "cors";
import mongoose from "mongoose";
import { httpMetricsMiddleware, metricsHandler } from "./lib/metrics.js";
import { status as redisStatus } from "./lib/redis.js";
import { rateLimit } from "./lib/ratelimit.js";
import labRoutes from "./routes/labRoutes.js";
import { attachRealtime } from "./lib/realtime.js";
// this path is used for deployment
import path from 'path';
import {fileURLToPath} from 'url';

//configure env
dotenv.config();

//databse config
connectDB();

//es module fix
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

//rest object
const app = express();

//middelwares
app.use(cors());
app.use(express.json());
// request logs are noise under load; LOG_REQUESTS=true turns them back on
if (process.env.LOG_REQUESTS === "true" || process.env.DEV_MODE === "development") app.use(morgan("dev"));
app.use(httpMetricsMiddleware);
app.get("/metrics", metricsHandler);
//for deployment middleware 
app.use(express.static(path.join(__dirname,'./client/build')))

// liveness/readiness probe used by docker compose, the nginx/ALB health check and the lab runner.
// 200 only when Mongo answers a ping; reports the version + replica so rolling deploys are visible.
app.get("/healthz", async (req, res) => {
  let mongo = "down";
  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.db.admin().ping();
      mongo = "up";
    } catch (e) {
      mongo = "error";
    }
  }
  res.status(mongo === "up" ? 200 : 503).json({
    status: mongo === "up" ? "ok" : "degraded",
    version: process.env.APP_VERSION || "dev",
    replica: process.env.HOSTNAME || "local",
    mongo,
    redis: redisStatus(), // "off" when REDIS_URL is unset; never fails the probe (cache is optional)
    uptime_s: Math.round(process.uptime()),
  });
});

// lab: per-client rate limit on the API (experiment 06); no-op unless RATE_LIMIT_ENABLED=true
app.use("/api", rateLimit());

//routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/category", categoryRoutes);
app.use("/api/v1/product", productRoutes);
// lab-only endpoints (experiment 09); off unless LAB_ROUTES=true
if (process.env.LAB_ROUTES === "true") app.use("/api/v1/lab", labRoutes);

//rest api
//note this is a general route jo rehta hi hai welcome ke liye pheli baar khulega
//iske bina bhi kaam hoskta but ye acha lagne ke liye
app.get("/", (req, res) => {
  res.send("<h1>Welcome to ecommerce app</h1>");
});
//for deplyment api 
app.use("*",function(req,res){
  res.sendFile(path.join(__dirname,'./client/build/index.html'));
});

//PORT
const PORT = process.env.PORT || 8080;

//run listen
const server = app.listen(PORT, () => {
  console.log(
    `Server Running on ${process.env.DEV_MODE} mode on port ${PORT}`
  );
});

// Phase 4: socket.io on the same port (/socket.io), Redis adapter when REDIS_URL is set
attachRealtime(server).catch((e) => console.log(`realtime disabled: ${e.message}`));

// Graceful shutdown (experiment 04): on SIGTERM stop accepting new connections, let in-flight
// requests finish (up to GRACEFUL_TIMEOUT_MS), then exit. Docker sends SIGTERM on `stop`; without
// this, Node dies instantly and every in-flight request becomes an error during a deploy.
// GRACEFUL_SHUTDOWN=false reproduces the naive behaviour.
process.on("SIGTERM", () => {
  if ((process.env.GRACEFUL_SHUTDOWN || "true") !== "true") process.exit(0);
  console.log("SIGTERM: draining");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), Number(process.env.GRACEFUL_TIMEOUT_MS || 10000)).unref();
});
