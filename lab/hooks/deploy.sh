#!/bin/sh
# Deploy "v2" of the app to the running lab replicas (experiment 04).
#   lab/hooks/deploy.sh naive     recreate all replicas at once (docker compose up with the new env)
#   lab/hooks/deploy.sh rolling   one replica at a time: start a v2 container, wait until it is healthy
#                                 and in DNS, then gracefully stop one v1 container (SIGTERM → drain)
# v2 is the same image with APP_VERSION=v2, so /healthz and app_info show the switch per replica.
set -eu
MODE="${1:-rolling}"
COMPOSE="docker compose -p shopease -f docker-compose.yml -f lab/docker-compose.lab.yml"
PROJECT_FILTER="-f label=com.docker.compose.project=shopease -f label=com.docker.compose.service=app"

case "$MODE" in
  naive)
    echo "deploy naive: recreating all app replicas with APP_VERSION=v2"
    N=$(docker ps -q $PROJECT_FILTER | wc -l | tr -d ' ')
    APP_VERSION=v2 $COMPOSE up -d --no-deps --scale app="$N" app >/dev/null 2>&1
    ;;
  rolling)
    OLD=$(docker ps -q $PROJECT_FILTER -f label=com.docker.compose.oneoff=False)
    i=0
    for c in $OLD; do
      i=$((i+1))
      echo "deploy rolling: starting v2 replica $i"
      # a one-off container that joins the "app" DNS alias so nginx and Prometheus pick it up
      NEW=$(APP_VERSION=v2 $COMPOSE run -d --no-deps --use-aliases --name "shopease-app-v2-$i" -e APP_VERSION=v2 app 2>/dev/null)
      for _ in $(seq 1 30); do
        docker exec "$NEW" node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && break
        sleep 1
      done
      sleep 6   # nginx resolver valid=5s: give it time to see the new address before removing the old one
      echo "deploy rolling: draining v1 replica $(echo "$c" | cut -c1-12)"
      docker stop -t 15 "$c" >/dev/null
      docker rm "$c" >/dev/null
      sleep 6   # ...and to stop sending to the removed one
    done
    ;;
  *) echo "usage: $0 naive|rolling"; exit 2 ;;
esac
echo "deploy $MODE: done"
