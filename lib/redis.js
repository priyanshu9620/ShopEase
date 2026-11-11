// One shared Redis client (node-redis v4). Used by the cache layer, rate limiter, queue, socket.io
// adapter. Connects lazily; a Redis outage must never take the API down, so callers check `ready()`.
import { createClient } from "redis";

const url = process.env.REDIS_URL || "";
let client = null;
let connected = false;

if (url) {
  client = createClient({
    url,
    socket: { connectTimeout: 2000, reconnectStrategy: (retries) => Math.min(retries * 200, 5000) },
  });
  client.on("ready", () => { connected = true; });
  client.on("end", () => { connected = false; });
  client.on("error", (e) => { connected = false; if (process.env.DEV_MODE === "development") console.log(`redis: ${e.message}`); });
  client.connect().catch(() => {});
}

export const redis = client;
export const ready = () => Boolean(client && connected && client.isReady);
export const status = () => (!client ? "off" : ready() ? "up" : "down");
