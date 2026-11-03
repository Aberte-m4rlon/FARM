$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$stamp = '20261102-022855'
$target = 'root@187.127.214.202'
$sourceArchive = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy\hostinger\upload-bundles\alpasfarm-source-20261102-022855.zip'
$uiArchive = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy\hostinger\upload-bundles\alpasfarm-ui-overnight-count-20261102.zip'
$remoteScriptPath = "/opt/alpasfarm/alpasfarm-deploy-overnight-$stamp.sh"
$localScriptPath = Join-Path $env:TEMP "alpasfarm-deploy-overnight-$stamp.sh"

foreach ($path in @($sourceArchive, $uiArchive)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Hindi makita ang release file: $path"
  }
}

$remoteScript = @'
#!/usr/bin/env bash
set -euo pipefail

app_dir=/opt/alpasfarm
release_id=overnight-20261102-022855
release_dir="$app_dir/releases/$release_id"
ui_archive="$app_dir/alpasfarm-ui-overnight-count-20261102.zip"
source_archive="$app_dir/alpasfarm-source-20261102-022855.zip"
backup="$app_dir/backups/$release_id-$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d /tmp/alpasfarm-overnight-ui.XXXXXX)"
api_old_image=""
api_touched=0
web_id=""
web_backup_ready=0

rollback_on_error() {
  code=$?
  trap - ERR
  echo 'May release check na pumalya; ibinabalik ang dating API at frontend.' >&2
  if [[ "$web_backup_ready" == "1" && -n "$web_id" ]]; then
    docker cp "$backup/web/." "$web_id:/usr/share/nginx/html/" || echo "Frontend backup is available at $backup/web" >&2
  fi
  if [[ "$api_touched" == "1" && -n "$api_old_image" ]]; then
    docker image tag "$api_old_image" alpasfarm-api:latest || true
    docker compose --project-name alpasfarm --env-file "$app_dir/.env.hostinger" -f "$app_dir/compose.hostinger.yml" up -d --no-deps --force-recreate api || echo "Previous API image is saved as $api_old_image" >&2
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

web_id="$(docker compose --project-name alpasfarm --env-file "$app_dir/.env.hostinger" -f "$app_dir/compose.hostinger.yml" ps -q web)"
api_id="$(docker compose --project-name alpasfarm --env-file "$app_dir/.env.hostinger" -f "$app_dir/compose.hostinger.yml" ps -q api)"
if [[ -z "$web_id" || -z "$api_id" ]]; then
  echo 'Hindi tumatakbo ang web o API container; walang papalitan.' >&2
  exit 1
fi

mkdir -p "$backup/web" "$app_dir/releases"
api_old_image="$(docker inspect --format '{{.Image}}' "$api_id")"
docker image tag "$api_old_image" alpasfarm-api:rollback-overnight-20261102-022855
mkdir -p "$release_dir"
python3 -m zipfile -e "$source_archive" "$release_dir"
python3 -m zipfile -e "$ui_archive" "$stage"
if [[ ! -f "$release_dir/compose.hostinger.yml" || ! -f "$release_dir/deploy/hostinger/Dockerfile.api" || ! -f "$release_dir/api/camera/counting-sessions.ts" || ! -f "$release_dir/supabase/migrations/20261102090000_overnight_camera_return_counting.sql" ]]; then
  echo 'Hindi kumpleto ang overnight-count release; walang papalitan.' >&2
  exit 1
fi
if [[ ! -f "$stage/index.html" || ! -d "$stage/assets" ]]; then
  echo 'Hindi kumpleto ang UI bundle; walang papalitan.' >&2
  exit 1
fi

echo 'Binubuo at ina-update ang API at frontend. Hindi gagalawin ang ML service, camera gateway, o database.'
api_touched=1
docker compose --project-name alpasfarm --env-file "$app_dir/.env.hostinger" -f "$release_dir/compose.hostinger.yml" up -d --build --no-deps api
api_id="$(docker compose --project-name alpasfarm --env-file "$app_dir/.env.hostinger" -f "$release_dir/compose.hostinger.yml" ps -q api)"
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
docker exec "$api_id" node -e "process.exit(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.CAMERA_OWNER_USER_ID ? 0 : 1)"
api_log="$(docker logs --since 3m "$api_id" 2>&1 || true)"
if grep -Eiq 'Overnight camera-count sync returned HTTP|Overnight camera-count sync failed' <<< "$api_log"; then
  echo 'Hindi pumasa ang overnight-count database sync check. Ibinabalik ang dating release.' >&2
  exit 1
fi

docker cp "$web_id:/usr/share/nginx/html/." "$backup/web/"
web_backup_ready=1
docker cp "$stage/." "$web_id:/usr/share/nginx/html/"
docker exec "$web_id" nginx -t >/dev/null

js_asset="$(grep -oE 'assets/index-[^" ]+\.js' "$stage/index.html" | head -n 1)"
css_asset="$(grep -oE 'assets/index-[^" ]+\.css' "$stage/index.html" | head -n 1)"
if [[ -z "$js_asset" || -z "$css_asset" ]]; then
  echo 'Hindi makita ang bagong JS/CSS assets sa index.html.' >&2
  exit 1
fi
docker exec "$web_id" test -f "/usr/share/nginx/html/$js_asset"
docker exec "$web_id" test -f "/usr/share/nginx/html/$css_asset"
curl -fsS --max-time 25 "https://alpasfarm.site/$js_asset" -o /dev/null
curl -fsS --max-time 25 "https://alpasfarm.site/$css_asset" -o /dev/null

for route in / /livestock-monitoring /reports; do
  code="$(curl -sS --max-time 25 -o /dev/null -w '%{http_code}' "https://alpasfarm.site$route")"
  if [[ "$code" != "200" ]]; then
    echo "Nabigo ang live route check para sa $route (HTTP $code)." >&2
    exit 1
  fi
done
camera_count_code="$(curl -sS --max-time 25 -o /dev/null -w '%{http_code}' https://alpasfarm.site/api/camera/counting-sessions)"
if [[ "$camera_count_code" != "401" ]]; then
  echo "Hindi gumana ang authentication check ng counting API (HTTP $camera_count_code)." >&2
  exit 1
fi

trap - ERR
echo "Overnight camera counting deployed and verified."
echo "Release: $release_id"
echo "Backup: $backup"
echo "Rollback API image: alpasfarm-api:rollback-overnight-20261102-022855"
echo "Verified assets: $js_asset and $css_asset"
'@

Set-Content -LiteralPath $localScriptPath -Value $remoteScript -Encoding ascii
$sshOptions = @('-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no', '-o', 'ConnectTimeout=20')
& scp @sshOptions -- $sourceArchive $uiArchive $localScriptPath "$($target):/opt/alpasfarm/"
if ($LASTEXITCODE -ne 0) { throw 'Hindi na-upload ang release files sa VPS.' }

& ssh @sshOptions -- $target "bash $remoteScriptPath"
if ($LASTEXITCODE -ne 0) { throw 'Hindi natapos ang live deployment; tingnan ang output para sa backup at rollback status.' }

Write-Host 'Natapos ang live deployment.'
