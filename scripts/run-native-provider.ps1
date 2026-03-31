param(
  [switch]$Rebuild = $true
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $repoRoot "native\windows-passkey-provider\KlarkeyPasskeyProvider\KlarkeyPasskeyProvider.csproj"
$platform =
  if ($env:PROCESSOR_ARCHITECTURE -eq "AMD64") { "x64" }
  elseif ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "ARM64" }
  else { "x86" }
$rid =
  if ($platform -eq "ARM64") { "win-arm64" }
  elseif ($platform -eq "x86") { "win-x86" }
  else { "win-x64" }
$tfm = "net9.0-windows10.0.26100.0"
$manifestPath = Join-Path $repoRoot "native\windows-passkey-provider\KlarkeyPasskeyProvider\bin\$platform\Debug\$tfm\$rid\AppxManifest.xml"

if ($Rebuild) {
  dotnet build $projectPath -c Debug -p:Platform=$platform
}

if (-not (Test-Path $manifestPath)) {
  throw "Could not find packaged AppxManifest.xml at $manifestPath"
}

Get-Process KlarkeyPasskeyProvider -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

Add-AppxPackage -Register $manifestPath

$app = Get-StartApps | Where-Object { $_.Name -eq "KlarkeyPasskeyProvider" } | Select-Object -First 1
if (-not $app) {
  throw "KlarkeyPasskeyProvider is not present in registered Start apps."
}

cmd /c start "" "shell:AppsFolder\$($app.AppID)"

Start-Sleep -Seconds 4
$process = Get-Process KlarkeyPasskeyProvider -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $process) {
  throw "KlarkeyPasskeyProvider did not stay running after packaged launch."
}

$process | Select-Object Id, ProcessName, MainWindowTitle, Responding, StartTime
