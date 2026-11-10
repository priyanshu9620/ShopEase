// Experiment runner.  make experiment E=01-caching [ARGS="--repeats 3 --quick"]
//
// For each arm in the manifest (baseline, treatment, …) × repeats:
//   1. bring the stack up with the arm's env + replica count (app containers are recreated)
//   2. reseed (idempotent, fast) and flush Redis so every arm starts cold
//   3. annotate Grafana "arm start"; run the k6 ramp through nginx; annotate "arm end"
//   4. snapshot every manifest metric from Prometheus over the arm's window → results/<arm>-<n>.json
// Then report.mjs turns results/ into report.md + charts + results.json and refreshes experiments/index.html.
//
// Runs inside lab/runner (docker CLI + node) with the host socket mounted; HOST_ROOT is the repo path
// on the host so compose bind mounts resolve. Can also run on the laptop directly with node ≥ 20.
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { buildReport } from "./report.mjs";

const ROOT = process.cwd();
const E = process.argv[2];
const args = process.argv.slice(3);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] ?? true : d; };
const REPEATS = Number(flag("--repeats", 1));
const QUICK = args.includes("--quick");           // 15 s stages, for demos / smoke
const ONLY = flag("--arm", null);                 // run a single arm
const PROM = process.env.PROM_URL || "http://localhost:9090";
const GRAFANA = process.env.GRAFANA_URL || "http://localhost:3000";
const LB = process.env.LB_URL || "http://localhost:8081";
const COMPOSE = `docker compose -p shopease -f docker-compose.yml -f lab/docker-compose.lab.yml`;

if (!E || !existsSync(join(ROOT, "experiments", E, "experiment.yml"))) {
  console.error(`usage: run.js <experiment-id>   (folders: ${listExperiments().join(", ")})`); process.exit(2);
}
const m = YAML.parse(readFileSync(join(ROOT, "experiments", E, "experiment.yml"), "utf8"));
const dir = join(ROOT, "experiments", E);
const resDir = join(dir, "results");
mkdirSync(resDir, { recursive: true });

const log = (s) => console.log(`\x1b[36m[lab]\x1b[0m ${s}`);
const banner = (s) => console.log(`\n\x1b[1;33m━━━ ${s} ━━━\x1b[0m\n`);
const sh = (cmd, env = {}) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env }, cwd: ROOT }).toString();
const shLive = (cmd, env = {}) => new Promise((res, rej) => {
  const p = spawn("sh", ["-c", cmd], { stdio: "inherit", env: { ...process.env, ...env }, cwd: ROOT });
  p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
});
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const now = () => Math.floor(Date.now() / 1000);

async function waitHealthy(replicas) {
  for (let i = 0; i < 60; i++) {
    try {
      const seen = new Set();
      for (let k = 0; k < replicas * 4; k++) seen.add(JSON.parse(sh(`curl -sf ${LB}/healthz`)).replica);
      if (seen.size >= replicas) return;
    } catch {}
    await sleep(2);
  }
  throw new Error("stack did not become healthy");
}

async function annotate(text, tags, time = now(), timeEnd) {
  const body = { dashboardUID: "shopease-lab", tags: ["lab", E, ...tags], text, time: time * 1000, ...(timeEnd ? { timeEnd: timeEnd * 1000 } : {}) };
  try {
    sh(`curl -sf -u admin:admin -H 'content-type: application/json' -X POST ${GRAFANA}/api/annotations -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`);
  } catch { log("grafana annotation failed (dashboard still works)"); }
}

function promRange(query, start, end) {
  const out = sh(`curl -sf -G ${PROM}/api/v1/query_range --data-urlencode 'query=${query.replace(/'/g, "'\\''")}' --data-urlencode start=${start} --data-urlencode end=${end} --data-urlencode step=15`);
  const r = JSON.parse(out).data.result[0];
  return r ? r.values.map(([t, v]) => [Number(t), v === "NaN" ? null : Number(v)]) : [];
}

