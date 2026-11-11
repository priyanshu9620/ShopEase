// Per-client rate limiting (experiment 06): fixed 1-second window counter in Redis.
//
//   RATE_LIMIT_ENABLED=true   RATE_LIMIT_RPS=50
//
// Client key = X-Client-Id header if present (the lab's k6 users send one; in production you would
// key on the authenticated user or the real client IP behind the load balancer), else req.ip.
// Every replica shares the counter through Redis, so the limit holds across the whole fleet —
// that is the reason it is not an in-memory map. Fails open if Redis is unavailable.
import { redis, ready } from "./redis.js";
import { rateLimited } from "./metrics.js";

const enabled = () => (process.env.RATE_LIMIT_ENABLED || "false") === "true";
const limit = () => Number(process.env.RATE_LIMIT_RPS || 50);

export function rateLimit() {
  return async function rateLimitMiddleware(req, res, next) {
    if (!enabled() || !ready()) return next();
    const client = req.get("x-client-id") || req.ip;
    const key = `shopease:rl:${client}:${Math.floor(Date.now() / 1000)}`;
    try {
      const [count] = await redis.multi().incr(key).expire(key, 2).exec();
      res.set("X-RateLimit-Limit", String(limit()));
      res.set("X-RateLimit-Remaining", String(Math.max(0, limit() - count)));
      if (count > limit()) {
        rateLimited.labels((req.baseUrl || "") + req.path.replace(/\/[0-9a-f]{24}(\/|$)/g, "/:id$1")).inc();
        res.set("Retry-After", "1");
        return res.status(429).json({ success: false, message: "Too many requests" });
      }
    } catch {
      // Redis hiccup → fail open; availability over strictness for a shop
    }
    next();
  };
}
