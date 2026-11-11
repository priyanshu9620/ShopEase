// Prometheus metrics for the app. Scraped at GET /metrics by the lab's Prometheus.
//
// Every series carries three default labels so Grafana can split lines without any query change:
//   replica     – container hostname (one line per replica in "scale-out")
//   experiment  – LAB_EXPERIMENT env set by the lab runner ("" outside the lab)
//   arm         – LAB_ARM env: "baseline" | "treatment" ("" outside the lab)
import client from "prom-client";

export const registry = new client.Registry();
registry.setDefaultLabels({
  replica: process.env.HOSTNAME || "local",
  experiment: process.env.LAB_EXPERIMENT || "",
  arm: process.env.LAB_ARM || "",
});
client.collectDefaultMetrics({ register: registry }); // CPU, memory, event-loop lag, GC

// --- HTTP ---------------------------------------------------------------------------------
export const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency by route",
  labelNames: ["method", "route", "status"],
  // 1 ms … 10 s; dense around the 50–500 ms region where the experiments live
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 2.5, 5, 10],
  registers: [registry],
});
export const httpInFlight = new client.Gauge({
  name: "http_requests_in_flight",
  help: "Requests currently being handled",
  registers: [registry],
});
export const appInfo = new client.Gauge({
  name: "app_info",
  help: "Static app info; value is always 1",
  labelNames: ["version"],
  registers: [registry],
});
appInfo.labels(process.env.APP_VERSION || "dev").set(1);

// --- cache (lib/cache.js) -------------------------------------------------------------------
export const cacheOps = new client.Counter({
  name: "cache_ops_total",
  help: "Cache lookups by outcome",
  labelNames: ["route", "result"], // result: hit | miss | bypass | error
  registers: [registry],
});

// --- rate limiting (lib/ratelimit.js) -------------------------------------------------------
export const rateLimited = new client.Counter({
  name: "rate_limited_total",
  help: "Requests rejected with 429 by the rate limiter",
  labelNames: ["route"],
  registers: [registry],
});

// --- payments (lib/payments.js), queue (lib/postorder.js) — experiments 07/08 -----------------
export const paymentCalls = new client.Counter({ name: "payment_calls_total", help: "payment gateway calls by result", labelNames: ["result"], registers: [registry] });
export const paymentDuration = new client.Histogram({ name: "payment_call_duration_seconds", help: "payment gateway call latency", buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30], registers: [registry] });
export const breakerState = new client.Gauge({ name: "payment_breaker_state", help: "0 closed, 1 half-open, 2 open", registers: [registry] });
export const queueDepth = new client.Gauge({ name: "post_order_queue_depth", help: "jobs waiting in the post-order queue", registers: [registry] });
export const postOrderDuration = new client.Histogram({ name: "post_order_work_seconds", help: "post-checkout work duration", labelNames: ["via"], buckets: [0.1, 0.25, 0.5, 1, 2.5], registers: [registry] });

// --- concurrency control (routes/labRoutes.js) — experiment 09 -------------------------------
export const oversellSales = new client.Counter({ name: "lab_buy_total", help: "lab buy attempts by mode and outcome", labelNames: ["mode", "outcome"], registers: [registry] });

// --- realtime (lib/realtime.js), photos (lib/photos.js) — Phase 4 -----------------------------
export const socketConnections = new client.Gauge({ name: "socket_connections", help: "open socket.io connections on this replica", registers: [registry] });
export const realtimeEvents = new client.Counter({ name: "realtime_events_total", help: "events emitted", labelNames: ["event"], registers: [registry] });
export const photoRedirects = new client.Counter({ name: "photo_cdn_redirects_total", help: "product-photo requests redirected to the CDN", registers: [registry] });

// Route label: the Express route pattern (e.g. /api/v1/product/product-list/:page), never the raw
// URL — otherwise every product id / keyword becomes its own series (cardinality explosion).
function routeLabel(req) {
  if (req.route) return (req.baseUrl || "") + (req.route.path === "/" ? "" : req.route.path);
  if (req.path === "/healthz" || req.path === "/metrics") return req.path;
  if (req.path.startsWith("/static/")) return "/static/*";
  return "other";
}

const REPLICA = process.env.HOSTNAME || "local";

export function httpMetricsMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  httpInFlight.inc();
  res.set("X-Replica", REPLICA); // lets curl / k6 show which replica answered (scale-out, failover)
  res.on("finish", () => {
    httpInFlight.dec();
    end({ method: req.method, route: routeLabel(req), status: String(res.statusCode) });
  });
  next();
}

export async function metricsHandler(req, res) {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
}
