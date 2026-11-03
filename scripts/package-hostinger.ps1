$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoFiles = git -C $root -c core.quotepath=false ls-files --cached --others --exclude-standard
if ($LASTEXITCODE -ne 0) {
  throw 'Hindi makuha ang listahan ng project files mula sa Git.'
}

$includedFiles = foreach ($repoFile in $repoFiles) {
  if ([string]::IsNullOrWhiteSpace($repoFile)) { continue }
  $relativePath = $repoFile.Replace('\', '/')
  $segments = $relativePath.Split('/')
  $fileName = $segments[-1]

  if ($segments -contains '.git' -or $segments -contains '.vercel' -or $segments -contains '.aws' -or $segments -contains 'node_modules' -or
      $segments -contains 'dist' -or $segments -contains 'hostinger-api' -or $segments -contains 'upload-bundles' -or $segments -contains '.venv' -or
      $segments -contains 'venv' -or $segments -contains '__pycache__' -or $segments -contains 'tmp-torch-cache' -or
      $segments -contains 'tmp-yolo-config' -or $segments -contains '.test-tmp' -or
      $segments -contains 'datasets' -or $segments -contains 'runs') {
    continue
  }
  if ($fileName -match '^\.env($|\.)' -and $fileName -ne '.env.example') { continue }
  if ($fileName -match '\.(pem|key|crt|p12|pfx|pt|weights|zip|tar\.xz)$') { continue }

  $absolutePath = Join-Path $root $repoFile
  if (Test-Path -LiteralPath $absolutePath -PathType Leaf) { $absolutePath }
}

if (-not $includedFiles) {
  throw 'Walang project files na maisasama sa upload archive.'
}

$outputDirectory = Join-Path $root 'deploy/hostinger/upload-bundles'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$archivePath = Join-Path $outputDirectory ("alpasfarm-source-{0}.zip" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$archiveStream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::CreateNew)
$zipArchive = [System.IO.Compression.ZipArchive]::new(
  $archiveStream,
  [System.IO.Compression.ZipArchiveMode]::Create
)
try {
  foreach ($file in $includedFiles) {
    $relativePath = $file.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zipArchive,
      $file,
      $relativePath,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $zipArchive.Dispose()
}

$archive = Get-Item -LiteralPath $archivePath
Write-Output "Upload archive: $($archive.FullName)"
Write-Output "Files included: $($includedFiles.Count)"
Write-Output "Archive size: $([math]::Round($archive.Length / 1MB, 2)) MB"
Write-Output 'Excluded: credentials, .git, node_modules, build output, Python virtual environments, datasets, and private .pt weights.'
