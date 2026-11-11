// "photos" scenario (11-cdn): fetch product photos only, either through the app/ALB or from CloudFront.
//   MODE=alb  BASE_URL=http://<alb>          → GET /api/v1/product/product-photo/<id>  (bytes from Mongo via the app)
//   MODE=cdn  BASE_URL=http://<alb> CDN_URL=https://<dist>.cloudfront.net → GET <cdn>/photos/<id>.png
// Run from where the user sits (the laptop), because the CDN's whole point is distance to the edge.
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8081";
const CDN = (__ENV.CDN_URL || "").replace(/\/$/, "");
const MODE = __ENV.MODE || "alb";
const RATES = (__ENV.RATES || "5,10,20").split(",").map(Number);
const STEP_S = Number(__ENV.STEP_S || 30);
const OUT = __ENV.OUT || "";

export const options = {
  scenarios: { photos: { executor: "ramping-arrival-rate", startRate: RATES[0], timeUnit: "1s", preAllocatedVUs: 20, maxVUs: 500, stages: RATES.map((r) => ({ target: r, duration: `${STEP_S}s` })) } },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};
const photoRt = new Trend("photo_rt", true), ttfb = new Trend("photo_ttfb", true);

export function setup() {
  const ids = [];
  for (let p = 1; p <= 10; p++) { const r = http.get(`${BASE}/api/v1/product/product-list/${p}`); if (r.status === 200) for (const pr of r.json("products")) ids.push(pr._id); }
  if (!ids.length) throw new Error("no products");
  return { ids };
}

export default function (data) {
  const id = data.ids[Math.floor(Math.random() * data.ids.length)];
  const url = MODE === "cdn" ? `${CDN}/photos/${id}.png` : `${BASE}/api/v1/product/product-photo/${id}`;
  const res = http.get(url, { redirects: 3, tags: { mode: MODE } });
  photoRt.add(res.timings.duration); ttfb.add(res.timings.waiting);
  check(res, { "photo 200": (x) => x.status === 200, "is image": (x) => String(x.headers["Content-Type"] || "").startsWith("image/") });
}

export function handleSummary(data) {
  const v = (n) => (data.metrics[n] ? data.metrics[n].values : {});
  const text = ["", `${MODE}: requests ${v("http_reqs").count} (${(v("http_reqs").rate || 0).toFixed(1)}/s)  failed ${((v("http_req_failed").rate || 0) * 100).toFixed(2)} %`,
    `photo          p50 ${Math.round(v("photo_rt").med || 0)} ms   p95 ${Math.round(v("photo_rt")["p(95)"] || 0)} ms   p99 ${Math.round(v("photo_rt")["p(99)"] || 0)} ms   (ttfb p50 ${Math.round(v("photo_ttfb").med || 0)} ms)`, ""].join("\n");
  const out = { stdout: text };
  if (OUT) out[`${OUT}.k6.json`] = JSON.stringify(data, null, 1);
  return out;
}
