# ShopEase — how it is deployed and how to demo it

Plain-language guide. Read this first when coming back to the repo after a while.
Full manual: [docs/GUIDE.md](../docs/GUIDE.md) · interview notes: [INTERVIEW_PREP/](../INTERVIEW_PREP/) ·
results site: https://priyanshu9620.github.io/ShopEase/

---

## 1. What lives where on AWS (when the stack is up)

Everything is created by the OpenTofu files in [infra/](../infra/), in region `ap-southeast-2` (Sydney).

| Piece | Where it runs | Notes |
|---|---|---|
| **Frontend** (React, `client/`) | Built into static files. Copy 1 is inside the Docker image and Express serves it (`express.static` in `server.js`). Copy 2 is uploaded to the private S3 bucket and served by **CloudFront** | The CloudFront URL is the website address |
| **Backend** (Express API + socket.io) | One Docker container per app instance, **3 × t3.micro EC2**, port 8080, behind an **ALB** that health-checks `/healthz` | CloudFront forwards `/api/*` and `/socket.io/*` to the ALB, so the browser only talks to CloudFront |
| **Data** (Mongo + Redis) | One EC2 "data" instance, both in Docker, reachable only on the private network | Mongo capped at 1.2 GB, Redis 400 MB LRU |
| **Photos** | Private S3 bucket, served through the same CloudFront | Experiment 11 |
| **Load generator** | One t3.small running k6 inside the region | Used only for `make aws-bench` / `make cdn-bench` |
| **Images** | ECR (`:sha` and `:latest`) | |
| **Secrets** | SSM Parameter Store `/shopease/*` | Written by `make infra-apply` from `infra/terraform.tfvars` |
| **Deploy** | GitHub Actions `deploy.yml` | build image → push ECR → build client → S3 sync + CloudFront invalidation → rolling SSM deploy, one instance at a time (deregister from ALB → drain → deploy → register → healthy) |

A request flows: browser → CloudFront → `index.html` from S3 → JS calls `/api/v1/...` → CloudFront → ALB → a healthy app container → Mongo/Redis on the data box.

**Why it is not always up:** the whole stack costs about $3/day, which would eat the free credits in a month.
Everything is code, so it comes back in ~10 minutes and goes away with one command.

**Important:** the 12 experiments run on the laptop (docker compose + nginx + Prometheus + Grafana), not on AWS.
AWS was used for experiments 10, 11, 12 and the rolling-deploy check to prove the same ideas on real infra.
So "show the lab" and "show the AWS site" are two different demos.

---

## 2. Mode A — laptop demo (always ready, free)

Use this for system-design questions. Needs Docker Desktop running.

```bash
cd ~/Desktop/ShopEase
make up && make seed          # site at http://localhost:8080  (admin@shopease.local / admin123)
make lab                      # Grafana at http://localhost:3000 (dashboard "ShopEase lab")
make experiment E=01-caching  # runs baseline arm, then treatment arm; Grafana panels move live
```

Then open the GitHub Pages report for the numbers: https://priyanshu9620.github.io/ShopEase/

Good experiments to practice (each a few minutes):

| Experiment | Story |
|---|---|
| `01-caching` | cache-aside with Redis: 814 → 1,542 req/s within SLA, Mongo ops 390 → 4 |
| `03-fault-tolerance` | kill a replica under load: 56 % failed → 0 % |
| `08-circuit-breaker` | hung payment gateway: p95 10.3 s → 2.0 s |

Other handy commands: `make lab-status`, `make experiment E=<id> ARGS="--quick"` (shorter stages), `make experiment E=<id> ARGS="--report-only"` (regenerate charts), `make down`, `make nuke` (wipe volumes).

---

## 3. Mode B — "is it really on AWS" demo (~$3 for the day)

Do this the evening before. Needs `aws` CLI with profile `shopease`, `tofu`, `gh` logged in as `priyanshu9620`
(see [handoff/README.md](../handoff/README.md) for a fresh laptop).

**Bring the stack up**

```bash
cd ~/Desktop/ShopEase
make infra-plan               # sanity check
make infra-apply              # ~5–10 min, creates billable resources
```

**Re-set the two GitHub secrets** (the deploy key rotates on every destroy/apply — PROBLEMS.md P-32):

```bash
cd infra && export GH_TOKEN=$(gh auth token --user priyanshu9620)
gh secret set AWS_ACCESS_KEY_ID     -R priyanshu9620/ShopEase --body "$(AWS_PROFILE=shopease tofu output -raw github_deploy_access_key_id)"
gh secret set AWS_SECRET_ACCESS_KEY -R priyanshu9620/ShopEase --body "$(AWS_PROFILE=shopease tofu output -raw github_deploy_secret_access_key)"
unset GH_TOKEN; cd ..
```

Repo variable `AWS_DEPLOY_ENABLED` must be `true` (Settings → Secrets and variables → Actions → Variables).

**Deploy**: push to `master`, or re-run the last "deploy" workflow from the Actions tab (`workflow_dispatch` is enabled).
Wait for it to go green (~6–8 min).

**Seed and photos** (one time after each apply):

```bash
# seed 5,000 products on one app instance via SSM
ID=$(AWS_PROFILE=shopease aws ec2 describe-instances --region ap-southeast-2 \
  --filters Name=tag:Role,Values=app Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
AWS_PROFILE=shopease aws ssm send-command --region ap-southeast-2 --instance-ids "$ID" \
  --document-name AWS-RunShellScript --timeout-seconds 1800 \
  --parameters 'commands=["docker exec shopease node scripts/seed.js 2>&1 | tail -2"]'
make aws-migrate-photos       # copies photos to S3 and sets photoUrl
```

**Find the URL**: `make infra-output` → `cdn_url` (website) and `alb_dns` (API direct).

**What to show in the interview**

1. The CloudFront URL working: browse, search, add to cart, checkout.
2. AWS console: EC2 (3 app + data + loadgen), the ALB target group with 3 healthy targets, CloudFront, S3.
3. Rolling deploy live: trigger the deploy workflow, keep refreshing `<cdn_url>/healthz` and watch `version` and `replica` change with no errors.
4. Optional, in-region load: `make aws-bench ARM=cached` then `make aws-report` (experiment 10 numbers).

**Tear it down after** (every time):

```bash
make infra-destroy
```

Check the EC2 console shows only terminated instances. The user's other project in the same account is untouched by this.

---

## 4. Quick answers

- *Where is the frontend?* Static React build: inside the image (Express serves it) and on S3 behind CloudFront.
- *Where is the backend?* Docker container on 3 EC2 instances behind the ALB; CloudFront proxies `/api/*` and `/socket.io/*` to it.
- *Where is the database?* Mongo + Redis in Docker on one private EC2 instance.
- *How does a deploy happen?* GitHub Actions builds, pushes to ECR, syncs the client to S3, then rolls each instance via SSM with ALB deregistration first.
- *What does it cost?* ~$3/day while up, $0 while destroyed.
