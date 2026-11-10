// Report generator: experiments/<E>/results/*.json → report.md + charts/*.svg + results.json,
// then regenerates experiments/index.html (the static results site published to GitHub Pages).
// No dependencies, inline SVG, so the output renders on GitHub and in any browser.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

const COLORS = { baseline: "#8a8f98", treatment: "#2f80ed", a: "#e67e22", b: "#27ae60" };
const color = (arm, i) => COLORS[arm] || Object.values(COLORS)[i % 4];
const median = (xs) => { const a = xs.filter((x) => x != null).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; };
const fmt = (v, unit = "") => (v == null ? "–" : `${Number.isInteger(v) ? v : v.toFixed(1)}${unit === "%" ? " %" : unit ? " " + unit : ""}`);

export function buildReport(root, E, m, armSummary) {
  const resDir = join(root, "experiments", E, "results");
  const chartDir = join(root, "experiments", E, "charts");
  mkdirSync(chartDir, { recursive: true });
  const runs = readdirSync(resDir).filter((f) => /^[a-z0-9_-]+-\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(resDir, f), "utf8")));
  const arms = Object.keys(m.arms).filter((a) => runs.some((r) => r.arm === a));

  // per-arm medians across repeats
  const summary = {};
  for (const a of arms) {
    const rs = runs.filter((r) => r.arm === a);
    const sums = rs.map((r) => armSummary(r, m));
    summary[a] = { label: m.arms[a].label || a, runs: rs.length, env: m.arms[a].env || {}, replicas: m.arms[a].replicas || 3 };
    for (const k of Object.keys(sums[0] || {})) summary[a][k] = median(sums.map((s) => s[k]));
    const k6 = rs.map((r) => r.k6).filter(Boolean);
    if (k6.length) summary[a].k6 = { requests: median(k6.map((k) => k.requests)), failed_pct: median(k6.map((k) => k.failed_pct)), p95_ms: median(k6.map((k) => k.all?.["p(95)"])), p99_ms: median(k6.map((k) => k.all?.["p(99)"])) };
  }

  // charts: one per metric, all arms overlaid (first run of each arm)
  const charts = [];
  for (const mt of m.metrics) {
    const lines = arms.map((a, i) => { const r = runs.find((x) => x.arm === a); return { name: summary[a].label, color: color(a, i), pts: r?.series[mt.name]?.points || [] }; });
    if (!lines.some((l) => l.pts.length)) continue;
    const file = `${mt.name}.svg`;
    writeFileSync(join(chartDir, file), lineChart(`${mt.name} (${mt.unit})`, lines, runs[0]));
    charts.push({ name: mt.name, file });
  }

  // headline table
  const base = arms[0];
  const rows = (m.headline || []).map((h) => {
    const vals = arms.map((a) => summary[a][h.metric]);
    const b = vals[0], t = vals[vals.length - 1];
    const delta = b != null && t != null && b !== 0 ? `${t >= b ? "+" : ""}${(((t - b) / b) * 100).toFixed(0)} %` : "";
    return `| ${h.label} | ${vals.map((v) => fmt(v)).join(" | ")} | ${delta} |`;
  });
  const head = `| metric | ${arms.map((a) => summary[a].label).join(" | ")} | change |`;
  const sep = `|---|${arms.map(() => "---:").join("|")}|---:|`;

  const md = `# ${m.id} — ${m.title}

**Question.** ${m.question}

**Concept.** ${String(m.concept).trim()}

**What changes between arms.** ${m.what_changes}

## Result

${head}
${sep}
${rows.join("\n")}

${arms.map((a) => `- **${summary[a].label}**: ${summary[a].replicas} replica(s), \`${Object.entries(summary[a].env).map(([k, v]) => `${k}=${v}`).join(" ") || "defaults"}\`, ${summary[a].runs} run(s) (median shown)`).join("\n")}
- Load: \`${m.load.script}\`, ramp ${runs[0]?.rates.join(" → ")} req/s, ${runs[0]?.step_s} s per stage, open model (arrival rate), through nginx to the replicas.
- SLA used for "max RPS": p95 < ${m.sla_ms} ms and errors < ${m.max_error_pct} %. Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.

## Charts

${charts.map((c) => `### ${c.name}\n![${c.name}](charts/${c.file})`).join("\n\n")}

## k6 view (client side)

| arm | requests | failed | p95 | p99 |
|---|---:|---:|---:|---:|
${arms.map((a) => `| ${summary[a].label} | ${fmt(summary[a].k6?.requests)} | ${fmt(summary[a].k6?.failed_pct, "%")} | ${fmt(summary[a].k6?.p95_ms, "ms")} | ${fmt(summary[a].k6?.p99_ms, "ms")} |`).join("\n")}

## What this does NOT prove

${(m.caveats || []).map((c) => `- ${c}`).join("\n")}

## Reproduce

