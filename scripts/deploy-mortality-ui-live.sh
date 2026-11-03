#!/usr/bin/env bash
set -euo pipefail

app_dir=/opt/alpasfarm
archive="$app_dir/alpasfarm-mortality-ui-20261101.zip"
stage="$(mktemp -d /tmp/alpasfarm-mortality-ui.XXXXXX)"
backup="$app_dir/backups/mortality-ui-$(date -u +%Y%m%dT%H%M%SZ)"
web_id=""
backup_ready=0
compose=(docker compose --project-name alpasfarm --env-file "$app_dir/.env.hostinger" -f "$app_dir/compose.hostinger.yml")

rollback_on_error() {
  code=$?
  trap - ERR
  if [[ "$backup_ready" == "1" && -n "$web_id" ]]; then
    echo 'Live checks failed; restoring the previous frontend.' >&2
    docker cp "$backup/web/." "$web_id:/usr/share/nginx/html/" || echo "Previous frontend backup: $backup/web" >&2
  fi
  exit "$code"
}
trap rollback_on_error ERR

for path in "$app_dir/.env.hostinger" "$app_dir/compose.hostinger.yml" "$archive"; do
  if [[ ! -f "$path" ]]; then echo "Missing deployment file: $path" >&2; exit 1; fi
done
web_id="$("${compose[@]}" ps -q web)"
if [[ -z "$web_id" ]]; then echo 'The live web container is not running.' >&2; exit 1; fi
mkdir -p "$backup/web"
python3 -m zipfile -e "$archive" "$stage"
if [[ ! -f "$stage/index.html" || ! -d "$stage/assets" ]]; then echo 'The frontend archive is incomplete.' >&2; exit 1; fi
js_asset="$(grep -oE 'assets/index-[^" ]+\.js' "$stage/index.html" | head -n 1)"
css_asset="$(grep -oE 'assets/index-[^" ]+\.css' "$stage/index.html" | head -n 1)"
if [[ -z "$js_asset" || -z "$css_asset" ]]; then echo 'Could not find the built frontend assets.' >&2; exit 1; fi

docker cp "$web_id:/usr/share/nginx/html/." "$backup/web/"
backup_ready=1
docker cp "$stage/." "$web_id:/usr/share/nginx/html/"
docker exec "$web_id" nginx -t >/dev/null
docker exec "$web_id" test -f "/usr/share/nginx/html/$js_asset"
docker exec "$web_id" test -f "/usr/share/nginx/html/$css_asset"
curl -fsS --max-time 25 "https://alpasfarm.site/$js_asset" -o "$stage/live.js"
curl -fsS --max-time 25 "https://alpasfarm.site/$css_asset" -o /dev/null
grep -Fq 'Mga Namatay na Hayop' "$stage/live.js"
for route in / /dashboard /mortality /animals; do
  code="$(curl -sS --max-time 25 -o /dev/null -w '%{http_code}' "https://alpasfarm.site$route")"
  if [[ "$code" != '200' ]]; then echo "Route $route returned HTTP $code." >&2; exit 1; fi
done
trap - ERR
echo "Mortality UI deployed and verified. Backup: $backup"
echo "Verified assets: $js_asset and $css_asset"
