$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$archivePath = Join-Path $projectRoot 'deploy\hostinger\upload-bundles\alpasfarm-cctv-ui-dist-20261024.zip'
$target = 'root@187.127.214.202'
$remoteArchive = '/opt/alpasfarm/cctv-ui-dist-20261024.zip'
$remoteScriptPath = '/tmp/alpasfarm-deploy-cctv-ui-20261024.sh'
$localScriptPath = Join-Path $env:TEMP 'alpasfarm-deploy-cctv-ui-20261024.sh'

if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
  throw "Hindi makita ang production UI bundle: $archivePath"
}

$remoteScript = @'
#!/usr/bin/env bash
set -euo pipefail

app_dir=/opt/alpasfarm
archive=/opt/alpasfarm/cctv-ui-dist-20261024.zip
stage="$(mktemp -d /tmp/alpasfarm-cctv-ui.XXXXXX)"
backup="$app_dir/backups/cctv-ui-$(date -u +%Y%m%dT%H%M%SZ)"
backup_ready=0

rollback_on_error() {
  code=$?
  if [[ "$backup_ready" == "1" ]]; then
    echo 'Nag-error ang deploy check; ibinabalik ang dating frontend files.' >&2
    docker cp "$backup/." "$web_id:/usr/share/nginx/html/" || echo "Manual backup is available at $backup" >&2
  fi
  exit "$code"
}
trap rollback_on_error ERR

if [[ ! -f "$app_dir/.env.hostinger" || ! -f "$app_dir/compose.hostinger.yml" ]]; then
  echo 'Hindi makita ang kasalukuyang Hostinger app configuration; walang binago.' >&2
  exit 1
fi
if [[ ! -f "$archive" ]]; then
  echo 'Hindi makita ang uploaded UI bundle; walang binago.' >&2
  exit 1
fi

web_id="$(docker compose --env-file "$app_dir/.env.hostinger" -f "$app_dir/compose.hostinger.yml" ps -q web)"
if [[ -z "$web_id" ]]; then
  echo 'Walang tumatakbong web container; walang binago.' >&2
  exit 1
fi

mkdir -p "$backup"
unzip -q "$archive" -d "$stage"
if [[ ! -f "$stage/index.html" || ! -d "$stage/assets" ]]; then
  echo 'Hindi kumpleto ang UI bundle; walang binago.' >&2
  exit 1
fi

docker cp "$web_id:/usr/share/nginx/html/." "$backup/"
backup_ready=1
docker cp "$stage/." "$web_id:/usr/share/nginx/html/"
docker exec "$web_id" nginx -t >/dev/null

js_asset="$(grep -oE 'assets/index-[^" ]+\.js' "$stage/index.html" | head -n 1)"
css_asset="$(grep -oE 'assets/index-[^" ]+\.css' "$stage/index.html" | head -n 1)"
if [[ -z "$js_asset" || -z "$css_asset" ]]; then
  echo 'Hindi makita ang app assets sa index.html.' >&2
  exit 1
fi
docker exec "$web_id" test -f "/usr/share/nginx/html/$js_asset"
docker exec "$web_id" test -f "/usr/share/nginx/html/$css_asset"
curl -fsS --max-time 25 "https://alpasfarm.site/$js_asset" -o /dev/null
curl -fsS --max-time 25 "https://alpasfarm.site/$css_asset" -o /dev/null

trap - ERR
echo "UI assets deployed. Backup: $backup"
echo "Verified assets: $js_asset and $css_asset"
'@

Set-Content -LiteralPath $localScriptPath -Value $remoteScript -Encoding ascii
$sshOptions = @('-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no', '-o', 'ConnectTimeout=20')

Write-Host 'Magla-login sa VPS. Ilagay ang password sa mga SSH prompt; huwag ipadala ito sa chat.'
& scp @sshOptions -- $archivePath "${target}:$remoteArchive"
if ($LASTEXITCODE -ne 0) { throw 'Hindi na-upload ang UI bundle sa VPS.' }

& scp @sshOptions -- $localScriptPath "${target}:$remoteScriptPath"
if ($LASTEXITCODE -ne 0) { throw 'Hindi na-upload ang deployment script sa VPS.' }

& ssh @sshOptions -- $target "bash $remoteScriptPath"
if ($LASTEXITCODE -ne 0) { throw 'Hindi natapos ang live UI deployment. Nananatili ang backup sa VPS kung nagsimula na ang pag-update.' }

Write-Host 'Tapos na ang live UI deployment.'
