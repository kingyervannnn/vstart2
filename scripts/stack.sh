#!/bin/sh
set -eu

action="${1:-status}"
case "$action" in
  up) docker compose up -d --build ;;
  down) docker compose down ;;
  reset) docker compose down -v && docker compose up -d --build ;;
  logs) docker compose logs -f --tail=120 ;;
  status) docker compose ps ;;
  *) echo "usage: $0 {up|down|reset|logs|status}" >&2; exit 2 ;;
esac
