# 01 — What it is (high-level KT)

## The two-minute pitch

ShopEase started as my college e-commerce app: Node/Express + MongoDB + React, with role-based access,
a product catalogue with search and filters, a cart, and Braintree payments.

I then turned it into a **system-design lab**. Instead of claiming "it scales", I built the
infrastructure and the measurements that let me show it. Each system-design concept is one experiment:
the same load is run against the app with the concept off and with it on, and a script writes the report.
Twelve experiments exist; ten are measured on my laptop, two on AWS.

The deployment is real: Docker image, three EC2 instances in three availability zones behind an
Application Load Balancer, a GitHub Actions pipeline that builds, pushes to ECR and rolls the instances
one by one with zero failed requests, photos and the React build on S3 behind CloudFront, and live order
tracking over WebSockets. All of it is OpenTofu/Terraform: `make infra-apply` builds it in five minutes,
`make infra-destroy` removes it, and the results live on a GitHub Pages site regardless.

## The headline numbers (all measured, all in `experiments/`)

| concept | before | after |
|---|---:|---:|
| Redis cache-aside (laptop, 3 replicas): max req/s with p95 < 300 ms | 814 | 1,542 |
| Redis cache-aside: Mongo ops/s at 400 req/s | 390 | 4 |
| Horizontal scaling 1 → 3 replicas: max req/s within SLA | 313 | 827 |
| Fault tolerance, one instance killed under 300 req/s, 1 vs 3 replicas: failed requests | 56 % | 0 % |
| Rolling deploy vs restart-all, failed requests during a v1→v2 deploy | 0.3 % | 0 % |
| DB indexing at 50k products: product-by-slug p95 / docs scanned per second | 24 ms / 2.4 M | 4.5 ms / 190 |
| Rate limiting: abuser's requests rejected / normal users' p95 | 0 % / 3.5 ms | 80 % / 3.8 ms |
| Async queue: checkout p95 with 300 ms post-order work | 488 ms | 183 ms |
| Circuit breaker, payment provider hanging: checkout p95 / requests stuck | 10.3 s / 104 | 2.0 s / 10 |
| Concurrency control, 200 buyers for 1 unit × 20 rounds: units sold | 44 | 20 |
| **AWS** 3 × t3.micro behind an ALB: max sustained req/s within SLA, cache off → on | 100 | 800 |
| Real-time push, 500 sockets over 3 replicas: updates delivered without / with the Redis adapter | ~1/3 | 100 % |
| CDN: photo latency from India, app in Sydney vs CloudFront edge | see `experiments/11-cdn` | |

## Architecture in one picture

```
            browser ── HTTPS ──► CloudFront ──┬── /photos/*, /static/*, index.html ──► S3 (private, OAC)
                                              └── /api/*, /socket.io/* ──► ALB ──► app × 3 (EC2, Docker)
                                                                                        │
                                                                  ┌─────────────────────┼──────────────┐
                                                                  ▼                     ▼              ▼
                                                              MongoDB 7              Redis 7      Braintree (sandbox)
                                                        (catalogue, orders)   (cache, rate limits,
                                                                               queue, socket relay)
   GitHub Actions ──► ECR (image) + S3 (React build) ──► SSM Run Command rolls the instances
   OpenTofu (infra/) builds and destroys all of it
```

Locally the same app runs as `docker compose` with nginx as the load balancer, Prometheus and Grafana for
live metrics, and k6 for load. The experiment runner (`make experiment E=…`) drives that stack.

## How I demo it (five minutes)

1. Open the results site (GitHub Pages): one card per experiment with the headline table and a chart.
2. `make lab` on the laptop, open Grafana, run `make experiment E=03-fault-tolerance ARGS="--quick"`:
   watch the replica die on the chart and the other two absorb the traffic.
3. If the AWS stack is up: open the CloudFront URL, change an order's status as admin in one tab and
   watch it flip live in the buyer's tab; `curl /healthz` a few times to show three instance ids.
4. If asked about CI/CD: show the deploy workflow run, the per-instance roll, and the probe log
   (247/247 OK during a roll).

## What I would say it is NOT

- Not a production system: no HTTPS on the ALB (CloudFront terminates TLS), no autoscaling, one data
  instance instead of a managed replica set, one region.
- The laptop numbers are relative (before vs after on one machine); the AWS numbers are the ones I quote
  as absolute, with their own caveats (burstable instances, single data box).
