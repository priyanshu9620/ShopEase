# 03 — The concepts, in theory and with this project's numbers

For each concept: what it is, why it matters, the trade-off, and what I measured.

## Caching (cache-aside)
**What.** The app checks the cache first; on a miss it reads the database and writes the result into the
cache with a TTL. Writes go to the database and *invalidate* the cache rather than updating it.
**Why.** Read-heavy traffic repeats the same queries; the database is the scarcest resource.
**Trade-offs.** Staleness up to the TTL; invalidation strategy (I bump a namespace version so all keys
for "products" become orphaned on any write, avoiding `KEYS` scans); cache stampede when many keys expire
together under load (I saw this at ~1,000 req/s on AWS: p99 spikes when 60 s TTLs expired at once).
**Measured.** Laptop: 814 → 1,542 req/s within SLA, Mongo ops 390 → 4 at 400 req/s, hit rate 99.3 %.
AWS: 100 → 800 req/s because the uncached path is bounded by one small data box.

## Horizontal scaling and load balancing
**What.** More identical, stateless copies behind a balancer instead of a bigger machine.
**Why.** Linear-ish capacity growth, and redundancy comes free.
**Trade-offs.** Only works if replicas are stateless (sessions, caches, sockets must live elsewhere, which
is why Redis exists here); shared downstreams (the database) become the ceiling; service discovery is
needed (nginx re-resolves the `app` DNS name every 5 s; the ALB uses target groups + health checks).
**Measured.** 313 → 603 → 827 req/s for 1 → 2 → 3 replicas, near-linear until the laptop saturates.

## Fault tolerance and redundancy
**What.** One instance can fail without users noticing, because others carry its share and the balancer
stops sending to it.
**Why.** Hardware, deploys and bugs kill instances all the time.
**Trade-offs.** Detection delay (nginx DNS 5 s; ALB health checks interval × unhealthy threshold); needs
retries on connection errors; a restart policy (Docker `unless-stopped`, an ASG) is a different, complementary
layer: it brings the instance back; redundancy covers the gap.
**Measured.** One replica killed: 56 % of requests failed; one of three killed: 0 %.

## Zero-downtime (rolling) deployment
**What.** Replace instances one at a time: start the new, wait until healthy and in rotation, drain and
stop the old (SIGTERM → finish in-flight → exit).
**Why.** Deploys should not be outages.
**Trade-offs.** Takes longer; both versions serve at once, so changes must be backward compatible (DB
schema, API). On AWS the subtle part was ordering: restart in place and you lose a request or two until the
health check notices; deregister first and you lose none.
**Measured.** Restart-all 0.3 % failed vs rolling 0 % (laptop); AWS roll 247/247 OK after the deregister fix.

## Database indexing
**What.** A B-tree over a field so lookups are O(log n) instead of scanning every document.
**Why.** At 5k documents nothing hurts; at 50k the unindexed lookup reads every document each time.
**Trade-offs.** Write cost and memory per index; only helps queries that match the index (my search endpoint
is a case-insensitive regex, which no B-tree helps; that needs a text index or a search engine).
**Measured.** product-by-slug p95 24 → 4.5 ms; documents scanned per second 2.4 million → 190.

## Rate limiting
**What.** Count requests per client per window; reject above a quota with 429.
**Why.** Protect the shared resource from one abusive client so everyone else stays fast.
**Trade-offs.** Fixed windows allow 2× bursts at the boundary (token bucket / sliding log are stricter);
the counter must be shared across replicas (Redis) or each replica allows the full quota; identify the
client correctly (header in the lab, authenticated user or real IP behind the LB in production); fail open
or closed when Redis is down (I fail open: availability over strictness for a shop).
**Measured.** Abuser 80 % rejected; normal users 0 % rejected, p95 unchanged; peak Mongo load −42 %.

## Asynchronous processing with a queue
**What.** Put slow side-work (email, invoice) on a queue; the request returns; workers drain the queue.
**Why.** User latency should not include third-party latency; workers scale independently.
**Trade-offs.** Eventual consistency (the email arrives later); you must monitor queue depth and job wait;
jobs need idempotency and retries; a queue that backs up (1 worker at 8 checkouts/s → 126 jobs waiting,
29 s wait) is a capacity signal, which is what the 3-worker arm fixes.
**Measured.** Checkout p95 488 → 183 ms; queue depth 126 → 0 with 3 workers.

## Circuit breaker, timeouts and retries
**What.** Wrap a dependency call with a timeout; count failures; after a threshold "open" the circuit and
fail fast for a cooling period; let one trial call through (half-open) to detect recovery.
**Why.** A hanging dependency is worse than a failing one: every request holds a slot until timeout, and
the pile-up spreads to unrelated endpoints.
**Trade-offs.** Fast failure is still failure (users saw errors in both arms while the provider was down);
thresholds need tuning; per-process breakers open independently on each replica.
**Measured.** Provider hanging: checkout p95 10.3 s → 2.0 s, in-flight requests 104 → 10.

## Concurrency control (no overselling)
**What.** Make "check stock then decrement" a single atomic operation at the database
(`findOneAndUpdate` with a condition), instead of read-then-write in the app.
**Why.** Two requests can both read "1 left" and both sell it; across replicas no in-process lock helps.
**Trade-offs.** Atomic per document only; multi-item carts need transactions or reservations; optimistic
concurrency (version fields) is the alternative when the logic cannot be expressed as one update.
**Measured.** 20 rounds of 1 unit: naive sold 44 (oversold ×24), atomic sold exactly 20.

## Content delivery network
**What.** Static files on object storage, served from edge locations near users, cached long with
immutable URLs; the origin is hit once per edge.
**Why.** Latency is distance; also takes bytes off the app and the database.
**Trade-offs.** Cache invalidation (I use content-addressed/immutable paths and invalidate only `index.html`);
private origin access (OAC) so the bucket is never public; dynamic paths must bypass the cache.
**Measured.** `experiments/11-cdn/report.md` (laptop in India → Sydney).

## WebSockets and fan-out across replicas
**What.** Persistent bidirectional connections; the server pushes events. With several replicas, an event
produced on one must reach sockets held by the others, so emits go through a pub/sub (Redis adapter).
**Why.** Polling wastes requests; users expect live updates.
**Trade-offs.** Connections are state on the replica (memory, limits), need the adapter, need auth at
handshake; long-polling fallback needs LB stickiness (I use WebSocket-only transport to avoid it); scaling
means more replicas and a bigger pub/sub.
**Measured.** 500 sockets over 3 replicas: without the adapter ~1/3 delivered, with it 2,500/2,500, p95 ~90 ms.

## Infrastructure as code and CI/CD
**What.** The AWS stack is declared in OpenTofu; `apply` creates ~35 resources, `destroy` removes them;
GitHub Actions builds, publishes and rolls out on every merge.
**Why.** Reproducible, reviewable (every plan is read before apply), cheap (nothing runs between sessions),
and the deploy path is the same every time.
**Trade-offs.** State management; provider quirks; the learning curve; secrets must live outside the repo
(SSM Parameter Store here).
