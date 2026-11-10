#!/bin/sh
# Toggle the payment mock's hang mode at runtime (experiment 08) without restarting the app.
# The mock reads the Redis key shopease:payment_hang on every call (see lib/payments.js).
#   lab/hooks/payment-hang.sh on|off
set -e
case "$1" in
  on)  docker exec shopease-redis-1 redis-cli set shopease:payment_hang 1 >/dev/null; echo "payment mock: HANGING" ;;
  off) docker exec shopease-redis-1 redis-cli del shopease:payment_hang >/dev/null; echo "payment mock: healthy" ;;
  *) echo "usage: $0 on|off"; exit 2 ;;
esac
