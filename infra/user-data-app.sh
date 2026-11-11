#!/bin/bash
# Boot script for an app instance (Amazon Linux 2023). Installs Docker, writes /opt/shopease/deploy.sh,
# and starts the ShopEase container from ECR. CI later calls deploy.sh <tag> through SSM Run Command.
set -euxo pipefail
dnf install -y docker
systemctl enable --now docker

mkdir -p /opt/shopease
cat > /opt/shopease/deploy.sh <<'EOF'
#!/bin/bash
# deploy.sh <image-tag>: pull the tag, fetch secrets from SSM, replace the running container gracefully.
set -euo pipefail
TAG="$${1:-latest}"
REGION="${region}"
ECR="${ecr_url}"
cd /opt/shopease

# secrets → env file (SecureString params under /shopease/)
aws ssm get-parameters-by-path --region "$REGION" --path /shopease/ --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text \
  | awk -F'\t' '{ sub(".*/", "", $1); print $1 "=" $2 }' > .env
echo "PORT=8080" >> .env
echo "APP_VERSION=$TAG" >> .env
echo "DEV_MODE=production" >> .env
chmod 600 .env

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$${ECR%%/*}"
docker pull "$ECR:$TAG"

# graceful swap: SIGTERM lets the app drain in-flight requests (up to 15 s) before the new one starts.
# The ALB keeps sending to this instance until /healthz fails, so the ALB-level rolling deploy
# (CI does one instance at a time) is what keeps user errors at zero.
docker stop -t 15 shopease 2>/dev/null || true
docker rm shopease 2>/dev/null || true
docker run -d --name shopease --restart unless-stopped -p 8080:8080 --env-file .env \
  -e HOSTNAME="$(curl -s http://169.254.169.254/latest/meta-data/instance-id || hostname)" \
  --log-driver json-file --log-opt max-size=20m --log-opt max-file=3 \
  "$ECR:$TAG"
docker image prune -f >/dev/null
EOF
chmod +x /opt/shopease/deploy.sh
/opt/shopease/deploy.sh "${image_tag}"
