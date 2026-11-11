// "oversell" scenario (09-concurrency): ROUNDS times, set one product's stock to 1 and let VUS buyers
// hit "buy" at the same instant. Correct behaviour sells exactly 1 per round.
//   VUS=200 ROUNDS=20
import http from "k6/http";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8081";
const VUS = Number(__ENV.VUS || 200);
const ROUNDS = Number(__ENV.ROUNDS || 20);
const OUT = __ENV.OUT || "";

export const options = {
  scenarios: { buyers: { executor: "per-vu-iterations", vus: VUS, iterations: ROUNDS, maxDuration: "10m" } },
};
const sold = new Counter("sold"), soldOut = new Counter("sold_out"), rounds = new Counter("rounds");

export function setup() {
  const pid = http.get(`${BASE}/api/v1/product/product-list/1`).json("products")[0]._id;
  return { pid };
}

// Every VU runs ROUNDS iterations; iteration i of all VUs = round i. VU 1 resets stock at the start of
// each round and all VUs wait on a short barrier (sleep until the next 1.5 s boundary) so they fire together.
export default function (data) {
  const round = __ITER;
  if (__VU === 1) {
    http.post(`${BASE}/api/v1/lab/stock/${data.pid}`, JSON.stringify({ quantity: 1 }), { headers: { "Content-Type": "application/json" } });
    rounds.add(1);
  }
  const period = 1500, now = Date.now();
  const target = Math.ceil(now / period) * period + 300;         // same wall-clock instant for every VU
  while (Date.now() < target) { /* spin: keep the fire-together tight */ }
  const r = http.post(`${BASE}/api/v1/lab/buy/${data.pid}`, null, { tags: { round: String(round) } });
  if (r.status === 200) sold.add(1); else if (r.status === 409) soldOut.add(1);
}

export function handleSummary(data) {
  const c = (n) => (data.metrics[n] ? data.metrics[n].values.count : 0);
  const text = ["", `rounds ${c("rounds")}   units in stock per round 1   sold ${c("sold")}   sold-out responses ${c("sold_out")}   OVERSOLD by ${c("sold") - c("rounds")}`, ""].join("\n");
  const out = { stdout: text };
  if (OUT) out[`${OUT}.k6.json`] = JSON.stringify(data, null, 1);
  return out;
}
