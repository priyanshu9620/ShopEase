# Build plan — ShopEase bullets 2–4

Order chosen so every phase is runnable and the AWS stack is up for the shortest time.

## Phase 0 — Repo hygiene & runnable baseline  ☑ 2026-11-10
- [x] Get `client/src` from the user (P-1, came from ~/Downloads/client); same-origin API base (P-4); committed; `client/build/` git-ignored, built by the Dockerfile
- [x] `.env.example` with every key; README skeleton; pin dependency versions (`^` → exact); `.nvmrc` (Node 20)
- [x] `GET /healthz` (for the ALB) — returns app version + Mongo ping + replica id
- [x] `docker-compose.yml` for local: app + MongoDB + Redis; seed script (`npm run seed`) that creates 12 categories and 5,000 products **with ~54 KB photos** — the benchmark dataset (Dockerfile done here too, so Phase 1 is only CI/GHCR)
- [x] Smoke: login, list, search, photo, Braintree token + sandbox payment (fake-valid-nonce) + order read-back — green via curl against the compose stack
- Exit: anyone can `docker compose up` and use the app with seeded data.

## Phase 1 — Dockerize  ☑ 2026-11-10  (bullet 2, part 1)
- [x] Multi-stage `Dockerfile`: build the React client, then a slim Node image serving API (+ build until Phase 4 moves it to S3); non-root; healthcheck (done in Phase 0)
- [x] Image published to GHCR by CI with `<branch>-<sha>` (+ `latest` on master) tags; smoke test against real Mongo in CI
- Exit: `docker run ghcr.io/priyanshu9620/shopease:latest` works with env vars.

## Phase 2 — The lab runner + experiment 01 (baseline → Redis)  ☑ 2026-11-10  (bullet 3, D-13/14/15/17/18/19)
- [x] app `/metrics` (prom-client: http duration/count by route+status+replica, cache hits/misses); compose profile `lab`: Prometheus, Grafana (provisioned dashboard `lab/grafana/`, D-19), redis/mongo exporters, nginx LB; k6 + runner + report generator as containers (Docker-only prerequisite, D-18)
- [x] `experiments/` runner (`make experiment E=…`): manifest-driven setup → seed → k6 ramp → snapshot → report → teardown; generic report generator → `report.md` + SVG charts + `results.json` + regenerated `experiments/index.html`; GitHub Pages publish workflow (deploys from master only → after PR #1 merge)
- [x] `experiments/README.md` + `_template/` (D-15)
- [ ] 01-caching run (Redis off, then on) → README summary table; **resume numbers = these**
- [x] Redis cache-aside layer (`lib/cache.js`): get/set/TTL, namespace version keys, invalidation hooks in product + category controllers; `/healthz` reports Redis
- Exit: `make experiment E=01-caching` reproduces the before/after from a clean clone; Grafana shows it live; Pages shows the reports.

## Phase 2b — Local experiments 02–09  ☑ 2026-11-11 (except DEMO.md/GIFs/lab-tour)  (D-17; bullet 2 concepts + extra HLD concepts, free)
- [x] nginx LB in compose; `X-Replica` header; 02-scale-out (1→2→3); 03-fault-tolerance (hook kills a replica at t=60 s); 04-rolling-deploy (hook rolls v1→v2 under load, draining; second run naive restart)
- [x] 05-db-index (50k seed; search before/after indexes; mongo exporter docsExamined)
- [x] 06-rate-limit (Redis token bucket middleware; abuser + normal k6 scenarios)
- [x] 07-async-queue (BullMQ queue + `worker.js`; Mongo write + 300 ms sleep; workers 1→3)
- [x] 08-circuit-breaker (opossum + timeout/retry wrapper; payment mock with hang mode)
- [x] 09-oversell (read-then-write vs atomic findOneAndUpdate; 200 concurrent buys)
- [◐] Grafana annotations from hooks ✓; `DEMO.md` + GIF per experiment; `make lab-tour`, `make demo` (D-18)
- Exit: eight reports with charts; shared-CPU caveat stated in each.

## Phase 3 — AWS: EC2 ×3 behind an ALB, CI/CD, experiment 10  ☑ 2026-11-11  (bullet 2, part 2)
- [ ] `infra/` Terraform: VPC (or default VPC) + SGs, 3 × EC2 (user-data installs Docker + pulls the image), ALB + target group (health `/healthz`) + listener, IAM role for SSM, OIDC role for GitHub Actions, outputs (ALB DNS)
- [ ] MongoDB Atlas M0 (user creates; we add IP allow-list); Redis (Upstash free or small EC2)
- [ ] `deploy.yml`: on push to master → build/push image → rolling restart of the 3 instances via SSM → verify ALB healthy
- [ ] Proof: ALB DNS serving the app; `curl` from 3 different replicas (instance id in a response header); screenshot of target group healthy ×3; 02/03/04 re-run against the ALB → the "aws" report
- [ ] `terraform destroy` → cost report
- Exit: `terraform apply` → working site; `git push` → rolling deploy; `terraform destroy` → nothing left.

## Phase 4 — S3 + CloudFront, WebSockets  ☑ 2026-11-11  (bullet 4; exp 11 + 12 measured)
- [ ] S3 bucket (private) + CloudFront (OAC) in Terraform; app uploads photos to S3 on create/update; `photoUrl` in the model; migration script for existing photos; client uses CDN URL instead of `/product-photo/:pid`
- [ ] React build deployed to S3/CloudFront by CI; ALB serves `/api/*` only (CloudFront routes `/api/*` to the ALB origin)
- [ ] socket.io server + Redis adapter; `order:status` emitted on admin status update; client orders page subscribes; ALB stickiness for the handshake; test across 2 replicas
- [ ] 10-cdn-realtime (photos via app vs CloudFront; 1,000 sockets, fan-out across 2 replicas) + report
- Exit: live order status update visible in the browser while admin changes it; images served from `*.cloudfront.net`.

## Phase 5 — Docs, interview prep, resume  ☑ 2026-11-11 (final PR + destroy pending from the user)
- [ ] README with architecture diagram, measured numbers, costs, teardown; `docs/GUIDE.md`
- [ ] `INTERVIEW_PREP/` (what/features/how/problems/codebase map/Q&A) — bullets 2–4 only, bullet 1 is the user's
- [ ] Resume lines updated with measured numbers; one-page constraint respected
- [ ] Final `terraform destroy`; AWS budget alert left in place

## Needs from the user (blocking)
See HANDOFF.md "Where we are" and PROGRESS.md (top block).
