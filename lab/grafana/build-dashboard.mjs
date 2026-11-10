// Generates lab/grafana/dashboards/lab.json (the single provisioned dashboard, D-19).
//   node lab/grafana/build-dashboard.mjs
// Edit the ROWS table below to add a panel for a new experiment; never hand-edit the JSON.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = `job="app",route!~"/healthz|/metrics|/static/.*|other"`;
const RATE = "15s";

// --- panel helpers -------------------------------------------------------------------------
let id = 1;
const ts = (title, targets, opts = {}) => ({
  id: id++, type: "timeseries", title,
  gridPos: { h: opts.h || 8, w: opts.w || 8, x: 0, y: 0 },
  datasource: { type: "prometheus", uid: "prometheus" },
  fieldConfig: { defaults: { unit: opts.unit || "short", min: opts.min ?? 0, custom: { lineWidth: 2, fillOpacity: 8, showPoints: "never" }, ...(opts.max != null ? { max: opts.max } : {}) }, overrides: [] },
  options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } },
  targets: targets.map(([expr, legend], i) => ({ refId: String.fromCharCode(65 + i), expr, legendFormat: legend })),
});
const stat = (title, targets, opts = {}) => ({
  ...ts(title, targets, opts), type: "stat",
  options: { reduceOptions: { calcs: [opts.calc || "lastNotNull"], fields: "", values: false }, textMode: opts.textMode || "value", colorMode: "value", graphMode: "none" },
});
const state = (title, targets, opts = {}) => ({
  ...ts(title, targets, opts), type: "state-timeline",
  options: { showValue: "always", mergeValues: true, rowHeight: 0.8 },
});
const row = (title, collapsed = false) => ({ id: id++, type: "row", title, collapsed, gridPos: { h: 1, w: 24, x: 0, y: 0 }, panels: [] });

// --- the dashboard -------------------------------------------------------------------------
const ROWS = [
  ["Overview", false, [
    stat("Running now", [[`count by (experiment, arm) (app_info{job="app"})`, "{{experiment}} / {{arm}}"]], { w: 6, h: 4, textMode: "name" }),
    stat("Replicas up", [[`count(up{job="app"} == 1)`, "replicas"]], { w: 3, h: 4 }),
    stat("RPS", [[`sum(rate(http_request_duration_seconds_count{${APP}}[${RATE}]))`, "rps"]], { w: 3, h: 4, unit: "reqps" }),
    stat("p95", [[`histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{${APP}}[${RATE}])))`, "p95"]], { w: 3, h: 4, unit: "s" }),
    stat("Error %", [[`100 * sum(rate(http_request_duration_seconds_count{${APP},status=~"5.."}[${RATE}])) / sum(rate(http_request_duration_seconds_count{${APP}}[${RATE}]))`, "err"]], { w: 3, h: 4, unit: "percent" }),
    stat("Cache hit %", [[`100 * sum(rate(cache_ops_total{result="hit"}[30s])) / sum(rate(cache_ops_total{result=~"hit|miss"}[30s]))`, "hit"]], { w: 3, h: 4, unit: "percent", max: 100 }),
    stat("App version", [[`count by (version) (app_info{job="app"})`, "{{version}}"]], { w: 3, h: 4, textMode: "name" }),
    ts("Requests / s  (by arm)", [[`sum by (arm) (rate(http_request_duration_seconds_count{${APP}}[${RATE}]))`, "arm={{arm}}"]], { unit: "reqps" }),
    ts("Latency p50 / p95 / p99  (by arm)", [
      [`histogram_quantile(0.50, sum by (le, arm) (rate(http_request_duration_seconds_bucket{${APP}}[${RATE}])))`, "p50 arm={{arm}}"],
      [`histogram_quantile(0.95, sum by (le, arm) (rate(http_request_duration_seconds_bucket{${APP}}[${RATE}])))`, "p95 arm={{arm}}"],
      [`histogram_quantile(0.99, sum by (le, arm) (rate(http_request_duration_seconds_bucket{${APP}}[${RATE}])))`, "p99 arm={{arm}}"],
    ], { unit: "s" }),
    ts("Errors %  (5xx)", [[`100 * sum by (arm) (rate(http_request_duration_seconds_count{${APP},status=~"5.."}[${RATE}])) / sum by (arm) (rate(http_request_duration_seconds_count{${APP}}[${RATE}]))`, "arm={{arm}}"]], { unit: "percent", max: 100 }),
    ts("Requests / s per replica", [[`sum by (replica) (rate(http_request_duration_seconds_count{${APP}}[${RATE}]))`, "{{replica}}"]], { unit: "reqps", w: 12 }),
    ts("p95 per route", [[`histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{${APP}}[${RATE}])))`, "{{route}}"]], { unit: "s", w: 12 }),
  ]],
  ["01 · Caching", true, [
    ts("Cache hit ratio", [[`sum by (arm) (rate(cache_ops_total{result="hit"}[30s])) / sum by (arm) (rate(cache_ops_total{result=~"hit|miss"}[30s]))`, "arm={{arm}}"]], { unit: "percentunit", max: 1 }),
    ts("Cache ops / s by result", [[`sum by (result) (rate(cache_ops_total[${RATE}]))`, "{{result}}"]], { unit: "ops" }),
    ts("MongoDB ops / s", [[`sum by (type) (rate(mongodb_op_counters_total{type=~"query|getmore|insert|update|delete"}[${RATE}]))`, "{{type}}"]], { unit: "ops" }),
    ts("Redis commands / s", [[`rate(redis_commands_processed_total[${RATE}])`, "commands"]], { unit: "ops" }),
    ts("Redis memory", [[`redis_memory_used_bytes`, "used"]], { unit: "bytes" }),
    ts("Mongo query time per op (ms)", [[`rate(mongodb_ss_metrics_queryExecutor_scannedObjects[${RATE}])`, "docs scanned / s"]], { unit: "short" }),
  ]],
  ["Replica resources", true, [
    ts("CPU % per replica", [[`100 * rate(process_cpu_seconds_total{job="app"}[${RATE}])`, "{{replica}}"]], { unit: "percent" }),
    ts("Memory per replica", [[`process_resident_memory_bytes{job="app"}`, "{{replica}}"]], { unit: "bytes" }),
    ts("Event-loop lag p99 per replica", [[`nodejs_eventloop_lag_p99_seconds{job="app"}`, "{{replica}}"]], { unit: "s" }),
    ts("In-flight requests per replica", [[`http_requests_in_flight{job="app"}`, "{{replica}}"]], {}),
    state("App version per replica", [[`app_info{job="app"}`, "{{replica}}: {{version}}"]], { w: 16 }),
  ]],
];

