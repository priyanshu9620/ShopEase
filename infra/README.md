# infra/ — ShopEase on AWS with OpenTofu

What `make infra-apply` builds in `ap-southeast-2`, and why each piece exists. Read it next to the
console: every block here is one thing you would click together by hand.

```
                 internet
                    │ :80
          ┌─────────▼─────────┐      health check GET /healthz every 10 s
          │  Application LB   │──────────────────────────────┐
          │  (3 public subnets)│                              │
          └───┬─────┬─────┬───┘                              │
       :8080  │     │     │   security group: 8080 from the ALB only
        ┌─────▼┐ ┌──▼───┐ ┌▼─────┐                           │
        │app-1 │ │app-2 │ │app-3 │  t3.micro, Amazon Linux 2023, Docker, image from ECR
        └──┬───┘ └──┬───┘ └──┬───┘  secrets from SSM Parameter Store at boot
           └────────┼────────┘
                    │ 27017 / 6379 (from app SG only)
              ┌─────▼─────┐
              │   data    │  t3.small: Mongo 7 + Redis 7 in Docker (until Atlas)
              └───────────┘
   ECR "shopease"  ◄── GitHub Actions (OIDC role, no keys) pushes :<sha> and :latest, then
                       SSM Run Command rolls `/opt/shopease/deploy.sh <sha>` one instance at a time
```

| resource | what | why |
|---|---|---|
| `data.aws_vpc.default`, `data.aws_subnets.default` | the region's default VPC and its public subnets | free; a custom VPC with private subnets needs a NAT gateway (~$35/mo) |
| `aws_security_group.alb / app / data` | firewall rules | only the ALB is public; app only from ALB; data only from app; no SSH anywhere (SSM Session Manager instead) |
| `aws_ecr_repository.app` | private image registry | instances pull with their IAM role, no registry password on disk |
| `aws_ssm_parameter.app[*]` | `/shopease/JWT_SECRET`, Braintree keys, `MONGO_URL`, `REDIS_URL` as SecureString | secrets never in user-data or the image; `deploy.sh` reads them at start |
| `aws_iam_role.instance` + profile | instance identity | SSM agent (remote commands), ECR pull, read `/shopease/*` |
| `aws_instance.data` | Mongo + Redis | D-22 fallback until MongoDB Atlas; set `mongo_url` to switch |
| `aws_instance.app[3]` | the three replicas, one per AZ | `user-data-app.sh` installs Docker, writes `deploy.sh`, starts the container |
| `aws_lb.app`, `aws_lb_target_group.app`, `aws_lb_listener.http` | the load balancer | health-checks `/healthz`, 15 s deregistration delay matches the app's SIGTERM drain |
| `aws_iam_openid_connect_provider.github`, `aws_iam_role.github_deploy` | CI/CD identity | GitHub's `master` branch assumes the role via OIDC; allowed: ECR push, SSM SendCommand, target-health reads |

## Commands

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars   # fill in secrets (git-ignored)
make infra-init
make infra-plan            # read it: ~25 resources to add
make infra-apply           # ~4 minutes; prints alb_dns
curl http://<alb_dns>/healthz    # once per replica id — three different "replica" values
make infra-destroy         # after each session; the free-plan credits are finite
```

After the first apply: copy `github_deploy_role_arn` from the output into the GitHub repo →
Settings → Secrets and variables → Actions → **Variables** → `AWS_DEPLOY_ROLE_ARN`. From then on
every push to `master` runs `.github/workflows/deploy.yml` (build → ECR → rolling SSM deploy).

Bootstrapping note: the instances pull `:latest` at boot, so the ECR repo must contain an image before
the first boot. The first apply creates the repo; push the image (`make ecr-push` or let the deploy
workflow run), then `tofu apply -replace` the app instances or just wait for the deploy workflow to roll them.

## Cost while up (Sydney, on-demand)

| item | $/hour | $/day |
|---|---|---|
| 3 × t3.micro | 0.0156 | 1.12 |
| 1 × t3.small | 0.0312 | 0.75 |
| ALB | ~0.028 + LCU | ~0.70 |
| **total** | | **≈ $2.6/day** |

Covered by the free-plan credits; destroyed between sessions.

## Operations

- Shell on an instance (no SSH): `aws ssm start-session --target <instance-id> --profile shopease`
- Logs: `docker logs shopease` on the instance
- Manual deploy of a tag: `aws ssm send-command --instance-ids <id> --document-name AWS-RunShellScript --parameters 'commands=["/opt/shopease/deploy.sh <tag>"]'`
