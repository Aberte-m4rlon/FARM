#!/usr/bin/env bash
set -euo pipefail

app_dir=/opt/alpasfarm
ui_archive=/opt/alpasfarm/alpasfarm-ui-20261101-gate-line-visible.zip
backup="$app_dir/backups/gate-line-visible-$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d /tmp/alpasfarm-gate-line.XXXXXX)"
web_id=""
backup_ready=0

compose=(docker compose --project-name alpasfarm --env-file "$app_dir/.env.hostinger" -f "$app_dir/compose.hostinger.yml")

rollback_on_error() {
  code=$?
  trap - ERR
  echo 'Hindi pumasa ang live page check; ibinabalik ang dating website files.' >&2
  if [[ "$backup_ready" == "1" && -n "$web_id" ]]; then
    docker cp "$backup/web/." "$web_id:/usr/share/nginx/html/" || echo "Nasa $backup/web ang backup." >&2
  fi
  exit "$code"
}
trap rollback_on_error ERR

if [[ ! -f "$ui_archive" ]]; then
  echo 'Hindi makita ang website update archive.' >&2
  exit 1
fi
web_id="$("${compose[@]}" ps -q web)"
if [[ -z "$web_id" ]]; then
  echo 'Hindi tumatakbo ang website container.' >&2
  exit 1
fi

mkdir -p "$backup/web"
python3 -m zipfile -e "$ui_archive" "$stage"
if [[ ! -f "$stage/index.html" || ! -d "$stage/assets" ]]; then
  echo 'Hindi kumpleto ang website bundle.' >&2
  exit 1
fi

docker cp "$web_id:/usr/share/nginx/html/." "$backup/web/"
backup_ready=1
docker cp "$stage/." "$web_id:/usr/share/nginx/html/"
docker exec "$web_id" nginx -t >/dev/null

js_asset="$(grep -oE 'assets/index-[^" ]+\.js' "$stage/index.html" | head -n 1)"
css_asset="$(grep -oE 'assets/index-[^" ]+\.css' "$stage/index.html" | head -n 1)"
if [[ -z "$js_asset" || -z "$css_asset" ]]; then
  echo 'Hindi makita ang bagong website assets.' >&2
  exit 1
fi
docker exec "$web_id" test -f "/usr/share/nginx/html/$js_asset"
docker exec "$web_id" test -f "/usr/share/nginx/html/$css_asset"
curl -fsS --max-time 25 "https://alpasfarm.site/$js_asset" -o /dev/null
curl -fsS --max-time 25 "https://alpasfarm.site/$css_asset" -o /dev/null
for route in / /livestock-monitoring; do
  code="$(curl -sS --max-time 25 -o /dev/null -w '%{http_code}' "https://alpasfarm.site$route")"
  if [[ "$code" != "200" ]]; then
    echo "Nabigo ang website check sa $route (HTTP $code)." >&2
    exit 1
  fi
done

trap - ERR
echo "Gate line visibility UI deployed and verified. Backup: $backup"
echo "Verified assets: $js_asset and $css_asset"
