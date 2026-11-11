# 02 — Features and how each is implemented (low-level KT)

Every lab feature is behind an environment flag so the **same image** serves as baseline and treatment.
The original controllers are untouched; behaviour is added with Express middleware on the routes.

## Platform

| feature | how | files |
|---|---|---|
| Health endpoint | `GET /healthz` pings Mongo, reports Redis state, app version (git SHA from CI) and the replica id (container/instance id); 503 if Mongo is down. Used by compose, nginx, the ALB target group and the runner. | `server.js` |
| Metrics | `prom-client` histogram `http_request_duration_seconds{method,route,status}` with the **route pattern** (never the raw URL, to avoid label cardinality), in-flight gauge, per-feature counters; default labels `replica`, `experiment`, `arm` so Grafana splits lines without query changes. | `lib/metrics.js` |
| Single image | Multi-stage Dockerfile: stage 1 builds the React client, stage 2 is `node:20-slim` running the API and serving the build. Non-root, healthcheck, `APP_VERSION` build arg. | `Dockerfile` |
| Seed data | Deterministic 5,000 products (seeded PRNG), 12 categories, admin + buyer; photos are generated PNGs (~54 KB) so the photo endpoint is realistically heavy; idempotent, trims extras, `SEED_PRODUCTS=50000` for the index experiment. | `scripts/seed.js` |
| Graceful shutdown | `SIGTERM` → stop accepting, finish in-flight (10 s cap) → exit. Docker/ALB send SIGTERM on stop/deregister. | `server.js` |
| Mongo connection | retry loop on first connect, `maxPoolSize: 20` (default 100 × 3 replicas OOM-killed the 2 GB data box). | `config/db.js` |

## Experiments (the knob, in code)

| experiment | flag | implementation |
|---|---|---|
| 01 caching | `CACHE_ENABLED` | HTTP-layer cache-aside middleware `cached(ns, ttl)`: key = namespace + version + method + URL (+ body for POST reads); stores status/content-type/body (buffers base64) in Redis; `invalidate(ns)` runs after writes and `INCR`s the namespace version so old keys are orphaned (no `KEYS`/`SCAN`). `X-Cache: HIT/MISS` header. | `lib/cache.js`, routes |
| 02 scale-out | `--scale app=N` | nginx resolves the `app` service name through Docker DNS every 5 s and round-robins; each replica is limited to 1 CPU. | `lab/nginx/nginx.conf`, `lab/docker-compose.lab.yml` |
| 03 fault tolerance | hook `docker stop` | nginx `proxy_next_upstream` retries another replica on connection errors; the killed replica leaves DNS. | nginx + manifest hook |
| 04 rolling deploy | `lab/hooks/deploy.sh naive\|rolling` | naive = recreate all; rolling = start a v2 one-off container on the `app` alias, wait healthy, drain one v1 (`docker stop -t 15` → SIGTERM handler), repeat. On AWS: deregister from ALB → drain → `deploy.sh` → register. | `lab/hooks/deploy.sh`, `.github/workflows/deploy.yml` |
| 05 DB indexing | hooks create/drop indexes | `db.products.createIndex({slug:1})`, `({category:1})`; measured with Mongo's `scannedObjects` counter from the exporter. | manifest hooks |
| 06 rate limiting | `RATE_LIMIT_ENABLED`, `RATE_LIMIT_RPS` | fixed 1-second window per client in Redis: `MULTI INCR key EXPIRE key 2`; client = `X-Client-Id` header or IP; 429 + `Retry-After`; fails open if Redis is down. Shared counter = the limit holds across replicas. | `lib/ratelimit.js` |
| 07 async queue | `QUEUE_ENABLED` | middleware wraps `res.json` on the payment route: inline arm does the 300 ms "email" before responding; queue arm enqueues a BullMQ job and responds; `worker.js` consumes (scaled 1→3), exposes its own `/metrics` with job wait histogram. | `lib/postorder.js`, `worker.js` |
| 08 circuit breaker | `BREAKER_ENABLED`, `PAYMENT_MOCK` | `lib/payments.js` builds the gateway: real Braintree or a mock whose hang mode is toggled at runtime via a Redis flag (`lab/hooks/payment-hang.sh`); opossum breaker: 2 s timeout, opens at 50 % failures over ≥10 calls, 10 s reset; `payment_breaker_state` gauge. | `lib/payments.js` |
| 09 oversell | `OVERSELL_MODE` | lab-only route (`LAB_ROUTES=true`): naive = find, check, update; atomic = `findOneAndUpdate({_id, quantity:{$gt:0}}, {$inc:{quantity:-1}})`. 200 VUs fire within ms of each other, 20 rounds. | `routes/labRoutes.js`, `lab/k6/oversell.js` |
| 10 AWS | OpenTofu | see `infra/README.md`; k6 runs on an in-region loadgen instance (`lab/aws/bench.sh`), one constant-rate run per rate. | `infra/`, `lab/aws/` |
| 11 CDN | `PHOTO_STORAGE` | `syncPhotoToS3()` after create/update uploads the buffer and sets `photoUrl`; `photoRedirect()` 302s `/product-photo/:pid` to CloudFront so the client is unchanged; migration script for existing photos; CloudFront serves `/photos/*` and the React build from a private bucket (OAC), `/api` and `/socket.io` from the ALB. | `lib/photos.js`, `infra/cdn.tf` |
| 12 real-time | `REALTIME_ADAPTER` | socket.io on the Express server, JWT in the handshake → room `user:<id>`; `afterOrderStatus()` emits `order:status` to the buyer's room; Redis adapter relays between replicas; client hook subscribes with WebSocket-only transport (no LB stickiness needed). | `lib/realtime.js`, `client/src/hooks/useOrderUpdates.js` |

## The lab machinery

| piece | what it does |
|---|---|
| `lab/docker-compose.lab.yml` | app ×N (1 CPU each) behind nginx, Prometheus (DNS service discovery of every replica), Grafana (provisioned dashboard), Redis/Mongo exporters, worker, k6 |
| `lab/grafana/build-dashboard.mjs` | generates the single dashboard JSON: common top row + a collapsed row per concept; annotations tagged `lab` |
| `lab/runner/run.js` | for each arm × repeat: stack up with the arm's env/replicas, flush Redis, reseed, Grafana "arm start", hooks (before/during/after), k6 or a node script, Grafana "arm end", Prometheus range snapshot of every manifest metric → `results/<arm>-<n>.json` |
| `lab/runner/report.mjs` | medians across repeats, headline table with % change, inline-SVG charts, `report.md`, `results.json`, regenerates `experiments/index.html` |
| `experiments/<id>/experiment.yml` | the manifest: arms (env, replicas, workers, hooks), load (script, rates, step), metrics (PromQL), headline, caveats |
| `.github/workflows/pages.yml` | publishes `experiments/` to GitHub Pages |

## CI/CD

- `ci.yml`: build, smoke-test `/healthz` against a real Mongo service container, push to GHCR.
- `deploy.yml` (master): build `linux/amd64` → ECR; build the React client → S3 + CloudFront invalidation;
  for each instance: deregister from the target group → wait → SSM `deploy.sh <sha>` → register → wait
  healthy. Auth: a scoped IAM user (OIDC would be better; the account's policy forbids creating the
  provider). `deploy.sh` on the instance reads secrets from SSM Parameter Store, pulls, stops the old
  container with a 15 s grace, starts the new one.
