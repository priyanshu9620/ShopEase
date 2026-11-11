# ShopEase — app + system-design lab. Only Docker is required.
#
#   make up            app + Mongo + Redis on :8080 (plain, no lab)
#   make seed          5,000 products, 12 categories, admin/buyer users (idempotent)
#   make lab           app ×3 behind nginx :8081, Prometheus :9090, Grafana :3000
#   make k6            one ad-hoc load run against the lab (RATES=50,100,200 STEP_S=30)
#   make experiment E=01-caching     run one experiment end to end (Phase 2)
#   make down          stop everything, keep data;  make nuke → also delete volumes
SHELL := /bin/bash
COMPOSE      := docker compose -f docker-compose.yml
COMPOSE_LAB  := docker compose -f docker-compose.yml -f lab/docker-compose.lab.yml
REPLICAS     ?= 3
RATES        ?= 50,100,200
STEP_S       ?= 30
export HOST_ROOT := $(CURDIR)

.PHONY: up seed down nuke lab lab-status lab-logs k6 dashboard experiment

up:
	$(COMPOSE) up --build -d
	@echo "app → http://localhost:8080   healthz → http://localhost:8080/healthz"

seed:
	$(COMPOSE) run --rm app node scripts/seed.js

down:
	$(COMPOSE_LAB) down --remove-orphans

nuke:
	$(COMPOSE_LAB) down --remove-orphans -v

lab: dashboard
	$(COMPOSE_LAB) up --build -d --scale app=$(REPLICAS)
	@echo "lb → http://localhost:8081   grafana → http://localhost:3000/d/shopease-lab   prometheus → http://localhost:9090"

lab-status:
	@$(COMPOSE_LAB) ps --format 'table {{.Name}}\t{{.Status}}'
	@echo; for i in $$(seq 1 12); do curl -s localhost:8081/healthz; echo; done | grep -o '"replica":"[^"]*"' | sort | uniq -c

lab-logs:
	$(COMPOSE_LAB) logs -f --tail 50 app nginx

k6:
	$(COMPOSE_LAB) run --rm -e RATES=$(RATES) -e STEP_S=$(STEP_S) k6 run browse.js

dashboard:
	@docker run --rm -v "$(CURDIR)/lab/grafana:/g" -w /g node:20.18.0-bookworm-slim node build-dashboard.mjs

experiment:
	@test -n "$(E)" || (echo "usage: make experiment E=01-caching"; exit 1)
	@$(COMPOSE_LAB) build -q app
	@docker build -q -t shopease-runner lab/runner >/dev/null
	docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$(CURDIR):/work" -w /work \
	  -e HOST_ROOT="$(CURDIR)" -e GRAFANA_URL=http://host.docker.internal:3000 -e PROM_URL=http://host.docker.internal:9090 \
	  -e LB_URL=http://host.docker.internal:8081 --add-host host.docker.internal:host-gateway \
	  shopease-runner node /runner/run.js $(E) $(ARGS)

# ---- AWS (Phase 3): OpenTofu in infra/, profile "shopease", region ap-southeast-2 -------------
TOFU := cd infra && AWS_PROFILE=shopease tofu
.PHONY: infra-init infra-plan infra-apply infra-destroy infra-output

infra-init:
	$(TOFU) init -input=false

infra-plan:
	$(TOFU) plan -input=false

infra-apply:          # review `make infra-plan` first; this creates billable resources
	$(TOFU) apply -input=false

infra-destroy:        # tears everything down (ECR images included) — run after every session
	$(TOFU) destroy -input=false

infra-output:
	$(TOFU) output

# ---- AWS benchmark (experiment 10): runs k6 on the in-region loadgen instance -----------------
.PHONY: aws-bench aws-report
aws-bench:            # ARM=cached|uncached  RATES="100 200 400 800 1200 1600"  SECS=40
	@test -n "$(ARM)" || (echo "usage: make aws-bench ARM=cached|uncached"; exit 1)
	lab/aws/bench.sh $(ARM) "$(or $(RATES_AWS),100 200 400 800 1200 1600)" $(or $(SECS),40)

aws-report:
	@docker build -q -t shopease-runner lab/runner >/dev/null
	docker run --rm -v "$(CURDIR):/work" -w /work shopease-runner node /runner/aws-report.mjs

# ---- Phase 4 helpers ---------------------------------------------------------------------------
.PHONY: k6-report cdn-bench aws-migrate-photos
k6-report:            # E=11-cdn (one k6 summary per arm under experiments/$(E)/results/<arm>.k6.json)
	@test -n "$(E)" || (echo "usage: make k6-report E=11-cdn"; exit 1)
	@docker build -q -t shopease-runner lab/runner >/dev/null
	docker run --rm -v "$(CURDIR):/work" -w /work shopease-runner node /runner/k6-report.mjs $(E)

cdn-bench:            # photo latency from this laptop: app/ALB vs CloudFront (stack up, photos migrated)
	lab/aws/cdn-bench.sh

aws-migrate-photos:   # upload existing product photos to S3 and set photoUrl (runs on an app instance via SSM)
	@ID=$$(AWS_PROFILE=shopease aws ec2 describe-instances --region ap-southeast-2 --filters Name=tag:Role,Values=app Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text); \
	AWS_PROFILE=shopease aws ssm send-command --region ap-southeast-2 --instance-ids $$ID --document-name AWS-RunShellScript --timeout-seconds 1800 \
	  --parameters 'commands=["docker exec shopease node scripts/migrate-photos-to-s3.js 2>&1 | tail -3"]' --query 'Command.CommandId' --output text
