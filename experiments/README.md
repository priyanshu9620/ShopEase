# Experiments

Each folder is one system-design concept tested on the real ShopEase app. One knob, one chart.

```
make lab                           # app ×3 behind nginx, Prometheus, Grafana (http://localhost:3000/d/shopease-lab)
make experiment E=01-caching       # both arms, 1 run each, report at experiments/01-caching/report.md
make experiment E=01-caching ARGS="--repeats 3"     # medians of 3 (what the README numbers use)
make experiment E=01-caching ARGS="--quick"         # ~1-minute version for a demo
make experiment E=01-caching ARGS="--arm treatment" # one arm only
```

While it runs: the terminal prints the arm banner, Grafana shows each arm as its own line (label
`arm`) with a shaded band and markers for every hook ("replica killed", "index created", …).
After it runs: `report.md` + `charts/*.svg` + `results.json` in the experiment folder, and
`experiments/index.html` is regenerated (published to GitHub Pages on push).

## Anatomy of an experiment

```
experiments/<nn>-<name>/
  experiment.yml     the manifest (below)
  report.md          generated — never hand-edit
  results.json       generated — per-arm summary (medians)
  results/           generated — raw per-run series + k6 summaries (git-ignored)
  charts/            generated — SVG, one per metric
  DEMO.md            optional — what to say while it runs (Phase 2b)
```

`experiment.yml`:

| key | meaning |
|---|---|
| `id`, `title`, `concept`, `question`, `what_changes` | the write-up text |
| `arms.<name>.env` | environment for the app containers in that arm (the knob) |
| `arms.<name>.replicas` | how many app replicas behind nginx |
| `arms.<name>.hooks.before/after` | shell commands run once, e.g. create or drop an index |
| `arms.<name>.hooks.during` | `{at_s, run, label}` fired at an offset while load runs, e.g. `docker kill shopease-app-2` |
| `load.script`, `load.rates`, `load.step_s`, `load.warmup_s` | k6 scenario in `lab/k6/`, the ramp stages |
| `sla_ms`, `max_error_pct` | define "max sustainable RPS" |
| `metrics[]` | PromQL series snapshotted per arm (`unit`, optional `scale`) |
| `headline[]` | which summary numbers go in the table: `<metric>` (average) or `<metric>@<rate>` (average during that stage) or `max_rps_within_sla` |
| `caveats[]` | the "what this does not prove" list |

## Adding a concept

1. `cp -r experiments/_template experiments/11-my-concept` and edit `experiment.yml`.
2. If the concept needs an app change, put it behind an env flag (see `lib/cache.js`, `CACHE_ENABLED`) so the baseline arm is the same binary with the flag off.
3. If it needs a new metric, add it in `lib/metrics.js` and a panel in `lab/grafana/build-dashboard.mjs` (then `make dashboard`).
4. `make experiment E=11-my-concept`. No runner changes needed.
