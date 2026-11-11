// "checkout" scenario (07-async-queue, 08-circuit-breaker): logged-in buyers paying for a 2-item cart.
// Requires PAYMENT_MOCK=true on the app (the real Braintree sandbox is not meant for load).
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8081";
const RATES = (__ENV.RATES || "5,10,20").split(",").map(Number);
const STEP_S = Number(__ENV.STEP_S || 60);
const OUT = __ENV.OUT || "";

export const options = {
  scenarios: { checkout: { executor: "ramping-arrival-rate", startRate: RATES[0], timeUnit: "1s", preAllocatedVUs: 50, maxVUs: 2000, stages: RATES.map((r) => ({ target: r, duration: `${STEP_S}s` })) } },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};
const checkoutRt = new Trend("checkout_rt", true);

export function setup() {
  const login = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ email: __ENV.BUYER_EMAIL || "buyer@shopease.local", password: __ENV.BUYER_PASSWORD || "buyer123" }), { headers: { "Content-Type": "application/json" } });
  const token = login.json("token");
  if (!token) throw new Error("buyer login failed; seed first");
  const products = http.get(`${BASE}/api/v1/product/product-list/1`).json("products").map((p) => ({ _id: p._id, price: p.price }));
  return { token, products };
}

export default function (data) {
  const cart = [data.products[Math.floor(Math.random() * data.products.length)], data.products[Math.floor(Math.random() * data.products.length)]];
  const res = http.post(`${BASE}/api/v1/product/braintree/payment`, JSON.stringify({ nonce: "fake-valid-nonce", cart }), { headers: { "Content-Type": "application/json", Authorization: data.token }, timeout: "30s" });
  checkoutRt.add(res.timings.duration);
  check(res, { "order placed": (x) => x.status === 200 });
}

export function handleSummary(data) {
  const v = (n) => (data.metrics[n] ? data.metrics[n].values : {});
  const text = ["", `checkouts ${v("http_reqs").count}  (${(v("http_reqs").rate || 0).toFixed(1)}/s)   failed ${((v("http_req_failed").rate || 0) * 100).toFixed(2)} %`, `checkout       p50 ${Math.round(v("checkout_rt").med || 0)} ms   p95 ${Math.round(v("checkout_rt")["p(95)"] || 0)} ms   p99 ${Math.round(v("checkout_rt")["p(99)"] || 0)} ms`, ""].join("\n");
  const out = { stdout: text };
  if (OUT) out[`${OUT}.k6.json`] = JSON.stringify(data, null, 1);
  return out;
}
