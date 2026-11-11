#!/bin/bash
# Boot script for the data instance (D-22): MongoDB 7 + Redis 7 in Docker, listening on the private
# network only (the security group allows the app instances alone). Data lives in /data on the root
# volume — fine for the lab; Atlas is the production answer.
set -euxo pipefail
dnf install -y docker
systemctl enable --now docker
mkdir -p /data/mongo
# memory caps: the box has 2 GB; an uncapped Mongo cache + Redis under load wedged it (P-30)
docker run -d --name mongo --restart unless-stopped --memory 1200m -p 27017:27017 -v /data/mongo:/data/db mongo:7.0.14 --wiredTigerCacheSizeGB 0.5
docker run -d --name redis --restart unless-stopped --memory 512m -p 6379:6379 redis:7.4.1-alpine redis-server --save "" --appendonly no --maxmemory 400mb --maxmemory-policy allkeys-lru
