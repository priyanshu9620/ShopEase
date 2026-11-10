// "browse" scenario: what a shopper does — list pages, open products, load photos, search, categories.
// Open-model load (constant/ramping arrival rate) so RPS is the knob and latency is the outcome.
//
//   RATES="50,100,200,400,800"  STEP_S=60   → one stage per rate, STEP_S seconds each
//   BASE_URL=http://nginx:80                 → set by compose
//   OUT=/experiments/01-caching/results/treatment-1   → handleSummary writes <OUT>.k6.json
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8081";
const RATES = (__ENV.RATES || "50,100,200").split(",").map(Number);
const STEP_S = Number(__ENV.STEP_S || 60);
const OUT = __ENV.OUT || "";

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-arrival-rate",
      startRate: RATES[0],
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 2000,
      stages: RATES.map((r) => ({ target: r, duration: `${STEP_S}s` })),
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  discardResponseBodies: false,
};

const byRoute = {
  list: new Trend("rt_list", true),
  product: new Trend("rt_product", true),
  photo: new Trend("rt_photo", true),
  search: new Trend("rt_search", true),
  categories: new Trend("rt_categories", true),
};
const KEYWORDS = ["lamp", "smart", "pro", "mini", "kettle", "jacket", "ultra", "novel"];

export function setup() {
  // sample some real products so product/photo requests hit existing ids
  const ids = [], slugs = [];
  for (let p = 1; p <= 20; p++) {
    const r = http.get(`${BASE}/api/v1/product/product-list/${p}`);
    if (r.status !== 200) continue;
    for (const pr of r.json("products")) { ids.push(pr._id); slugs.push(pr.slug); }
  }
  if (!ids.length) throw new Error(`no products behind ${BASE}; run the seed first`);
  return { ids, slugs };
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export default function (data) {
  const r = Math.random();
  let res, t;
  if (r < 0.30) {        // 30 % list pages (first pages are hottest, like a real catalogue)
    const page = Math.random() < 0.7 ? 1 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 50);
    res = http.get(`${BASE}/api/v1/product/product-list/${page}`, { tags: { route: "list" } }); t = byRoute.list;
  } else if (r < 0.50) { // 20 % product page
    res = http.get(`${BASE}/api/v1/product/get-product/${pick(data.slugs)}`, { tags: { route: "product" } }); t = byRoute.product;
  } else if (r < 0.85) { // 35 % photos (several per page view in the real UI)
    res = http.get(`${BASE}/api/v1/product/product-photo/${pick(data.ids)}`, { tags: { route: "photo" } }); t = byRoute.photo;
  } else if (r < 0.95) { // 10 % search
    res = http.get(`${BASE}/api/v1/product/search/${pick(KEYWORDS)}`, { tags: { route: "search" } }); t = byRoute.search;
  } else {               //  5 % category list
    res = http.get(`${BASE}/api/v1/category/get-category`, { tags: { route: "categories" } }); t = byRoute.categories;
  }
  t.add(res.timings.duration);
  check(res, { "status 200": (x) => x.status === 200 });
}

export function handleSummary(data) {
  const out = { stdout: textSummary(data) };
  if (OUT) out[`${OUT}.k6.json`] = JSON.stringify(data, null, 1);
  return out;
}

function textSummary(d) {
  const m = d.metrics;
  const f = (n) => (m[n] ? m[n].values : {});
  const line = (n, v) => `${n.padEnd(14)} p50 ${Math.round(v.med || 0)} ms   p95 ${Math.round(v["p(95)"] || 0)} ms   p99 ${Math.round(v["p(99)"] || 0)} ms`;
  return [
    "",
    `requests ${f("http_reqs").count}  (${(f("http_reqs").rate || 0).toFixed(1)}/s avg)   failed ${((f("http_req_failed").rate || 0) * 100).toFixed(2)} %`,
    line("all", f("http_req_duration")),
    ...Object.keys(byRoute).map((k) => line(k, f(`rt_${k}`))),
    "",
  ].join("\n");
}
