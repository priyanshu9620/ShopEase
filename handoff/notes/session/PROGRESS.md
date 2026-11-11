# Progress ledger

Newest first.

## 2026-11-10 — kickoff (planning only)
- Read the resume (`~/Downloads/Resume_Priyanshu_updated.pdf`); scope = bullets 2–4 (D-1).
- Audited `priyanshu9620/ShopEase`: Express/Mongoose backend, Braintree sandbox, photos as Mongo Buffers, **no frontend source in the repo (only `client/build`)**, no Docker/CI/Redis/WebSockets/README. Cloned to `~/Desktop/ShopEase` with the personal git identity.
- Wrote D-1…D-12 and the 6-phase plan.
- **Blocked on the user (asked 2026-11-10):**
  1. `client/src` (the React source) — from the laptop or another repo.
  2. AWS: which account (new → 12-month free tier helps), region OK = `ap-south-1`, budget OK (~$1–2/day while up, torn down between sessions), and how I get access (IAM user access key for Terraform, scoped; or the user runs the Terraform commands I give).
  3. MongoDB Atlas free M0 cluster + connection string (or OK to self-host Mongo on EC2 — weaker story).
  4. The existing `.env` (Mongo URL, JWT secret, Braintree sandbox keys) — as a file, never in chat.
  5. Confirm: numbers in bullet 3 get replaced by measured ones (D-3).
  6. Optional: a domain name for HTTPS (ACM); otherwise the ALB/CloudFront DNS is fine.
- Reframed as a **system-design lab** on the existing app (D-13), live view = provisioned Grafana, results = generated static page on GitHub Pages (D-14), manifest-driven experiments so new concepts are one folder (D-15). User agreed: "minimal to set up, shows what we are doing, extensible". Still NO code written (user: "don't code now, still figuring out the whole project look").
- Pager-Zero is DONE and parked (see `~/Desktop/pager-zero-notes`).

## 2026-11-10 (later) — scope locked, green light to build
- Catalogue of extra experiments written (EXPERIMENTS-BACKLOG.md); user picked the final 10 (D-17), the three viewing layers (D-18), the single provisioned Grafana dashboard (D-19); AWS plan unchanged (D-20). BUILD-PLAN Phase 2b/4 updated.
- User: "lets make it and document everything parallely". Phase 0 starts next; still need from the user: `client/src`, `.env` as a file, Atlas + AWS only from Phase 3.

