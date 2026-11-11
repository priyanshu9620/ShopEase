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
