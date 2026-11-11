// "catalog" scenario: lookups that depend on indexes — product by slug, products by category, related.
// Used by 05-db-index. Same env knobs as browse.js (RATES, STEP_S, BASE_URL, OUT).
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8081";
const RATES = (__ENV.RATES || "50,100,200").split(",").map(Number);
const STEP_S = Number(__ENV.STEP_S || 60);
const OUT = __ENV.OUT || "";

export const options = {
  scenarios: {
    catalog: {
      executor: "ramping-arrival-rate",
      startRate: RATES[0], timeUnit: "1s", preAllocatedVUs: 50, maxVUs: 2000,
      stages: RATES.map((r) => ({ target: r, duration: `${STEP_S}s` })),
    },
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// NOTE: /product-category/:slug is left out on purpose — it returns every product in the category
// including photo bytes (an app-level issue: ~4,000 docs × photo at 50k products), which would measure
// payload size, not indexing.
const byRoute = { product: new Trend("rt_product", true), related: new Trend("rt_related", true) };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function setup() {
  const products = [];
  for (let p = 1; p <= 40; p++) {
    const r = http.get(`${BASE}/api/v1/product/product-list/${p}`);
    if (r.status === 200) for (const pr of r.json("products")) products.push({ id: pr._id, slug: pr.slug, cid: pr.category });
  }
  const cats = http.get(`${BASE}/api/v1/category/get-category`).json("category").map((c) => c.slug);
  if (!products.length) throw new Error(`no products behind ${BASE}; run the seed first`);
  return { products, cats };
}

export default function (data) {
  const r = Math.random();
  let res, t;
  if (r < 0.7) {         // 70 % product page by slug  → findOne({slug})
    res = http.get(`${BASE}/api/v1/product/get-product/${pick(data.products).slug}`, { tags: { route: "product" } }); t = byRoute.product;
  } else {               // 30 % related products      → find({category, _id≠}).limit(3)
    const p = pick(data.products);
    res = http.get(`${BASE}/api/v1/product/related-product/${p.id}/${p.cid}`, { tags: { route: "related" } }); t = byRoute.related;
  }
  t.add(res.timings.duration);
  check(res, { "status 200": (x) => x.status === 200 });
}

export function handleSummary(data) {
  const m = data.metrics, f = (n) => (m[n] ? m[n].values : {});
  const line = (n, v) => `${n.padEnd(14)} p50 ${Math.round(v.med || 0)} ms   p95 ${Math.round(v["p(95)"] || 0)} ms   p99 ${Math.round(v["p(99)"] || 0)} ms`;
  const text = ["", `requests ${f("http_reqs").count}  (${(f("http_reqs").rate || 0).toFixed(1)}/s avg)   failed ${((f("http_req_failed").rate || 0) * 100).toFixed(2)} %`, line("all", f("http_req_duration")), ...Object.keys(byRoute).map((k) => line(k, f(`rt_${k}`))), ""].join("\n");
  const out = { stdout: text };
  if (OUT) out[`${OUT}.k6.json`] = JSON.stringify(data, null, 1);
  return out;
}
