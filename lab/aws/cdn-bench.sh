#!/bin/bash
# Experiment 11-cdn: photo latency from THIS laptop — via the app/ALB vs via CloudFront.
#   lab/aws/cdn-bench.sh            (stack must be up; photos migrated: make aws-migrate-photos)
# Arm "alb": sets PHOTO_STORAGE=mongo so /product-photo serves bytes from Mongo, redeploys, runs k6 locally.
# Arm "cdn": k6 locally against https://<dist>.cloudfront.net/photos/<id>.png.
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-shopease}" AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-2}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/experiments/11-cdn/results"; mkdir -p "$OUT"
RATES="${RATES:-5,10,20}"; STEP="${STEP_S:-30}"
ALB="http://$(aws elbv2 describe-load-balancers --names shopease --query 'LoadBalancers[0].DNSName' --output text)"
CDN="https://$(aws cloudfront list-distributions --query "DistributionList.Items[?starts_with(Comment, 'shopease')].DomainName | [0]" --output text)"
APPS=$(aws ec2 describe-instances --filters Name=tag:Role,Values=app Name=instance-state-name,Values=running --query 'Reservations[].Instances[].InstanceId' --output text | tr '\t' ' ')
K6="docker run --rm -i -v $ROOT/lab/k6:/scripts:ro -v $OUT:/out grafana/k6:0.55.0 run --quiet"

redeploy() { # PHOTO_STORAGE=<mongo|s3>
  aws ssm put-parameter --name /shopease/PHOTO_STORAGE --type SecureString --value "$1" --overwrite >/dev/null
  # shellcheck disable=SC2086
  CMD=$(aws ssm send-command --instance-ids $APPS --document-name AWS-RunShellScript --parameters 'commands=["/opt/shopease/deploy.sh latest >/dev/null 2>&1; sleep 5; curl -s localhost:8080/healthz"]' --query 'Command.CommandId' --output text)
  sleep 45; aws ssm list-command-invocations --command-id "$CMD" --query 'CommandInvocations[].Status' --output text
}

echo "== arm alb: PHOTO_STORAGE=mongo"; redeploy mongo; sleep 20
$K6 -e MODE=alb -e BASE_URL="$ALB" -e RATES="$RATES" -e STEP_S="$STEP" -e OUT=/out/alb /scripts/photos.js
echo "== arm cdn: PHOTO_STORAGE=s3 (302 → CloudFront); k6 hits the CDN directly"; redeploy s3; sleep 20
$K6 -e MODE=cdn -e BASE_URL="$ALB" -e CDN_URL="$CDN" -e RATES="$RATES" -e STEP_S="$STEP" -e OUT=/out/cdn /scripts/photos.js
echo "done → make k6-report E=11-cdn"
