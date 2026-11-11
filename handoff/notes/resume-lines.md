# Resume lines — ShopEase (measured, 2026-11-11)

Bullet 1 stays as written (your college work). Replace bullets 2–4 with these; the fifth is optional if
space allows. Every number is in `experiments/<id>/report.md`.

**ShopEase — MERN e-commerce platform turned system-design lab** · github.com/priyanshu9620/ShopEase

- Architected a scalable e-commerce platform with RBAC, product search, catalog filtering, and payment-gateway integration. *(unchanged)*
- Containerized with Docker and deployed on AWS (3 × EC2 behind an Application Load Balancer, provisioned with Terraform/OpenTofu) with zero-downtime rolling deploys via GitHub Actions and SSM — 247/247 requests served during a roll.
- Added Redis cache-aside with versioned invalidation, raising sustainable throughput from 814 to 1,542 req/s locally and from 100 to 800 req/s on the deployed stack, while cutting MongoDB reads by 99 %.
- Moved product photos and the React build to S3 + CloudFront, cutting photo p95 for remote users from 556 ms to 47 ms, and built real-time order tracking over WebSockets (socket.io + Redis adapter) delivering 100 % of updates across 3 replicas; measured with k6, Prometheus and Grafana.
- (optional) Built a reproducible lab of 12 before/after experiments — scaling, failover, rolling deploys, indexing, rate limiting, async queues, circuit breakers, concurrency control — each one a script that generates its report (published on GitHub Pages).

Notes:
- "100 → 800 req/s on the deployed stack" is honest as stated: the uncached ceiling is the single data instance; the report says so.
- CDN latency numbers (experiment 11) go in once measured; a possible phrasing: "cutting photo load time from X ms to Y ms for users far from the region".
- Keep bullet 1 first; interviewers ask about the lab bullets, and `INTERVIEW_PREP/` has the answers.