// lay rows out top-to-bottom, panels left-to-right wrapping at 24 columns
let y = 0;
const panels = [];
for (const [title, collapsed, ps] of ROWS) {
  const r = row(title, collapsed); r.gridPos.y = y++;
  let x = 0, rowY = y, maxH = 0;
  for (const p of ps) {
    if (x + p.gridPos.w > 24) { x = 0; rowY += maxH; maxH = 0; }
    p.gridPos.x = x; p.gridPos.y = rowY; x += p.gridPos.w; maxH = Math.max(maxH, p.gridPos.h);
  }
  y = rowY + maxH;
  if (collapsed) { r.panels = ps; panels.push(r); } else { panels.push(r, ...ps); }
}

const dashboard = {
  uid: "shopease-lab", title: "ShopEase lab", tags: ["lab"], timezone: "browser", editable: false,
  refresh: "5s", time: { from: "now-15m", to: "now" }, schemaVersion: 39, version: 1,
  annotations: { list: [
    { builtIn: 1, datasource: { type: "grafana", uid: "-- Grafana --" }, enable: true, hide: false, iconColor: "rgba(0, 211, 255, 1)", name: "Annotations & Alerts", type: "dashboard" },
    // the runner posts annotations tagged "lab" (arm start/end, hooks: replica killed, index created…)
    { datasource: { type: "grafana", uid: "-- Grafana --" }, enable: true, iconColor: "#F2495C", name: "lab events", target: { type: "tags", tags: ["lab"], limit: 200, matchAny: true } },
  ] },
  templating: { list: [] },
  panels,
};

const out = join(dirname(fileURLToPath(import.meta.url)), "dashboards", "lab.json");
writeFileSync(out, JSON.stringify(dashboard, null, 2) + "\n");
console.log(`wrote ${out} (${panels.length} panels)`);
