// Generic report for experiments measured by ONE k6 (or fanout) summary per arm, outside the local runner:
//   experiments/<E>/results/<arm>.k6.json   →   report.md + results.json (+ index.html refresh)
//   node lab/runner/k6-report.mjs 11-cdn        (make k6-report E=11-cdn)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { buildIndex } from "./report.mjs";

const ROOT = process.cwd();
const E = process.argv[2];
if (!E) { console.error("usage: k6-report.mjs <experiment-id>"); process.exit(2); }
const dir = join(ROOT, "experiments", E);
const m = YAML.parse(readFileSync(join(dir, "experiment.yml"), "utf8"));
mkdirSync(join(dir, "charts"), { recursive: true });

const arms = Object.keys(m.arms).filter((a) => existsSync(join(dir, "results", `${a}.k6.json`)));
const read = (a) => JSON.parse(readFileSync(join(dir, "results", `${a}.k6.json`), "utf8"));
const pick = (k, path) => {
  if (path === "failed_pct") return 100 * (k.metrics.http_req_failed?.values.rate || 0);
  const [name, field] = path.split("."); return k.metrics[name]?.values?.[field] ?? null;
};
const fmt = (v) => (v == null ? "–" : Number.isInteger(v) ? String(v) : (+v).toFixed(1));
const summary = Object.fromEntries(arms.map((a) => { const k = read(a); const s = { label: m.arms[a].label || a }; for (const h of m.headline) s[h.metric] = h.metric.startsWith("k6:") ? pick(k, h.metric.slice(3)) : null; return [a, s]; }));
const head = `| metric | ${arms.map((a) => summary[a].label).join(" | ")} | change |`, sep = `|---|${arms.map(() => "---:").join("|")}|---:|`;
const rows = m.headline.map((h) => { const vals = arms.map((a) => summary[a][h.metric]); const b = vals[0], t = vals.at(-1); const d = b != null && t != null && b !== 0 ? `${t >= b ? "+" : ""}${(((t - b) / b) * 100).toFixed(0)} %` : ""; return `| ${h.label} | ${vals.map(fmt).join(" | ")} | ${d} |`; });

// bar chart of the first headline metric per arm
const first = m.headline[0]; const vals = arms.map((a) => summary[a][first.metric] ?? 0); const max = Math.max(...vals, 1);
const W = 560, H = 60 + arms.length * 36;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif" font-size="12"><rect width="${W}" height="${H}" fill="#fff"/><text x="12" y="20" font-size="14" font-weight="600">${first.label}</text>
${arms.map((a, i) => `<text x="12" y="${52 + i * 36}" fill="#333">${summary[a].label}</text><rect x="230" y="${40 + i * 36}" width="${Math.max(2, (vals[i] / max) * 280)}" height="18" fill="${i === 0 ? "#8a8f98" : "#2f80ed"}"/><text x="${236 + (vals[i] / max) * 280}" y="${53 + i * 36}" fill="#222">${fmt(vals[i])}</text>`).join("")}</svg>`;
writeFileSync(join(dir, "charts", "headline.svg"), svg);

const extra = arms.map((a) => { const k = read(a); const r = k.fanout?.rounds; return r ? `### ${summary[a].label} — per round\n\n| round | status | received | lost | p50 ms | p95 ms | max ms |\n|---:|---|---:|---:|---:|---:|---:|\n${r.map((x) => `| ${x.round} | ${x.status} | ${x.received} | ${x.lost} | ${fmt(x.p50)} | ${fmt(x.p95)} | ${fmt(x.max)} |`).join("\n")}\n\nsockets per replica: \`${JSON.stringify(k.fanout.replicas)}\`` : ""; }).filter(Boolean).join("\n\n");

const md = `# ${m.id} — ${m.title}

**Question.** ${m.question}

**Concept.** ${String(m.concept).trim()}

**What changes between arms.** ${m.what_changes}

## Result

${head}
${sep}
${rows.join("\n")}

![${first.label}](charts/headline.svg)

${extra}

- Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from \`experiments/${E}/results/<arm>.k6.json\`.

## What this does NOT prove

${(m.caveats || []).map((c) => `- ${c}`).join("\n")}
`;
writeFileSync(join(dir, "report.md"), md);
writeFileSync(join(dir, "results.json"), JSON.stringify({ experiment: E, title: m.title, generated: new Date().toISOString(), summary, headline: m.headline, charts: [{ name: "headline", file: "headline.svg" }] }, null, 1));
buildIndex(ROOT);
console.log([head, sep, ...rows].join("\n"));
