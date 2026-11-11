// Report for experiment 10-aws from per-rate k6 summaries produced on the in-region load generator:
//   experiments/10-aws/results/<arm>-<rate>.k6.json
// Writes experiments/10-aws/report.md, results.json, charts/*.svg and refreshes experiments/index.html.
//   node lab/runner/aws-report.mjs            (run via `make aws-report`, inside the runner image)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { buildIndex } from "./report.mjs";

const ROOT = process.cwd();
const E = "10-aws";
const dir = join(ROOT, "experiments", E);
const m = YAML.parse(readFileSync(join(dir, "experiment.yml"), "utf8"));
const resDir = join(dir, "results");
mkdirSync(join(dir, "charts"), { recursive: true });

const runs = readdirSync(resDir).filter((f) => f.endsWith(".k6.json")).map((f) => {
  const [arm, rate] = f.replace(".k6.json", "").split("-");
  const k = JSON.parse(readFileSync(join(resDir, f), "utf8"));
  const v = (n) => k.metrics[n]?.values || {};
  return { arm, rate: Number(rate), rps: v("http_reqs").rate, failed_pct: 100 * (v("http_req_failed").rate || 0), p50: v("http_req_duration").med, p95: v("http_req_duration")["p(95)"], p99: v("http_req_duration")["p(99)"],
    routes: Object.fromEntries(Object.keys(k.metrics).filter((n) => n.startsWith("rt_")).map((n) => [n.slice(3), k.metrics[n].values["p(95)"]])) };
}).filter((r) => Number.isFinite(r.rate)).sort((a, b) => a.rate - b.rate);

const arms = [...new Set(runs.map((r) => r.arm))].sort((a, b) => (a === "uncached" ? -1 : 1));
const summary = {};
for (const a of arms) {
  const rs = runs.filter((r) => r.arm === a);
  const ok = rs.filter((r) => r.p95 < m.sla_ms && r.failed_pct < m.max_error_pct && r.rps >= r.rate * 0.9);
  const at = (rate) => rs.find((r) => r.rate === rate);
  summary[a] = { label: m.arms[a]?.label || a, runs: rs.length, max_rps_within_sla: ok.length ? Math.max(...ok.map((r) => r.rate)) : 0,
    "p95_ms@400": at(400)?.p95 ?? null, "p95_ms@800": at(800)?.p95 ?? null, "failed_pct@1600": at(1600)?.failed_pct ?? null, table: rs };
}

const fmt = (v, u = "") => (v == null ? "–" : `${Number.isInteger(v) ? v : (+v).toFixed(1)}${u}`);
const head = `| metric | ${arms.map((a) => summary[a].label).join(" | ")} | change |`;
const sep = `|---|${arms.map(() => "---:").join("|")}|---:|`;
const rows = (m.headline || []).map((h) => {
  const vals = arms.map((a) => summary[a][h.metric]);
  const b = vals[0], t = vals.at(-1);
  const d = b != null && t != null && b !== 0 ? `${t >= b ? "+" : ""}${(((t - b) / b) * 100).toFixed(0)} %` : "";
  return `| ${h.label} | ${vals.map((v) => fmt(v)).join(" | ")} | ${d} |`;
});

// chart: p95 vs offered rate, one line per arm
const W = 720, H = 300, L = 56, R = 16, T = 36, B = 44;
const xs = [...new Set(runs.map((r) => r.rate))].sort((a, b) => a - b);
const ymax = Math.min(2000, Math.max(...runs.map((r) => r.p95)) * 1.1);
const X = (v) => L + ((xs.indexOf(v)) / Math.max(1, xs.length - 1)) * (W - L - R), Y = (v) => T + (1 - Math.min(v, ymax) / ymax) * (H - T - B);
const colors = { uncached: "#8a8f98", cached: "#2f80ed" };
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif" font-size="12"><rect width="${W}" height="${H}" fill="#fff"/>
<text x="${L}" y="20" font-size="14" font-weight="600">p95 latency (ms) vs offered rate (req/s) — ALB, 3 × t3.micro, k6 in-region</text>
<line x1="${L}" x2="${W - R}" y1="${Y(300)}" y2="${Y(300)}" stroke="#e74c3c" stroke-dasharray="4 3"/><text x="${W - R}" y="${Y(300) - 4}" text-anchor="end" fill="#e74c3c">SLA 300 ms</text>
${xs.map((x) => `<text x="${X(x)}" y="${H - B + 16}" text-anchor="middle" fill="#666">${x}</text>`).join("")}
${[0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${L - 6}" y="${Y(ymax * f) + 4}" text-anchor="end" fill="#666">${Math.round(ymax * f)}</text>`).join("")}
<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#999"/>
${arms.map((a) => `<polyline fill="none" stroke="${colors[a] || "#e67e22"}" stroke-width="2" points="${runs.filter((r) => r.arm === a).map((r) => `${X(r.rate)},${Y(r.p95)}`).join(" ")}"/>`).join("")}
${arms.map((a, i) => `<rect x="${L + i * 160}" y="${H - 16}" width="12" height="3" fill="${colors[a] || "#e67e22"}"/><text x="${L + i * 160 + 16}" y="${H - 11}">${summary[a].label}</text>`).join("")}
</svg>`;
writeFileSync(join(dir, "charts", "p95_vs_rate.svg"), svg);

const perRate = arms.map((a) => `### ${summary[a].label}\n\n| offered req/s | achieved req/s | failed | p50 | p95 | p99 | photo p95 | search p95 |\n|---:|---:|---:|---:|---:|---:|---:|---:|\n${summary[a].table.map((r) => `| ${r.rate} | ${fmt(r.rps)} | ${fmt(r.failed_pct, " %")} | ${fmt(r.p50, " ms")} | ${fmt(r.p95, " ms")} | ${fmt(r.p99, " ms")} | ${fmt(r.routes.photo, " ms")} | ${fmt(r.routes.search, " ms")} |`).join("\n")}`).join("\n\n");

const md = `# ${m.id} — ${m.title}

**Question.** ${m.question}

**Concept.** ${String(m.concept).trim()}

**What changes between arms.** ${m.what_changes}

## Result

${head}
${sep}
${rows.join("\n")}

![p95 vs rate](charts/p95_vs_rate.svg)

${perRate}

- Load generator: k6 0.55 on a t3.small in the same region, one constant-rate run of ${m.load.seconds_per_rate} s per rate, browse mix (list 30 %, product 20 %, photo 35 %, search 10 %, categories 5 %).
- "Max sustainable" = highest offered rate whose run achieved ≥ 90 % of it with p95 < ${m.sla_ms} ms and failures < ${m.max_error_pct} %.
- Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.

## What this does NOT prove

${(m.caveats || []).map((c) => `- ${c}`).join("\n")}

## Reproduce

\`\`\`
make infra-apply                      # 3 × t3.micro + ALB + data + loadgen (ap-southeast-2)
make aws-bench ARM=uncached           # toggles CACHE_ENABLED in SSM, redeploys, sweeps rates from the loadgen
make aws-bench ARM=cached
make aws-report
make infra-destroy
\`\`\`
`;
writeFileSync(join(dir, "report.md"), md);
writeFileSync(join(dir, "results.json"), JSON.stringify({ experiment: E, title: m.title, generated: new Date().toISOString(), summary: Object.fromEntries(arms.map((a) => [a, { ...summary[a], table: undefined }])), headline: m.headline, charts: [{ name: "p95_vs_rate", file: "p95_vs_rate.svg" }] }, null, 1));
buildIndex(ROOT);
console.log([head, sep, ...rows].join("\n"));