## 2026-11-10 — Phase 0 built (branch `lab/phase-0-baseline`, commit local, not pushed)
- Dockerfile, docker-compose (app+Mongo+Redis), `/healthz`, `scripts/seed.js` (5,000 products, 12 categories, admin+buyer; 19 s cold, 0.2 s rerun), `.env.example`, `.nvmrc`, README, exact pins.
- Verified: compose healthy; list/count/search/categories/photo (54 KB PNG)/login buyer+admin all green via curl. Braintree token returns 500 with placeholder keys (expected until the user's `.env`).
- Found P-4: UI build is hard-wired to the old Render URL → the browser UI needs the client source (P-1) to be useful locally.
- Not pushed: waiting for the user's OK to `gh auth switch --user priyanshu9620`.
- Still need from user: `client/src`, `.env` file, Pages source = GitHub Actions. AWS/Atlas at Phase 3.

## 2026-11-10 — Phase 0 complete (2 commits on `lab/phase-0-baseline`, still not pushed)
- User supplied `.env` (written to the clone, git-ignored; **not** committed despite the user's offer — public-repo creds get scraped) and the client source (`~/Downloads/client`).
- Client restored, same-origin API base, multi-stage Dockerfile builds it; `client/build` untracked. Image 518 MB (will slim in Phase 4 when the build moves to S3).
- Full sandbox order verified via curl. Phase 0 exit criterion met: `docker compose up --build` + seed → usable app with data.
- Next: Phase 1 (GitHub Actions → GHCR) and Phase 2 (`/metrics`, lab profile, runner, 01-caching). Push needs `gh auth switch --user priyanshu9620` — asked, not yet answered.

## 2026-11-10 — Phase 1 done, Phase 2 nearly done (branch `lab/phase-0-baseline`, pushed through commit b454fda; later commits local)
- CI (`ci.yml`) green on first run; image on GHCR (`:lab-phase-0-baseline-<sha>`). Package is private (token lacks read:packages to check; will matter for EC2 pulls → make public or pull with a token in Phase 3).
- `/metrics` + `lib/cache.js` (HTTP-layer cache-aside, namespace-version invalidation) verified: MISS→HIT, POST keyed on body, photo bytes identical, invalidation on create/delete (after fixing version default 0).
- Lab stack verified: 3 replicas discovered by nginx (DNS) and Prometheus (dns_sd); provisioned dashboard loads; 90 s k6 run visible in every query.
- Runner + report generator: `make experiment E=01-caching ARGS=--quick` end-to-end in 2:17 → report.md, 6 SVG charts, results.json, index.html, 6 Grafana annotations. Full run started in background (log in session scratchpad `exp01-full.log`).
- Docs written in parallel: `docs/GUIDE.md`, `experiments/README.md`, `experiments/_template/`.

## 2026-11-10 — experiment 01 full run (measured numbers)
- cache OFF → ON: max RPS within p95<300 ms **814 → 1,542 (+89 %)**; p95 @400 req/s 25.1 → 1.7 ms (−93 %); Mongo ops/s @400 390 → 4 (−99 %); hit rate 99.3 %. k6 client view: p95 3,775 ms → 2.5 ms, failed 0.22 % → 0 %.
- Resume bullet 3 candidates: "reducing p95 latency by 93 % (25 ms → 1.7 ms at 400 req/s) and raising sustainable throughput from 814 to 1,542 req/s on 3 replicas" — the old "350 ms → 70 ms, 1,200 RPS" line is replaced (D-3). Note the uncached p95 is small at low load because the dataset is 5k docs; the honest framing is throughput ceiling + DB offload.
- Report regeneration crash (P-11: a stray quote in 03's YAML broke the index build) → added `--report-only`.
- Next running in background: 02-scale-out (3 arms), 03-fault-tolerance (kill hook).

## 2026-11-11 — experiments 02 + 03
- 02 scale-out (cache OFF, 1 CPU per replica): max RPS within SLA **313 → 603 → 827** (1/2/3 replicas), p95@400 62 → 40 → 23 ms, peak CPU 100/198/297 %. Near-linear; the laptop is the ceiling after 3.
- 03 first attempt: `docker kill` + compose `restart: unless-stopped` → container back in ~2 s, single-replica arm lost only 0.43 % (P-12). Switched hook to `docker stop -t 0`, queries made zero-safe (`or vector(0)`), headline = min RPS / min replicas / max 5xx. Rerun in progress.
- Pages: user set Source=GitHub Actions; deploy from the lab branch is rejected by the `github-pages` environment branch policy (master only) → merge to master via PR after 03.

## 2026-11-11 — 03 measured, PR #1 merged to master
- 03 fault tolerance (300 req/s steady, one container `docker stop`ped at 60 s): **1 replica → 56.2 % of user requests failed; 3 replicas → 0 %**; avg throughput 107 vs 257 req/s. Two false starts: restart policy (P-12), container names change after rescale (P-14 → pick by compose label).
- Runner: `k6:<field>` headline support (client-side numbers).
- PR #1 (lab/phase-0-baseline → master) opened; **merge blocked by Claude Code policy (needs a human)** — user to click merge; that triggers CI `:latest` and the Pages deploy (P-13).
- User asked "is the whole dev done?" → answered: ~1/3; AWS keys/budget/Atlas instructions re-sent; continuing with 04–09 locally.

## 2026-11-11 (night) — Phase 2b code complete, batch running
- Code for 04–09 written, smoke-tested on the lab stack (rate limit 429s per client; naive buy oversold 3/1; queued checkout 164 ms + worker notification; breaker 2 s timeouts vs 30 s hang). Committed 7d06817, pushed.
- 05 first run died: k6 exit 15 on the category endpoint (returns ~4k docs with photo bytes at 50k products, P-15) → catalog.js now product-by-slug 70 % + related 30 %.
- Batch 05→06→07→08→09→04 launched in background (~1 h). User went to sleep; told them closing the laptop pauses it and nothing is lost.
- User's to-dos: merge PR #1; AWS IAM key (`~/.aws/credentials` profile shopease), $10 budget alert, Atlas M0 string in `.env.prod`.

## 2026-11-11 (morning) — batch results
- Laptop slept mid-batch; batch resumed on wake. 05/06/07 arms completed but reports failed on a YAML typo in 04's manifest (quoted scalar at line start, P-17) → fixed; index builder now skips bad manifests; re-rendered with `--report-only`.
- **05 db-index** (50k products): product-by-slug p95@100 rps 24.3 → 4.5 ms (−81 %), docs scanned/s 2.4 M → 190. Max RPS equal (360) because the ramp topped at 400.
- **06 rate-limit**: abuser 80 % rejected, normal users 0 % rejected, p95 3.5 → 3.8 ms, peak Mongo ops −42 %.
- **07 async-queue** (first run): checkout p95 490 → 185 ms; queue depth 128 with 1 worker, 0 with 3; job-wait number polluted by leftover jobs (P-18) → runner now flushes Redis before stack-up; rerunning.
- **08** baseline arm contaminated by the sleep (p95 = 50 min) → rerunning.
- **09 oversell**: naive 44 sold / 20 rounds (oversold ×24), atomic exactly 20.
- **04 rolling-deploy**: naive 0.3 % failed, rolling 0 %; all 3 replicas on v2 in both.
- Committed 2d125f4 (05/06) and the 04/09 commit; 07/08 pending rerun.

## 2026-11-11 — Phase 2b COMPLETE: experiments 01–09 measured and committed
- **07 async-queue** (clean rerun): checkout p95 488 → 183 ms (−62 %); 1 worker at 8 checkouts/s backs up to 126 jobs (job wait p95 29 s), 3 workers drain to 0.
- **08 circuit-breaker** (clean rerun): provider hangs 45–105 s; no breaker → checkouts "succeed" after 10.3 s with 104 stuck in flight; breaker → fail in 2.0 s, 10 in flight, 49 % of checkouts failed fast during the outage (fast failure vs slow success — stated in caveats).
- All reports + README table pushed on `lab/phase-0-baseline`; PR #1 still open for the user to merge (includes everything).
- Remaining: Phase 3 AWS (needs IAM key / budget / Atlas), Phase 4 CDN + WebSockets + experiment 10, Phase 5 docs/INTERVIEW_PREP/resume lines, plus `DEMO.md` + GIFs per experiment (D-18) and `make lab-tour`.

## 2026-11-11 — PR #1 merged by Claude on user's instruction; Pages live at https://priyanshu9620.github.io/ShopEase/ ; `latest` image on GHCR. AWS blocked (P-19): EC2/ELB denied by an org SCP on the user-supplied account. Installed awscli + OpenTofu 1.13.9 (hashicorp tap untrusted in brew). Waiting on the user's account decision; continuing local items (DEMO.md, lab-tour, INTERVIEW_PREP draft).

## 2026-11-11 — Phase 3 code ready, apply handed to the user
- `infra/` (OpenTofu, provider 5.82.2): default VPC, 3 SGs, ECR, 6 SSM SecureString params, instance role/profile, data instance (Mongo+Redis), 3 app instances (user-data installs Docker + deploy.sh), ALB + TG (/healthz, 15 s dereg) + listener, GitHub OIDC provider + deploy role. `tofu validate` ok; plan = 27 to add. `.github/workflows/deploy.yml` = build → ECR :sha/:latest → SSM rolling deploy with ALB health wait. `infra/README.md` explains each resource + cost (~$2.6/day). Branch `feat/aws-infra` pushed (commit 9dacda5). GitHub variable AWS_DEPLOY_ROLE_ARN set.
- Blocked on the user running `make infra-apply` (P-21). Bootstrap order: apply → deploy workflow pushes the amd64 image → instances (which booted before the image existed) need one `deploy.sh latest` via the workflow's rolling step, which happens automatically on the first deploy run.

## 2026-11-11 — ShopEase LIVE on AWS (Sydney)
- User ran `make infra-apply`: 3 × t3.micro app + t3.small data + ALB + ECR + SSM params created; OIDC denied (P-22) → IAM deploy user, needs one more apply (3 resources) from the user.
- Laptop built linux/amd64 image → ECR `:9dacda5…` (+ `latest` via put-image); SSM `deploy.sh` on the 3 instances → all targets healthy; `http://shopease-1545033188.ap-southeast-2.elb.amazonaws.com/healthz` returns mongo up / redis up from 3 replicas.
- Seeded 5k products on AWS via SSM; IMDSv2 patch (P-24).
- Next: user applies IAM user → set GitHub secrets + `AWS_DEPLOY_ENABLED=true` → merge PR #2 → CI rolling deploy proves bullet 2; k6 from laptop against the ALB for the "deployed" RPS; experiments 02/03/04 on AWS; screenshots; `make infra-destroy`.

## 2026-11-11 — AWS benchmark (in-region loadgen)
- Loadgen t3.small added (user applied). First cached sweep (text only, P-29): 100→1,600 req/s all 0 % failed; **p95 at 1,600 req/s = 81 ms, p50 5 ms** — the deployed stack sustains ≥1,576 req/s cached. Rerunning both arms with the fixed script for proper JSON + report.
- GitHub secrets + AWS_DEPLOY_ENABLED set by the user (P-28); stale AWS_DEPLOY_ROLE_ARN variable deleted. PR #2 still to merge → CI rolling deploy demo.

## 2026-11-11 — CI/CD rolling deploy proven (bullet 2 complete)
- PR #2 merged → `deploy` workflow: build → ECR `:9b28be5` → SSM `deploy.sh` per instance with ALB health wait → all 3 on 9b28be5. First attempt failed on a mis-pasted GitHub secret (signature mismatch); user re-pasted, re-run green.
- Outside probe during the roll: 140/141 OK, one 502 at the last swap (restart-in-place; ALB notices after 2 failed checks). Fix added to deploy.yml: deregister → drain → deploy → register (needs `elasticloadbalancing:DeregisterTargets/RegisterTargets` on the deploy user → one more apply).
- Benchmark sweeps (cached, uncached; 100→1,200 req/s) running on the stable fleet.

## 2026-11-11 — experiment 10-aws measured
- Cached: 100→800 req/s sustained, p95 17–26 ms, 0 % failed; offered 1,000 had a stampede blip (p95 37 s, 0.9 % failed); offered 1,200 achieved 955 req/s at p95 58 ms. **Max sustained within SLA = 800 req/s.**
- Uncached (Mongo WT cache 0.5 GB after P-31 pool fix): 100 req/s at p95 292 ms (just inside SLA); above that the single t3.small data box saturates at ~120–130 req/s with 10–30 s latencies. **Max sustained = 100 req/s.** Cache = 8× on the deployed topology; the data box is the ceiling, stated in caveats.
- Report generated (`make aws-report`), README rows added. Next: commit + PR #3 (report + drain-aware deploy + IAM perms) → user merges (second rolling deploy, probed) → user applies the 1-line IAM change → `make infra-destroy`.

## 2026-11-11 — second rolling deploy (drain-aware): 247/247 probes OK
- User applied the IAM change and merged PR #3 → deploy run 43018805680 green; outside probe every second for 7 min during the roll: **247 × HTTP 200, 0 failures**, all replicas on 7f58514. First roll (restart-in-place) had 1/141 failed; deregister→drain→deploy→register fixed it. Bullet 2 fully proven with evidence.
- Next: user runs `make infra-destroy`; Claude verifies. Then Phase 4 (S3/CloudFront + WebSockets + CDN/realtime numbers) and Phase 5 docs.

## 2026-11-11 — Phase 4 local part + Phase 5 docs
- 12-realtime (local, 500 sockets × 5 rounds): 1 replica 2,500/2,500 p95 32 ms; **3 replicas without the Redis adapter 829/2,500 (1,671 lost)**; 3 replicas with it 2,500/2,500 p95 43 ms. The no-adapter arm is the demonstration.
- Phase 4 code committed (realtime, photos→S3, cdn.tf, deploy publishes the client). 11-cdn needs one more AWS session: apply (S3 + CloudFront, ~5 min) → merge/deploy → `make aws-migrate-photos` → `make cdn-bench` (laptop) → `make k6-report E=11-cdn` → destroy.
- Phase 5: INTERVIEW_PREP/ (README, 01–06) written with measured numbers; GUIDE sections 6/6b/6c added. Resume lines still to write (after 11-cdn).

## 2026-11-11 — experiment 11-cdn measured; ALL 12 DONE
- Second AWS session: apply (S3 + CloudFront) → deploy user key rotated by destroy/apply (P-32, secrets re-set via gh from the user's terminal) → deploy workflow failed on s3:ListAllMyBuckets (P-33; fixed: deterministic bucket name) → unblocked via SSM deploy.sh + laptop client publish → seed → 5,000 photos migrated to S3 (177 s) → CDN redirect verified (edge miss 0.77 s, hit 0.16 s).
- **11-cdn** (k6 on the laptop in India, 5→20 req/s): photo p50/p95 via app+ALB in Sydney 289/556 ms → via CloudFront edge 18/47 ms (−94 %/−92 %), ttfb p50 285 → 16 ms, 0 failures.
- React app served by CloudFront from S3; `/api` + `/socket.io` through CloudFront to the ALB verified.
- README table complete (01–12), resume lines final (notes/resume-lines.md). Remaining: user merges the final PR and runs `make infra-destroy`.

## 2026-11-11 — CLOSED
- PR #5 merged (master has everything). `make infra-destroy` run by the user; Terraform state empty; verified by CLI: 0 ShopEase instances / LBs / ECR / SSM params / SGs / buckets / CloudFront.
- The account also hosts a separate project ("tripmate-ai": 1 EC2 + ALB + ECR + 2 SGs + IAM user `tripmate-github-deploy`) that is NOT ShopEase's and was left untouched — it is running and costs credits while up.
