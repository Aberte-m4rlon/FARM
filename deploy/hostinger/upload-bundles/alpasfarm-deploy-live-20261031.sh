#!/usr/bin/env bash
set -euo pipefail

app_dir=/opt/alpasfarm
release_dir=/opt/alpasfarm/releases/20261031-154401
ui_archive=/opt/alpasfarm/alpasfarm-ui-20261031.zip
source_archive=/opt/alpasfarm/alpasfarm-source-20261031-154401.zip
backup="$app_dir/backups/live-deploy-20261031-$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d /tmp/alpasfarm-live-deploy.XXXXXX)"
api_old_image=""
api_touched=0
web_id=""
web_backup_ready=0

compose_old=(docker compose --project-name alpasfarm --env-file "$app_dir/.env.hostinger" -f "$app_dir/compose.hostinger.yml")
compose_release=(docker compose --project-name alpasfarm --env-file "$app_dir/.env.hostinger" -f "$release_dir/compose.hostinger.yml")

rollback_on_error() {
  code=$?
  trap - ERR
  echo 'May deploy check na pumalya; ibinabalik ang dating API at frontend.' >&2
  if [[ "$web_backup_ready" == "1" && -n "$web_id" ]]; then
    docker cp "$backup/web/." "$web_id:/usr/share/nginx/html/" || echo "Frontend backup is available at $backup/web" >&2
  fi
  if [[ "$api_touched" == "1" && -n "$api_old_image" ]]; then
    docker image tag "$api_old_image" alpasfarm-api:latest || true
    "${compose_old[@]}" up -d --no-deps --force-recreate api || echo "Previous API image is saved as $api_old_image" >&2
  fi
  exit "$code"
}
trap rollback_on_error ERR

for path in "$app_dir/.env.hostinger" "$app_dir/compose.hostinger.yml" "$ui_archive" "$source_archive"; do
  if [[ ! -f "$path" ]]; then
    echo "Kulang ang deployment file: $path" >&2
    exit 1
  fi
done
if [[ -e "$release_dir" ]]; then
  echo "May existing release directory na: $release_dir" >&2
  exit 1
fi

web_id="$("${compose_old[@]}" ps -q web)"
api_id="$("${compose_old[@]}" ps -q api)"
if [[ -z "$web_id" || -z "$api_id" ]]; then
  echo 'Hindi tumatakbo ang web o API container; walang papalitan.' >&2
  exit 1
fi

mkdir -p "$backup/web" "$app_dir/releases"
api_old_image="$(docker inspect --format '{{.Image}}' "$api_id")"
docker image tag "$api_old_image" alpasfarm-api:rollback-20261031
mkdir -p "$release_dir"
python3 -m zipfile -e "$source_archive" "$release_dir"
python3 -m zipfile -e "$ui_archive" "$stage"
if [[ ! -f "$release_dir/compose.hostinger.yml" || ! -f "$release_dir/deploy/hostinger/Dockerfile.api" || ! -f "$release_dir/api/health/screen.ts" ]]; then
  echo 'Hindi kumpleto ang API source release; walang papalitan.' >&2
  exit 1
fi
if [[ ! -f "$stage/index.html" || ! -d "$stage/assets" ]]; then
  echo 'Hindi kumpleto ang UI bundle; walang papalitan.' >&2
  exit 1
fi

echo 'Binubuo at ina-update ang API lamang; hindi gagalawin ang ML service o database migrations.'
api_touched=1
"${compose_release[@]}" up -d --build --no-deps api
api_id="$("${compose_release[@]}" ps -q api)"
if [[ -z "$api_id" ]]; then
  echo 'Hindi nagsimula ang bagong API container.' >&2
  exit 1
fi
for attempt in $(seq 1 45); do
  api_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_id")"
  if [[ "$api_health" == "healthy" ]]; then break; fi
  if [[ "$api_health" == "unhealthy" || "$api_health" == "exited" ]]; then
    echo "Hindi healthy ang bagong API ($api_health)." >&2
    exit 1
  fi
  sleep 2
done
if [[ "$api_health" != "healthy" ]]; then
  echo "Nag-timeout ang API health check ($api_health)." >&2
  exit 1
fi
docker exec "$api_id" node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

docker cp "$web_id:/usr/share/nginx/html/." "$backup/web/"
web_backup_ready=1
docker cp "$stage/." "$web_id:/usr/share/nginx/html/"
docker exec "$web_id" nginx -t >/dev/null

js_asset="$(grep -oE 'assets/index-[^\" ]+\.js' "$stage/index.html" | head -n 1)"
css_asset="$(grep -oE 'assets/index-[^\" ]+\.css' "$stage/index.html" | head -n 1)"
if [[ -z "$js_asset" || -z "$css_asset" ]]; then
  echo 'Hindi makita ang bagong JS/CSS assets sa index.html.' >&2
  exit 1
fi
docker exec "$web_id" test -f "/usr/share/nginx/html/$js_asset"
docker exec "$web_id" test -f "/usr/share/nginx/html/$css_asset"
curl -fsS --max-time 25 "https://alpasfarm.site/$js_asset" -o /dev/null
curl -fsS --max-time 25 "https://alpasfarm.site/$css_asset" -o /dev/null

for route in / /livestock-monitoring /daily-alerts /health-screening /animals /reports; do
  code="$(curl -sS --max-time 25 -o /dev/null -w '%{http_code}' "https://alpasfarm.site$route")"
  if [[ "$code" != "200" ]]; then
    echo "Nabigo ang live route check para sa $route (HTTP $code)." >&2
    exit 1
  fi
done
health_route_code="$(curl -sS --max-time 25 -o /dev/null -w '%{http_code}' -X GET https://alpasfarm.site/api/health/screen)"
if [[ "$health_route_code" != "405" ]]; then
  echo "Hindi sumagot ang bagong Health API route gaya ng inaasahan (HTTP $health_route_code)." >&2
  exit 1
fi

trap - ERR
echo "Live UI and API deployed and verified. Backup: $backup"
echo "Rollback API image: alpasfarm-api:rollback-20261031"
echo "Verified assets: $js_asset and $css_asset"