\`\`\`
make lab
make experiment E=${m.id}            # add ARGS="--repeats 3" for medians of 3, ARGS="--quick" for a 1-minute demo
\`\`\`
`;
  writeFileSync(join(root, "experiments", E, "report.md"), md);
  writeFileSync(join(root, "experiments", E, "results.json"), JSON.stringify({ experiment: E, title: m.title, generated: new Date().toISOString(), summary, headline: m.headline, charts }, null, 1));
  buildIndex(root);
  return [head, sep, ...rows].join("\n");
}

// --- inline SVG line chart (time on x, all arms overlaid) --------------------------------
function lineChart(title, lines, run) {
  const W = 720, H = 300, L = 56, R = 16, T = 36, B = 44;
  const all = lines.flatMap((l) => l.pts).filter(([, v]) => v != null);
  if (!all.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"></svg>`;
  const xmax = Math.max(...all.map(([t]) => t)), ymax = Math.max(...all.map(([, v]) => v)) * 1.1 || 1;
  const X = (t) => L + (t / xmax) * (W - L - R), Y = (v) => T + (1 - v / ymax) * (H - T - B);
  const ticks = 5, yt = Array.from({ length: ticks + 1 }, (_, i) => (ymax * i) / ticks);
  const stages = run ? run.rates.map((r, i) => ({ r, x: X(i * run.step_s) })) : [];
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">
<rect width="${W}" height="${H}" fill="#fff"/>
<text x="${L}" y="20" font-size="14" font-weight="600" fill="#222">${esc(title)}</text>
${yt.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eee"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" fill="#666">${v >= 100 ? Math.round(v) : v.toFixed(1)}</text>`).join("")}
${stages.map((s) => `<line x1="${s.x}" x2="${s.x}" y1="${T}" y2="${H - B}" stroke="#ddd" stroke-dasharray="3 3"/><text x="${s.x + 3}" y="${H - B + 14}" fill="#888" font-size="10">${s.r} rps</text>`).join("")}
<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#999"/>
${lines.map((l) => `<polyline fill="none" stroke="${l.color}" stroke-width="2" points="${l.pts.filter(([, v]) => v != null).map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}"/>`).join("")}
${lines.map((l, i) => `<rect x="${L + i * 150}" y="${H - 16}" width="12" height="3" fill="${l.color}"/><text x="${L + i * 150 + 16}" y="${H - 11}" fill="#333">${esc(l.name)}</text>`).join("")}
<text x="${W - R}" y="${H - B + 28}" text-anchor="end" fill="#888" font-size="10">seconds since arm start</text>
</svg>`;
}

// --- experiments/index.html: one card per experiment with its headline numbers ------------
export function buildIndex(root) {
  const exDir = join(root, "experiments");
  const ids = readdirSync(exDir).filter((d) => existsSync(join(exDir, d, "experiment.yml")) && !d.startsWith("_")).sort();
  const cards = ids.map((id) => {
    const m = YAML.parse(readFileSync(join(exDir, id, "experiment.yml"), "utf8"));
    const rf = join(exDir, id, "results.json");
    const r = existsSync(rf) ? JSON.parse(readFileSync(rf, "utf8")) : null;
    const arms = r ? Object.keys(r.summary) : [];
    const table = r ? `<table><tr><th></th>${arms.map((a) => `<th>${r.summary[a].label}</th>`).join("")}</tr>${(m.headline || []).map((h) => `<tr><td>${h.label}</td>${arms.map((a) => `<td>${fmt(r.summary[a][h.metric])}</td>`).join("")}</tr>`).join("")}</table>` : `<p class="muted">not run yet</p>`;
    const chart = r?.charts?.[1] || r?.charts?.[0];
    return `<section class="card"><h2>${m.id} · ${m.title}</h2><p>${m.question}</p>${table}${chart ? `<img src="${id}/charts/${chart.file}" alt="${chart.name}">` : ""}<p><a href="${id}/report.md">full report</a>${r ? ` · generated ${r.generated.slice(0, 10)}` : ""}</p></section>`;
  });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShopEase lab</title>
<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#222;line-height:1.45}h1{margin:0 0 4px}.sub{color:#666;margin:0 0 24px}.card{border:1px solid #e5e5e5;border-radius:10px;padding:16px 20px;margin:16px 0}.card h2{margin:0 0 6px;font-size:18px}table{border-collapse:collapse;margin:8px 0}td,th{padding:4px 12px;border-bottom:1px solid #eee;text-align:right}td:first-child,th:first-child{text-align:left}img{max-width:100%;margin-top:8px}.muted{color:#888}a{color:#2f80ed}</style></head>
<body><h1>ShopEase system-design lab</h1><p class="sub">Each experiment changes one thing in a real e-commerce app, runs the same load against both arms, and reports what moved. Generated by <code>make experiment</code>; numbers are medians over repeats on one laptop unless a report says otherwise.</p>
${cards.join("\n")}
<p class="muted">Source: <a href="https://github.com/priyanshu9620/ShopEase">github.com/priyanshu9620/ShopEase</a></p></body></html>`;
  writeFileSync(join(exDir, "index.html"), html);
}