async function runArm(armName, arm, n) {
  const label = `${armName} (${arm.label || armName})`;
  const env = { LAB_EXPERIMENT: E, LAB_ARM: armName, ...(arm.env || {}) };
  banner(`ARM ${label}  run ${n}/${REPEATS}  ${Object.entries(arm.env || {}).map(([k, v]) => `${k}=${v}`).join(" ")}`);

  log(`stack up: ${arm.replicas || 3} replica(s)`);
  sh(`${COMPOSE} up -d --scale app=${arm.replicas || 3} --remove-orphans`, env);
  await waitHealthy(arm.replicas || 3);
  for (const h of arm.hooks?.before || []) { log(`hook: ${h}`); await shLive(h, env); }

  log("reseed + flush redis (cold start for every arm)");
  sh(`${COMPOSE} run --rm app node scripts/seed.js`, env);
  sh(`${COMPOSE} exec -T redis redis-cli flushall`);

  const rates = QUICK ? m.load.rates.slice(0, 3) : m.load.rates;
  const step = QUICK ? 15 : m.load.step_s;
  const warm = QUICK ? 5 : m.load.warmup_s || 0;
  log(`watch: ${GRAFANA.replace("host.docker.internal", "localhost")}/d/shopease-lab   (ramp ${rates.join("→")} req/s, ${step} s each)`);

  if (warm) { log(`warm-up ${warm} s`); await shLive(`${COMPOSE} run --rm -e RATES=${rates[0]} -e STEP_S=${warm} k6 run --quiet ${m.load.script} >/dev/null`, env); }

  const start = now();
  const outBase = `/experiments/${E}/results/${armName}-${n}`;
  await annotate(`${E}: ${label} start`, [armName, "arm-start"], start);
  if (arm.hooks?.during) {
    // fire "during" hooks at their offset while k6 runs, e.g. "- {at_s: 60, run: docker kill shopease-app-2}"
    for (const h of arm.hooks.during) setTimeout(async () => { log(`hook @${h.at_s}s: ${h.run}`); await annotate(h.label || h.run, ["hook"]); try { await shLive(h.run, env); } catch (e) { log(e.message); } }, h.at_s * 1000);
  }
  await shLive(`${COMPOSE} run --rm -e RATES=${rates.join(",")} -e STEP_S=${step} -e OUT=${outBase} k6 run --quiet ${m.load.script}`, env);
  const end = now();
  await annotate(`${E}: ${label} end`, [armName, "arm-end"], end);
  await annotate(`${label}`, [armName, "arm-window"], start, end);
  for (const h of arm.hooks?.after || []) { log(`hook: ${h}`); await shLive(h, env); }

  log("snapshot Prometheus");
  await sleep(5);
  const series = {};
  for (const mt of m.metrics) {
    const pts = promRange(mt.query, start, end + 15);
    series[mt.name] = { unit: mt.unit, points: pts.map(([t, v]) => [t - start, v == null ? null : v * (mt.scale || 1)]) };
  }
  const k6file = join(resDir, `${armName}-${n}.k6.json`);
  const k6 = existsSync(k6file) ? JSON.parse(readFileSync(k6file, "utf8")) : null;
  const out = { experiment: E, arm: armName, label: arm.label || armName, run: n, env: arm.env || {}, replicas: arm.replicas || 3, rates, step_s: step, start, end, series, k6: k6 && summarizeK6(k6) };
  writeFileSync(join(resDir, `${armName}-${n}.json`), JSON.stringify(out, null, 1));
  const s = armSummary(out, m);
  log(`done: ${Object.entries(s).map(([k, v]) => `${k}=${v}`).join("  ")}`);
}

function summarizeK6(k) {
  const v = (n) => k.metrics[n]?.values || {};
  const o = { requests: v("http_reqs").count, failed_pct: 100 * (v("http_req_failed").rate || 0), all: v("http_req_duration") };
  for (const n of Object.keys(k.metrics)) if (n.startsWith("rt_")) o[n.slice(3)] = k.metrics[n].values;
  return o;
}

// per-arm summary used by the report: max RPS within SLA, metric@rate, averages
export function armSummary(r, man) {
  const s = {};
  const rps = r.series.rps?.points || [], p95 = r.series.p95_ms?.points || [], err = r.series.error_pct?.points || [];
  let best = 0;
  rps.forEach(([t, v], i) => { const p = p95[i]?.[1], e = err[i]?.[1] ?? 0; if (v != null && p != null && p < man.sla_ms && e < man.max_error_pct) best = Math.max(best, v); });
  s.max_rps_within_sla = Math.round(best);
  for (const h of man.headline || []) {
    const [name, at] = h.metric.split("@");
    if (at) {
      // average over the last two-thirds of that stage (the ramp to the target rate is linear within a stage)
      const idx = r.rates.indexOf(Number(at));
      if (idx < 0) continue;
      const from = idx * r.step_s + r.step_s / 3, to = (idx + 1) * r.step_s;
      const pts = (r.series[name]?.points || []).filter(([t, v]) => t >= from && t <= to && v != null);
      s[h.metric] = pts.length ? +(pts.reduce((a, [, v]) => a + v, 0) / pts.length).toFixed(1) : null;
    }
    else if (!(h.metric in s)) {
      // "<metric>" = average over the window, "<metric>:max" / "<metric>:min" = extreme
      const [base, agg] = name.split(":");
      const vals = (r.series[base]?.points || []).map(([, v]) => v).filter((v) => v != null);
      if (!vals.length) { s[h.metric] = null; continue; }
      s[h.metric] = +(agg === "max" ? Math.max(...vals) : agg === "min" ? Math.min(...vals) : vals.reduce((a, v) => a + v, 0) / vals.length).toFixed(1);
    }
  }
  return s;
}

function listExperiments() {
  try { return execSync(`ls -d experiments/*/experiment.yml`, { cwd: ROOT }).toString().trim().split("\n").map((p) => p.split("/")[1]); } catch { return []; }
}

// ---------------------------------------------------------------------------------------------
banner(`${m.id} — ${m.title}`);
console.log(`${m.question}\n\nWhat changes: ${m.what_changes}\nWhat to watch: Grafana → ${GRAFANA.replace("host.docker.internal", "localhost")}/d/shopease-lab  (arms appear as separate lines + shaded bands)\n`);
const arms = Object.entries(m.arms).filter(([k]) => !ONLY || k === ONLY);
if (!args.includes("--report-only")) for (let n = 1; n <= REPEATS; n++) for (const [name, arm] of arms) await runArm(name, arm, n);
banner("report");
const summary = buildReport(ROOT, E, m, armSummary);
console.log(summary);
log(`report: experiments/${E}/report.md   index: experiments/index.html`);
