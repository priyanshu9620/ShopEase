// Real-time fan-out measurement (experiment 12). Opens SOCKETS connections as the buyer (spread over
// the replicas by the load balancer), then, as admin, flips one of the buyer's orders to a new status
// through the API and measures how long each socket takes to receive "order:status".
//
//   BASE_URL=http://nginx:80 SOCKETS=500 ROUNDS=5 OUT=/experiments/12-realtime/results/three-1 node lab/realtime/fanout.js
//
// Writes <OUT>.k6.json in the same shape the lab runner reads (custom metrics with .values), so the
// generic report works: delivery_ms (trend), received (count), sockets (count), lost (count).
import { io } from "socket.io-client";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:8081";
const SOCKETS = Number(process.env.SOCKETS || 200);
const ROUNDS = Number(process.env.ROUNDS || 5);
const OUT = process.env.OUT || "";
const STATUSES = ["Processing", "Shipped", "deliverd", "Not Process"];

async function post(path, body, token) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { Authorization: token } : {}) }, body: JSON.stringify(body) });
  return r.json();
}
async function put(path, body, token) {
  const r = await fetch(`${BASE}${path}`, { method: "PUT", headers: { "content-type": "application/json", Authorization: token }, body: JSON.stringify(body) });
  return r.json();
}
async function get(path, token) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: token } });
  return r.json();
}
const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null; };

const buyer = await post("/api/v1/auth/login", { email: process.env.BUYER_EMAIL || "buyer@shopease.local", password: process.env.BUYER_PASSWORD || "buyer123" });
const admin = await post("/api/v1/auth/login", { email: process.env.ADMIN_EMAIL || "admin@shopease.local", password: process.env.ADMIN_PASSWORD || "admin123" });
if (!buyer.token || !admin.token) throw new Error("login failed; seed first");
let orders = await get("/api/v1/auth/orders", buyer.token);
if (!orders.length) {
  // create one order through the (mock or sandbox) payment endpoint
  const p = (await (await fetch(`${BASE}/api/v1/product/product-list/1`)).json()).products[0];
  await post("/api/v1/product/braintree/payment", { nonce: "fake-valid-nonce", cart: [{ _id: p._id, price: p.price }] }, buyer.token);
  orders = await get("/api/v1/auth/orders", buyer.token);
}
const order = orders[0];
console.log(`buyer ${buyer.user._id}, order ${order._id}, opening ${SOCKETS} sockets → ${BASE}`);

const replicas = {};
const sockets = [];
let pending = null; // { sentAt, got: Map(socketIdx→ms) }
await Promise.all(Array.from({ length: SOCKETS }, (_, i) => new Promise((resolve) => {
  const s = io(BASE, { auth: { token: buyer.token }, transports: ["websocket"], path: "/socket.io", reconnection: false });
  s.on("hello", (h) => { replicas[h.replica] = (replicas[h.replica] || 0) + 1; resolve(); });
  s.on("order:status", () => { if (pending && !pending.got.has(i)) pending.got.set(i, Date.now() - pending.sentAt); });
  s.on("connect_error", (e) => { console.log(`socket ${i}: ${e.message}`); resolve(); });
  sockets.push(s);
})));
const connected = sockets.filter((s) => s.connected).length;
console.log(`connected ${connected}/${SOCKETS}; per replica: ${JSON.stringify(replicas)}`);

const delivery = [], roundsOut = [];
for (let r = 0; r < ROUNDS; r++) {
  const status = STATUSES[r % STATUSES.length];
  pending = { sentAt: Date.now(), got: new Map() };
  await put(`/api/v1/auth/order-status/${order._id}`, { status }, admin.token);
  await new Promise((res) => setTimeout(res, 2000)); // delivery window
  const ms = [...pending.got.values()];
  delivery.push(...ms);
  roundsOut.push({ round: r + 1, status, received: ms.length, lost: connected - ms.length, p50: q(ms, 0.5), p95: q(ms, 0.95), max: ms.length ? Math.max(...ms) : null });
  console.log(`round ${r + 1} (${status}): received ${ms.length}/${connected}  p50 ${q(ms, 0.5)} ms  p95 ${q(ms, 0.95)} ms  max ${ms.length ? Math.max(...ms) : "-"} ms`);
  pending = null;
}
sockets.forEach((s) => s.disconnect());

const received = roundsOut.reduce((a, r) => a + r.received, 0), lost = roundsOut.reduce((a, r) => a + r.lost, 0);
const summary = { sockets: connected, replicas, rounds: roundsOut, delivery_ms: { med: q(delivery, 0.5), "p(95)": q(delivery, 0.95), max: delivery.length ? Math.max(...delivery) : null }, received, lost };
console.log(`\nsockets ${connected} over ${Object.keys(replicas).length} replica(s); delivered ${received}/${received + lost}; delivery p50 ${summary.delivery_ms.med} ms, p95 ${summary.delivery_ms["p(95)"]} ms, max ${summary.delivery_ms.max} ms`);
if (OUT) {
  // k6-shaped so lab/runner/run.js summarizeK6 + report.mjs can read it
  const k6 = { metrics: { http_reqs: { values: { count: ROUNDS, rate: 0 } }, http_req_failed: { values: { rate: 0 } }, http_req_duration: { values: { med: 0, "p(95)": 0, "p(99)": 0 } },
    delivery_ms: { values: summary.delivery_ms }, received: { values: { count: received } }, lost: { values: { count: lost } }, sockets: { values: { count: connected } }, replicas_used: { values: { count: Object.keys(replicas).length } } }, fanout: summary };
  writeFileSync(`${OUT}.k6.json`, JSON.stringify(k6, null, 1));
}
process.exit(0);
