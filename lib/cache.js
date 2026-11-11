// Cache-aside at the HTTP layer (experiment 01-caching).
//
//   router.get("/product-list/:page", cached("products", 60), productListController)
//   router.post("/create-product", ..., createProductController, invalidate("products"))
//
// Read path:  key = shopease:<ns>:v<version>:<method>:<url>  → hit: replay stored status/content-type/body
//                                                           → miss: let the controller run, store the 2xx response
// Write path: invalidate(ns) bumps shopease:<ns>:version after the response, so every old key is orphaned
//             (expires by TTL) without a KEYS/SCAN sweep. Namespaces: "products", "categories".
//
// CACHE_ENABLED=false (the baseline arm) makes both middlewares pass-through; the counter records "bypass"
// so the dashboard shows the arm is really uncached.
import { redis, ready } from "./redis.js";
import { cacheOps } from "./metrics.js";

const PREFIX = "shopease";
const enabled = () => (process.env.CACHE_ENABLED || "false") === "true";

async function version(ns) {
  // absent key reads as 0 so the first INCR (→ 1) really changes the key prefix
  const v = await redis.get(`${PREFIX}:${ns}:version`);
  return v || "0";
}

export function cached(ns, ttlSeconds = 60) {
  return async function cacheMiddleware(req, res, next) {
    const route = (req.baseUrl || "") + (req.route?.path || req.path);
    if (!enabled() || !ready()) {
      cacheOps.labels(route, "bypass").inc();
      return next();
    }
    let key;
    try {
      // POST endpoints used for reads (product-filters) key on the body too
      const bodyPart = req.method === "GET" ? "" : ":" + JSON.stringify(req.body || {});
      key = `${PREFIX}:${ns}:v${await version(ns)}:${req.method}:${req.originalUrl}${bodyPart}`;
      const hit = await redis.get(key);
      if (hit) {
        const { status, type, body, b64 } = JSON.parse(hit);
        cacheOps.labels(route, "hit").inc();
        res.set("X-Cache", "HIT");
        if (type) res.set("Content-Type", type);
        return res.status(status).send(b64 ? Buffer.from(body, "base64") : body);
      }
    } catch (e) {
      cacheOps.labels(route, "error").inc();
      return next();
    }
    cacheOps.labels(route, "miss").inc();
    res.set("X-Cache", "MISS");

    // Wrap res.send once; res.json and res.sendFile-free handlers all end up here.
    const send = res.send.bind(res);
    res.send = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300 && body != null) {
        const isBuf = Buffer.isBuffer(body);
        const payload = JSON.stringify({
          status: res.statusCode,
          type: res.get("Content-Type"),
          body: isBuf ? body.toString("base64") : typeof body === "string" ? body : JSON.stringify(body),
          b64: isBuf,
        });
        redis.set(key, payload, { EX: ttlSeconds }).catch(() => {});
      }
      return send(body);
    };
    next();
  };
}

// Runs AFTER the controller (mount it last on write routes). Bumps the namespace version even if the
// controller already sent the response — invalidation is fire-and-forget.
export function invalidate(...namespaces) {
  return function invalidateMiddleware(req, res, next) {
    res.on("finish", () => {
      if (!enabled() || !ready() || res.statusCode >= 300) return;
      for (const ns of namespaces) redis.incr(`${PREFIX}:${ns}:version`).catch(() => {});
    });
    next();
  };
}
