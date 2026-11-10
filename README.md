# ShopEase

A MERN e-commerce app (RBAC, product search, catalog filtering, Braintree payments) that is also a
**system-design lab**: ten reproducible experiments (caching, scale-out, fault tolerance, rolling deploys,
indexing, rate limiting, async queues, circuit breakers, concurrency control, CDN + real-time) each run by
one command, watched live in Grafana, and written up with measured numbers.

> Status: work in progress — Phases 0–2 done (app, CI, lab, experiment 01). Manual: [docs/GUIDE.md](docs/GUIDE.md).

## Lab results so far

| experiment | baseline | with the concept | change |
|---|---:|---:|---:|
| **01 caching** — max RPS with p95 < 300 ms | 814 req/s | 1,542 req/s | +89 % |
| 01 caching — p95 at 400 req/s | 25 ms | 1.7 ms | −93 % |
| 01 caching — MongoDB ops/s at 400 req/s | 390 | 4 | −99 % |

Measured on one laptop (3 app replicas × 1 CPU behind nginx, Mongo + Redis local, k6 open-model ramp
100 → 1,600 req/s, 45 s per stage). Full write-ups with charts: [experiments/](experiments/README.md).
Run them yourself: `make lab && make experiment E=01-caching`.

## Run locally (Docker only)

```bash
cp .env.example .env            # fill in Braintree sandbox keys; Mongo/Redis defaults work as-is
docker compose up --build -d
docker compose run --rm app node scripts/seed.js    # admin + buyer users, 12 categories, 5,000 products with photos
open http://localhost:8080      # app;  http://localhost:8080/healthz  # liveness
```

Seeded logins: `admin@shopease.local` / `admin123`, `buyer@shopease.local` / `buyer123` (override via `SEED_*` in `.env`).

## Without Docker

Node 20 (`.nvmrc`), a local MongoDB on 27017, then `npm ci && npm run seed && npm start`.

## Layout

```
server.js            Express entry; /api/v1/{auth,category,product}; serves client/build; /healthz
controllers/ models/ routes/ middlewares/ helpers/   original app code
client/build/        pre-built React client (source restored in Phase 0)
scripts/seed.js      deterministic benchmark dataset
docker-compose.yml   app + MongoDB + Redis (lab profile arrives in Phase 2)
Dockerfile           single image for local, lab, and EC2
```

## Roadmap

| Phase | What | Resume bullet |
|---|---|---|
| 0 | runnable baseline, seed data, `/healthz` | — |
| 1 | Docker image on GHCR via GitHub Actions | 2 |
| 2 | lab runner, Prometheus + Grafana, experiment 01 caching | 3 |
| 2b | experiments 02–09 (local) | 2 + extra concepts |
| 3 | Terraform: 3 × EC2 behind an ALB, rolling deploy | 2 |
| 4 | S3 + CloudFront, socket.io order tracking, experiment 10 | 4 |
| 5 | docs, `INTERVIEW_PREP/`, measured numbers | all |
