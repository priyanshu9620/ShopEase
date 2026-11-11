# 05 — Codebase map and how to extend it

```
server.js                 Express app: middleware (metrics, rate limit), routes, /healthz, /metrics, lab routes,
                          graceful shutdown, socket.io attach
config/db.js              Mongo connect with retry + small pool
controllers/ models/ routes/ middlewares/ helpers/   the original app (RBAC, catalogue, cart, payments)
lib/
  metrics.js              prom-client registry + every custom metric
  redis.js                shared Redis client (lazy, never fails the API)
  cache.js                cache-aside middleware + namespace-version invalidation      (01)
  ratelimit.js            per-client fixed-window limiter in Redis                     (06)
  postorder.js            inline vs queued post-checkout work (BullMQ queue)           (07)
  payments.js             Braintree | mock gateway, hang mode, opossum breaker         (08)
  photos.js               S3 upload after create/update, 302 to CDN                   (11)
  realtime.js             socket.io + Redis adapter, order:status emit                 (12)
worker.js                 BullMQ worker with its own /metrics                          (07)
routes/labRoutes.js       lab-only stock/buy endpoints                                 (09)
scripts/seed.js           deterministic dataset;  scripts/migrate-photos-to-s3.js
client/                   React (CRA); hooks/useOrderUpdates.js is the only lab addition

lab/
  docker-compose.lab.yml  app×N, nginx, Prometheus, Grafana, exporters, worker, k6
  nginx/nginx.conf        DNS round-robin LB, retries, WebSocket upgrade
  prometheus/, grafana/   scrape config; build-dashboard.mjs → dashboards/lab.json
  k6/                     browse.js (shopper mix), catalog.js, abuse.js, checkout.js, oversell.js, photos.js
  hooks/                  deploy.sh (naive|rolling), payment-hang.sh
  realtime/fanout.js      N sockets, flip an order, measure delivery
  runner/                 run.js (arms, hooks, snapshots), report.mjs, aws-report.mjs, k6-report.mjs, Dockerfile
  aws/                    bench.sh (in-region k6 sweep), cdn-bench.sh (laptop: ALB vs CloudFront)
experiments/
  README.md, _template/   manifest contract
  01-caching … 12-realtime/experiment.yml + report.md + charts/ + results.json   (results/ raw runs are git-ignored)
  index.html              generated results site (GitHub Pages)
infra/                    OpenTofu: main.tf (network, SGs, ECR, SSM, IAM, instances, ALB, deploy user),
                          cdn.tf (S3, CloudFront), user-data-*.sh, README.md with the diagram
.github/workflows/        ci.yml (build+smoke+GHCR), deploy.yml (ECR + S3 + rolling SSM deploy), pages.yml
docs/GUIDE.md             the manual;  Makefile: up, seed, lab, experiment, infra-*, aws-bench, cdn-bench
```

## Adding a new experiment (the extensibility story)

1. Put the behaviour behind an env flag in a new `lib/<thing>.js`, mounted as middleware on the route(s).
   The baseline arm is the same image with the flag off.
2. Add metrics in `lib/metrics.js`; add a collapsed row in `lab/grafana/build-dashboard.mjs`; `make dashboard`.
3. Pass the flag through `lab/docker-compose.lab.yml` (`FLAG: ${FLAG:-false}`).
4. `cp -r experiments/_template experiments/13-<name>`, fill `experiment.yml`: arms (env, replicas, hooks),
   load (a k6 script in `lab/k6/` or a node script with `kind: node`), metrics (PromQL), headline, caveats.
5. `make experiment E=13-<name>`. No runner change. Commit `report.md`, `charts/`, `results.json`.

Examples from the backlog that fit this pattern with < 100 lines each: cache stampede (single-flight),
cursor pagination, connection-pool sizing, idempotency keys on checkout, read replicas, search engine.

## Where state lives (why replicas are stateless)

| state | lives in | why |
|---|---|---|
| catalogue, users, orders | MongoDB | source of truth |
| cache entries, rate-limit counters, queue jobs, socket.io relay, payment hang flag | Redis | shared by all replicas |
| product photos, React build | S3 (via CloudFront) | static, cacheable at the edge |
| secrets | SSM Parameter Store (AWS) / `.env` (local) | never in the image or the repo |
| infra state | `infra/terraform.tfstate` (local, git-ignored) | single operator; a remote backend would be the team version |
