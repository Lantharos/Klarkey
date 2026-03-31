param(
  [string]$ChromiumExtensionId,
  [string]$FirefoxExtensionId = "klarkey@example.local",
  [switch]$Chrome = $true,
  [switch]$Edge = $true,
  [switch]$Brave = $true,
  [switch]$Chromium = $false,
  [switch]$Firefox = $true
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$hostRoot = Join-Path $repoRoot "dist-extension\native-host"
$hostWrapper = Join-Path $hostRoot "Klarkey.NativeHostLauncher.exe"
$manifestRoot = Join-Path $hostRoot "manifests"
New-Item -ItemType Directory -Force -Path $manifestRoot | Out-Null

if (-not (Test-Path $hostWrapper)) {
  throw "Build the project first so dist-extension/native-host/Klarkey.NativeHostLauncher.exe exists."
}

function Write-NativeManifest {
  param(
    [string]$Path,
    [string[]]$AllowedOrigins,
    [string[]]$AllowedExtensions
  )

  $manifest = @{
    name = "app.klarkey.desktop"
    description = "Klarkey desktop bridge"
    path = $hostWrapper
    type = "stdio"
  }

  if ($AllowedOrigins) {
    $manifest.allowed_origins = $AllowedOrigins
  }

  if ($AllowedExtensions) {
    $manifest.allowed_extensions = $AllowedExtensions
  }

  $manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $Path -Encoding UTF8
}

function Set-RegistryHost {
  param(
    [string]$RegistryPath,
    [string]$ManifestPath
  )

  New-Item -Path $RegistryPath -Force | Out-Null
  Set-ItemProperty -Path $RegistryPath -Name "(default)" -Value $ManifestPath
}

$chromiumOrigins = @()
if ($ChromiumExtensionId) {
  $chromiumOrigins += "chrome-extension://$ChromiumExtensionId/"
}

if (($Chrome -or $Edge -or $Brave -or $Chromium) -and -not $chromiumOrigins.Count) {
  throw "Provide -ChromiumExtensionId for Chromium-based browsers."
}

if ($Chrome -or $Edge -or $Brave -or $Chromium) {
  $chromiumManifest = Join-Path $manifestRoot "chromium.app.klarkey.desktop.json"
  Write-NativeManifest -Path $chromiumManifest -AllowedOrigins $chromiumOrigins

  if ($Chrome) {
    Set-RegistryHost -RegistryPath "HKCU:\Software\Google\Chrome\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $chromiumManifest
  }

  if ($Edge) {
    Set-RegistryHost -RegistryPath "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $chromiumManifest
  }

  if ($Brave) {
    Set-RegistryHost -RegistryPath "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $chromiumManifest
  }

  if ($Chromium) {
    Set-RegistryHost -RegistryPath "HKCU:\Software\Chromium\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $chromiumManifest
  }
}

if ($Firefox) {
  $firefoxManifest = Join-Path $manifestRoot "firefox.app.klarkey.desktop.json"
  Write-NativeManifest -Path $firefoxManifest -AllowedExtensions @($FirefoxExtensionId)
  Set-RegistryHost -RegistryPath "HKCU:\Software\Mozilla\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $firefoxManifest
}

Write-Host "Klarkey native host registration complete."
