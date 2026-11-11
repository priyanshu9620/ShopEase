# Experiments backlog (catalogue, not commitments)

Decided core (D-13): 01 baseline · 02 redis-cache · 03 scale-out · 04 cdn · 05 resilience (kill replica) ·
06 zero-downtime deploy · 07 realtime fan-out · 08 aws.

Rule for any experiment: **one knob, one chart**, and the report says what it does NOT prove.

## Tier A — cheap, high value (recommended)
| id | concept | app/infra change | measures |
|---|---|---|---|
| rate-limit | per-IP/user token bucket in Redis | middleware ~40 lines | abusive VU gets 429s; others' p95 flat |
| db-index | indexes on slug/category + text index | Mongo indexes; big seed | search p95 before/after; docsExamined |
| cursor-pagination | `?after=<id>` vs skip/limit | one endpoint variant | page 1 vs page 200 latency, both methods |
| conn-pool | Mongoose pool 5/20/100 | config | throughput vs pool size |
| timeouts-retries | wrapper with backoff+jitter around payment call | client wrapper + flaky mock | success rate, tail latency |
| graceful-shutdown | SIGTERM → drain in-flight | Express shutdown handler; LB drain | errors during restart before/after (pairs with 06) |
| observability | /metrics, pino JSON logs, X-Request-Id, optional OTel→Jaeger | small | one request traced LB→app→Mongo/Redis (screenshot) |
| cache-stampede | single-flight / stale-while-revalidate | cache layer | DB ops spike at TTL expiry before vs flat after |

## Tier B — medium, strong distributed-systems signal
| id | concept | app/infra change | measures |
|---|---|---|---|
| async-queue | BullMQ worker for post-checkout work | queue + worker container | checkout p95 before/after; queue depth; workers 1→3 |
| idempotency | Idempotency-Key on /braintree/payment | Redis store | duplicate requests → exactly one order |
| read-replicas | Mongo replica set, readPreference=secondary | compose 3-node RS | read throughput; replication lag |
| circuit-breaker | opossum around payment gateway | lib + mock outage | hang vs fast-fail; half-open recovery |
| autoscaling | ASG with CPU target (AWS) | terraform | instance count vs load; cost |
| canary-deploy | ALB weighted target groups (AWS) | terraform + workflow | canary error rate; rollback time |
| search-engine | Meilisearch/OpenSearch for products | container + indexer | p95 + relevance at 50k vs Mongo regex |
| oversell | atomic findOneAndUpdate vs read-then-write | one endpoint | 200 concurrent buys of 1 unit → oversold count |

## Tier C — big; only as a flagship
sharding (Mongo sharded cluster) · event-driven (Redpanda + consumers) · multi-region DR · Kubernetes/EKS · CQRS views.

## Claude's recommendation (2026-11-10)
Core 01–08 + rate-limit, db-index, cursor-pagination, graceful-shutdown, cache-stampede, observability, async-queue, idempotency, circuit-breaker, oversell. Skip Tier C unless a target role demands it.
