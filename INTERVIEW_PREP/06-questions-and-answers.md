# 06 — Likely questions, with my answers

**Walk me through the architecture.**
A React front end served from S3 through CloudFront; the API is Node/Express in Docker on three EC2
instances behind an Application Load Balancer; MongoDB for data, Redis for everything shared between
replicas (cache, rate limits, queue, socket relay); Braintree for payments. CloudFront routes `/api` and
`/socket.io` to the ALB and serves static files and photos from a private bucket. GitHub Actions builds
the image, pushes to ECR and rolls the instances; OpenTofu builds and destroys the whole stack.

**Why Redis for so many things?**
Because the replicas must be stateless for the load balancer story. Anything two replicas must agree on
lives in Redis: the cache, the per-client rate counters, the job queue, the pub/sub that relays socket
events. One well-understood dependency instead of four.

**How does your cache stay correct?**
Cache-aside with TTLs plus explicit invalidation: every write bumps a namespace version, so all keys for
that namespace are orphaned at once and expire on their own. No `KEYS` scans. The known weak spot is the
stampede at TTL expiry under high load; the fix would be single-flight or stale-while-revalidate, which is
on my backlog.

**What was the biggest gain and what was the catch?**
Caching: 814 → 1,542 req/s on the laptop and 100 → 800 req/s on AWS. The catch on AWS is that the
uncached number is bounded by one small data instance, so "8×" is partly "how small the database box
is". I say that in the report.

**How did you make the deploy zero-downtime?**
Three things together: the app drains on SIGTERM, the pipeline takes each instance out of the target
group before restarting it and waits for health before moving on, and both versions must be compatible
while they coexist. I measured it from outside: one lost request before the deregister step, zero after.

**What happens when an instance dies?**
The ALB health check fails twice, it stops routing there, the other two absorb the load. Locally I
measured 0 % failed requests with three replicas versus 56 % with one. A restart policy or an ASG would
bring it back; that is a separate layer.

**Why a circuit breaker if users still see errors?**
Because the alternative is worse: without it every checkout waited 10 seconds for a hanging provider and
104 requests piled up in flight; with it they failed in 2 seconds and only 10 were in flight. Fast failure
protects the rest of the site and lets the system recover when the provider does.

**How do you prevent overselling across replicas?**
A conditional atomic update at the database (`quantity > 0` and `$inc: -1` in one operation). An
in-process lock would look correct on one replica and still oversell on three. Measured: naive sold 44 of
20 units; atomic sold exactly 20.

**How do WebSockets work with a load balancer?**
Each socket is pinned to one replica. Emits go through the Redis adapter so every replica delivers to its
own sockets; without it two-thirds of updates were lost in my test. The client uses WebSocket transport
only, so no stickiness is needed; with long-polling you would need sticky sessions.

**What would you change for production?**
Managed MongoDB (replica set) instead of one instance; an Auto Scaling group with the rolling deploy
done by the ASG; HTTPS on the ALB with a real domain; OIDC instead of an IAM user for CI; alerts on the
metrics I already export; single-flight caching; and probably move the photo endpoint to signed CDN URLs
instead of a redirect.

**How did you pick the numbers on your resume?**
Every number comes from a script in the repo and a report with its caveats. The before/after deltas are the
honest claims; the absolute throughput is the AWS run with the hardware stated.

**What did you learn that you did not expect?**
That the environment lies as often as the code: burstable CPU credits, a load generator on the wrong
box, a default connection pool of 100, an OOM inside a cgroup. Most of my debugging time went to making
the measurement trustworthy, not to the feature.

**How long did this take?**
Planning first, then phases: baseline and Docker, the lab and nine local experiments, AWS, then CDN and
WebSockets. Each phase was runnable before the next started, and the notes folder has the decision log.
