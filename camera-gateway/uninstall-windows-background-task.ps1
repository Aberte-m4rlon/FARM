#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$taskName = 'ALPASFARM Camera Gateway'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Output 'Walang naka-install na ALPASFARM Camera Gateway task.'
  exit 0
}

if ($task.State -eq 'Running') {
  Stop-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 2
}
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Output 'Naalis ang persistent ALPASFARM Camera Gateway task.'
