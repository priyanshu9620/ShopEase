// "abuse" scenario (06-rate-limit): 50 normal shoppers sharing NORMAL_RPS, plus ONE client hammering at
// ABUSER_RPS. Every request carries X-Client-Id so the limiter can tell them apart (k6 is one IP).
// Reports p95 and 429 % per class, which is the whole point: the abuser should get 429s, the
// normal users' latency should not move.
import http from "k6/http";
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8081";
const RATES = (__ENV.RATES || "200,200,200").split(",").map(Number); // normal users' total rps per stage
const STEP_S = Number(__ENV.STEP_S || 60);
const ABUSER_RPS = Number(__ENV.ABUSER_RPS || 300);
const OUT = __ENV.OUT || "";
const stages = RATES.map((r) => ({ target: r, duration: `${STEP_S}s` }));
const total = RATES.length * STEP_S;

export const options = {
  scenarios: {
    normal: { executor: "ramping-arrival-rate", exec: "normal", startRate: RATES[0], timeUnit: "1s", preAllocatedVUs: 50, maxVUs: 1000, stages },
    // abuser starts 1/3 of the way in so the "before" is visible on the chart
    abuser: { executor: "constant-arrival-rate", exec: "abuser", rate: ABUSER_RPS, timeUnit: "1s", preAllocatedVUs: 50, maxVUs: 1000, startTime: `${Math.floor(total / 3)}s`, duration: `${total - Math.floor(total / 3)}s` },
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const m = {
  normal_rt: new Trend("normal_rt", true), normal_429: new Rate("normal_429"), normal_ok: new Rate("normal_ok"),
  abuser_rt: new Trend("abuser_rt", true), abuser_429: new Rate("abuser_429"),
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function setup() {
  const slugs = [];
  for (let p = 1; p <= 10; p++) { const r = http.get(`${BASE}/api/v1/product/product-list/${p}`); if (r.status === 200) for (const pr of r.json("products")) slugs.push(pr.slug); }
  if (!slugs.length) throw new Error("no products; seed first");
  return { slugs };
}

function hit(data, clientId) {
  const r = Math.random();
  const url = r < 0.5 ? `${BASE}/api/v1/product/product-list/${1 + Math.floor(Math.random() * 5)}` : r < 0.8 ? `${BASE}/api/v1/product/get-product/${pick(data.slugs)}` : `${BASE}/api/v1/category/get-category`;
  return http.get(url, { headers: { "X-Client-Id": clientId }, tags: { client: clientId === "abuser" ? "abuser" : "normal" } });
}

export function normal(data) {
  const res = hit(data, `user-${1 + Math.floor(Math.random() * 50)}`);
  m.normal_rt.add(res.timings.duration); m.normal_429.add(res.status === 429); m.normal_ok.add(res.status === 200);
  check(res, { "normal user served": (x) => x.status === 200 });
}
export function abuser(data) {
  const res = hit(data, "abuser");
  m.abuser_rt.add(res.timings.duration); m.abuser_429.add(res.status === 429);
}

export function handleSummary(data) {
  const v = (n) => (data.metrics[n] ? data.metrics[n].values : {});
  const text = ["",
    `normal users : p95 ${Math.round(v("normal_rt")["p(95)"] || 0)} ms   429s ${((v("normal_429").rate || 0) * 100).toFixed(2)} %   served ${((v("normal_ok").rate || 0) * 100).toFixed(1)} %`,
    `abuser       : p95 ${Math.round(v("abuser_rt")["p(95)"] || 0)} ms   429s ${((v("abuser_429").rate || 0) * 100).toFixed(1)} %`,
    ""].join("\n");
  const out = { stdout: text };
  if (OUT) out[`${OUT}.k6.json`] = JSON.stringify(data, null, 1);
  return out;
}
