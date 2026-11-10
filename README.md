# ShopEase

A MERN e-commerce app (RBAC, product search, catalog filtering, Braintree payments) that is also a
**system-design lab**: ten reproducible experiments (caching, scale-out, fault tolerance, rolling deploys,
indexing, rate limiting, async queues, circuit breakers, concurrency control, CDN + real-time) each run by
one command, watched live in Grafana, and written up with measured numbers.

> Status: work in progress — Phase 0 (runnable baseline). See `docs/` as phases land.

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
