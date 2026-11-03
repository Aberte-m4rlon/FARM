#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'ALPASFARM Camera Gateway'
$gatewayRoot = $PSScriptRoot
$pythonPath = Join-Path $gatewayRoot '.venv\Scripts\python.exe'
$gatewayPath = Join-Path $gatewayRoot 'gateway.py'
$envPath = Join-Path $gatewayRoot '.env'
$logDirectory = Join-Path $env:ProgramData 'ALPASFARM\logs'

foreach ($path in @($pythonPath, $gatewayPath, $envPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Hindi makita ang kailangan ng gateway: $path"
  }
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
  if ($existingTask.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 2
  }
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $pythonPath -Argument ('-u "{0}"' -f $gatewayPath) -WorkingDirectory $gatewayRoot
$trigger = New-ScheduledTaskTrigger -AtStartup -RandomDelay (New-TimeSpan -Seconds 30)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Persistent ALPASFARM Tapo gateway: automatic start, RTSP reconnect, and crash restart.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

$task = Get-ScheduledTask -TaskName $taskName
$taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
if ($task.State -ne 'Running') {
  throw "Na-install ang task pero hindi pa tumatakbo. Buksan ang $logDirectory\camera-gateway.log para makita ang dahilan."
}

Write-Output 'Naka-install at tumatakbo ang persistent ALPASFARM Camera Gateway task.'
Write-Output 'Awtomatiko itong magsisimula sa Windows startup at magre-restart kapag nag-crash.'
Write-Output "Log file: $(Join-Path $logDirectory 'camera-gateway.log')"
Write-Output "Task Scheduler last result: $($taskInfo.LastTaskResult)"
