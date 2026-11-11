#!/bin/bash
# Benchmark the deployed stack from the in-region load generator (experiment 10-aws).
#   lab/aws/bench.sh <arm: cached|uncached> ["100 200 400 800 1200 1600"] [seconds-per-rate]
# 1. sets /shopease/CACHE_ENABLED in SSM to match the arm and re-runs deploy.sh on every app instance
# 2. runs one constant-rate k6 (lab/k6/browse.js) per rate on the loadgen instance via SSM Run Command
# 3. saves k6 summaries to experiments/10-aws/results/<arm>-<rate>.k6.json  (then: make aws-report)
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-shopease}" AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-2}"
ARM="${1:?arm: cached|uncached}"; RATES="${2:-100 200 400 800 1200 1600}"; SECS="${3:-40}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/experiments/10-aws/results"; mkdir -p "$OUT"
case "$ARM" in cached) CACHE=true;; uncached) CACHE=false;; *) echo "arm must be cached|uncached"; exit 2;; esac

ids() { aws ec2 describe-instances --filters "Name=tag:Role,Values=$1" Name=instance-state-name,Values=running --query 'Reservations[].Instances[].InstanceId' --output text | tr '\t' ' '; }
wait_cmd() { # <command-id> <instance-id>
  for _ in $(seq 1 120); do sleep 5; ST=$(aws ssm get-command-invocation --command-id "$1" --instance-id "$2" --query Status --output text 2>/dev/null || echo Pending); case "$ST" in Success|Failed|TimedOut|Cancelled) echo "$ST"; return;; esac; done; echo TimedOut; }

ALB="http://$(aws elbv2 describe-load-balancers --names shopease --query 'LoadBalancers[0].DNSName' --output text)"
TG=$(aws elbv2 describe-target-groups --names shopease-app --query 'TargetGroups[0].TargetGroupArn' --output text)
APPS=$(ids app); LG=$(ids loadgen)
[ -n "$LG" ] || { echo "no loadgen instance (set var.loadgen=true and apply)"; exit 1; }

echo "== $ARM: CACHE_ENABLED=$CACHE → SSM, redeploy on: $APPS"
aws ssm put-parameter --name /shopease/CACHE_ENABLED --type SecureString --value "$CACHE" --overwrite >/dev/null
# shellcheck disable=SC2086
CMD=$(aws ssm send-command --instance-ids $APPS --document-name AWS-RunShellScript --parameters 'commands=["/opt/shopease/deploy.sh latest >/dev/null 2>&1; sleep 5; curl -s localhost:8080/healthz"]' --query 'Command.CommandId' --output text)
for id in $APPS; do echo "   $id: $(wait_cmd "$CMD" "$id")"; done
for _ in $(seq 1 30); do sleep 10; H=$(aws elbv2 describe-target-health --target-group-arn "$TG" --query 'TargetHealthDescriptions[].TargetHealth.State' --output text); [ "$(echo "$H" | tr '\t' '\n' | grep -c healthy)" = "$(echo "$APPS" | wc -w | tr -d ' ')" ] && break; done
echo "   targets: $H;  X-Cache header now: $(curl -s -o /dev/null -w '%header{x-cache}' "$ALB/api/v1/category/get-category")"

B64=$(base64 < "$ROOT/lab/k6/browse.js" | tr -d '\n')
HALF=$((SECS / 2))
for r in $RATES; do
  LABEL="$ARM-$r"
  CMD=$(aws ssm send-command --instance-ids "$LG" --document-name AWS-RunShellScript --timeout-seconds 900 \
    --parameters "commands=[\"mkdir -p /tmp/k6\",\"echo $B64 | base64 -d > /tmp/k6/browse.js\",\"docker run --rm -v /tmp/k6:/scripts -e BASE_URL=$ALB -e RATES=$r,$r -e STEP_S=$HALF -e OUT=/scripts/$LABEL grafana/k6:0.55.0 run --quiet /scripts/browse.js 2>&1 | tail -8\",\"echo ===JSON===\",\"cat /tmp/k6/$LABEL.k6.json\"]" \
    --query 'Command.CommandId' --output text)
  ST=$(wait_cmd "$CMD" "$LG")
  aws ssm get-command-invocation --command-id "$CMD" --instance-id "$LG" --query StandardOutputContent --output text > "$OUT/$LABEL.out"
  echo "== $ARM @ $r req/s ($ST)"; sed -n '1,/===JSON===/p' "$OUT/$LABEL.out" | grep -E "requests|^all "
  sed -n '/===JSON===/,$p' "$OUT/$LABEL.out" | tail -n +2 > "$OUT/$LABEL.k6.json"
  rm -f "$OUT/$LABEL.out"
done
echo "sweep $ARM done → make aws-report"
