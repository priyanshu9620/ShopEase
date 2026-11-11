# 04 — Problems I actually hit (and what each taught me)

All real. Each one is logged with its date in my notes; the numbers are from the runs.

## 1. The committed React build pointed at a dead server
**Symptom.** API worked locally, every UI page failed. **Cause.** The repo only had the compiled
build, and it had the old hosting URL baked in at build time. **Fix.** Restored the source, made the API
base same-origin by default, and the Dockerfile now builds the client. **Lesson.** Never commit build
output; build it where it runs.

## 2. Cache invalidation that did nothing
**Symptom.** After creating a category the list was still served from cache. **Cause.** The namespace
version key did not exist yet; my code read "missing" as `1`, and the first `INCR` also produced `1`, so the
key prefix never changed. **Fix.** Treat missing as `0`. **Lesson.** Test the invalidation path on an empty
cache, not just the hit path.

## 3. The lab's k6 choked on a 20 MB response
**Symptom.** The index experiment died with k6 exit code 15. **Cause.** The category endpoint returns every
product in the category *including photo bytes*; at 50k products that is ~4,000 documents per request.
**Fix.** Excluded that route from the index scenario and documented the app issue (`select("-photo")` +
pagination). **Lesson.** An experiment can expose a bug unrelated to the concept; record it, don't bend
the experiment around it.

## 4. "Kill a replica" didn't kill anything
**Symptom.** With one replica killed, only 0.4 % of requests failed. **Cause.** Docker's `restart:
unless-stopped` treats `kill` as a crash and restarts the container in ~2 s. **Fix.** `docker stop`,
which the policy does not undo. **Lesson.** Orchestrator self-healing and redundancy are two different
layers; the experiment has to isolate one.

## 5. Container names change after a rescale
**Symptom.** The kill hook said "No such container: shopease-app-1". **Cause.** Compose renumbers
containers after `--scale --remove-orphans`. **Fix.** Select by compose labels, never by name.

## 6. Leftover queue jobs polluted the next arm
**Symptom.** The 3-worker arm reported a 60 s job wait. **Cause.** The 1-worker arm ended with 126 jobs
waiting; the next arm's workers started before Redis was flushed and drained minutes-old jobs inside the
measured window. **Fix.** Flush Redis before bringing the stack up, not only after. **Lesson.** Every arm
must start from identical state; "before" is not the same as "after the previous one".

## 7. The laptop slept mid-run
**Symptom.** p95 of 50 minutes. **Cause.** Lid closed. **Fix.** Rerun; a run is only valid if the
machine stayed awake. **Lesson.** Sanity-check the duration of every run against what it should be.

## 8. k6 from my laptop measured my internet, not the servers
**Symptom.** 58 req/s and 450 ms p50 against AWS. **Cause.** ~0.9 s round trip from my network to Sydney.
**Fix.** Run k6 on an EC2 instance in the same region (and keep the laptop run for the CDN experiment,
where distance is the point). **Lesson.** Decide where the load generator sits before trusting a number.

## 9. k6 on the database box starved the database
**Symptom.** All targets unhealthy, Mongo and Redis "down", the instance's SSM agent unresponsive.
**Cause.** I ran k6 on the data instance; at 1,600 req/s it took 100 % CPU. **Fix.** Reboot, then a
dedicated load-generator instance in Terraform. **Lesson.** Never co-locate the load generator with a
system under test.

## 10. Burst credits ended the benchmark
**Symptom.** Clean to 800 req/s, collapse at 1,200. **Cause.** `t3.micro` CPU credits fell to ~6 and the
instances were throttled to baseline. **Fix.** `cpu_credits = "unlimited"` on every burstable instance.
**Lesson.** Burstable instances lie in benchmarks unless you account for credits.

## 11. Mongo OOM-killed twelve times inside its own cgroup
**Symptom.** After each high-rate run, "mongo: down" on every replica until the containers were restarted.
**Cause.** `dmesg`: the kernel killed `mongod` at 1 GB RSS. Contributors: a 0.5 GB WiredTiger cache,
~300 idle connections (mongoose default pool 100 × 3 replicas), and the 60 s TTL expiry sending a burst
of misses. **Fix.** `maxPoolSize: 20`, Mongo capped at 1.2 GB with explicit cache size, Redis `maxmemory`
with LRU. **Lesson.** Connection pools are memory on the *server*; defaults assume one client.

## 12. The app never reconnected after Mongo came back
**Symptom.** Mongo healthy, app still "down". **Cause.** The original connect code tried once and gave up;
an instance that boots before the database is reachable stays broken. **Fix.** Retry loop with a short
server-selection timeout. **Lesson.** Startup order is not guaranteed; connections must be retried.

## 13. The first rolling deploy lost one request in 141
**Symptom.** One 502 during the roll. **Cause.** `deploy.sh` restarted the container in place; the ALB
only noticed after two failed health checks (20 s) and kept sending traffic meanwhile. **Fix.** Deregister
the instance from the target group, wait for the drain, deploy, register, wait healthy. Second roll: 247/247.
**Lesson.** Zero-downtime is about the load balancer's view, not the process's.

## 14. The free-plan AWS account denied things I assumed were basic
**Symptom.** `ec2:DescribeVpcs` denied by an organization policy; later `iam:CreateOpenIDConnectProvider`
denied. **Cause.** The new-experience free plan region-locks the account and forbids some IAM features.
**Fix.** Deploy in the allowed region; use a scoped IAM user for CI instead of OIDC, documented as the
lesser option. **Lesson.** Probe permissions before designing around them.

## 15. Terraform's provider download hung on my network
**Symptom.** `tofu init` timed out fetching the AWS provider. **Cause.** GitHub release assets were
unreachable from that network; HashiCorp's release host was fine. **Fix.** Downloaded the provider from
HashiCorp, verified the SHA-256, installed it as a local filesystem mirror. **Lesson.** Verify checksums
when you sidestep a package manager.

## 16. Small things that cost real time
- A quoted string at the start of a YAML list item is invalid YAML; one bad manifest broke the report of
  three finished runs (the index builder now skips bad manifests).
- zsh does not word-split `$VAR` holding a command, and `$ECR:latest` is a history modifier.
- k6 in Docker runs as an unprivileged user and silently fails to write into a root-owned mount.
- IMDSv2 needs a token; without it the instance id is empty and every replica is called "local".
