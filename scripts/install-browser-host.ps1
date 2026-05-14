param(
  [string[]]$ChromiumExtensionId = @("gbdmdcmboinmeckelhacpljieaphedgn"),
  [string]$FirefoxExtensionId = "klarkey@example.local",
  [switch]$Chrome = $true,
  [switch]$Edge = $true,
  [switch]$Brave = $true,
  [switch]$Chromium = $false,
  [switch]$Firefox = $true
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseHost = Join-Path $repoRoot "src-tauri\target\release\klarkey.exe"
$debugHost = Join-Path $repoRoot "src-tauri\target\debug\klarkey.exe"
$hostExecutable = if (Test-Path $releaseHost) { $releaseHost } elseif (Test-Path $debugHost) { $debugHost } else { $null }
$manifestRoot = Join-Path $repoRoot "dist-extension\native-host-manifests"
$chromeWebStoreUpdateUrl = "https://clients2.google.com/service/update2/crx"
New-Item -ItemType Directory -Force -Path $manifestRoot | Out-Null

if (-not $hostExecutable) {
  throw "Build the Tauri desktop app first so src-tauri\target\release\klarkey.exe exists."
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
    path = $hostExecutable
    type = "stdio"
  }

  if ($AllowedOrigins) {
    $manifest.allowed_origins = $AllowedOrigins
  }

  if ($AllowedExtensions) {
    $manifest.allowed_extensions = $AllowedExtensions
  }

  $payload = ($manifest | ConvertTo-Json -Depth 5) + "`n"
  [System.IO.File]::WriteAllText($Path, $payload, [System.Text.UTF8Encoding]::new($false))
}

function Set-RegistryHost {
  param(
    [string]$RegistryPath,
    [string]$ManifestPath
  )

  New-Item -Path $RegistryPath -Force | Out-Null
  Set-ItemProperty -Path $RegistryPath -Name "(default)" -Value $ManifestPath
}

function Set-ExtensionInstall {
  param(
    [string]$RegistryRoot,
    [string[]]$ExtensionIds
  )

  foreach ($extensionId in $ExtensionIds) {
    $extensionId = $extensionId.Trim()
    if (-not $extensionId) {
      continue
    }

    $registryPath = Join-Path $RegistryRoot $extensionId
    try {
      New-Item -Path $registryPath -Force | Out-Null
      Set-ItemProperty -Path $registryPath -Name "update_url" -Value $chromeWebStoreUpdateUrl
    } catch {
    }
  }
}

$chromiumOrigins = @()
foreach ($extensionId in $ChromiumExtensionId) {
  $extensionId = $extensionId.Trim()
  if ($extensionId) {
    $chromiumOrigins += "chrome-extension://$extensionId/"
  }
}

if ($Chrome -or $Edge -or $Brave -or $Chromium) {
  $chromiumManifest = Join-Path $manifestRoot "chromium.app.klarkey.desktop.json"
  Write-NativeManifest -Path $chromiumManifest -AllowedOrigins $chromiumOrigins

  if ($Chrome) {
    Set-RegistryHost -RegistryPath "HKCU:\Software\Google\Chrome\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $chromiumManifest
    Set-ExtensionInstall -RegistryRoot "HKCU:\Software\Google\Chrome\Extensions" -ExtensionIds $ChromiumExtensionId
    Set-ExtensionInstall -RegistryRoot "HKLM:\Software\Google\Chrome\Extensions" -ExtensionIds $ChromiumExtensionId
    Set-ExtensionInstall -RegistryRoot "HKLM:\Software\Wow6432Node\Google\Chrome\Extensions" -ExtensionIds $ChromiumExtensionId
  }

  if ($Edge) {
    Set-RegistryHost -RegistryPath "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $chromiumManifest
  }

  if ($Brave) {
    Set-RegistryHost -RegistryPath "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $chromiumManifest
    Set-ExtensionInstall -RegistryRoot "HKCU:\Software\BraveSoftware\Brave-Browser\Extensions" -ExtensionIds $ChromiumExtensionId
  }

  if ($Chromium) {
    Set-RegistryHost -RegistryPath "HKCU:\Software\Chromium\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $chromiumManifest
    Set-ExtensionInstall -RegistryRoot "HKCU:\Software\Chromium\Extensions" -ExtensionIds $ChromiumExtensionId
  }

  Set-RegistryHost -RegistryPath "HKCU:\Software\imput\Helium\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $chromiumManifest
  Set-RegistryHost -RegistryPath "HKCU:\Software\Helium\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $chromiumManifest
  Set-ExtensionInstall -RegistryRoot "HKCU:\Software\imput\Helium\Extensions" -ExtensionIds $ChromiumExtensionId
  Set-ExtensionInstall -RegistryRoot "HKCU:\Software\Helium\Extensions" -ExtensionIds $ChromiumExtensionId
}

if ($Firefox) {
  $firefoxManifest = Join-Path $manifestRoot "firefox.app.klarkey.desktop.json"
  Write-NativeManifest -Path $firefoxManifest -AllowedExtensions @($FirefoxExtensionId)
  Set-RegistryHost -RegistryPath "HKCU:\Software\Mozilla\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $firefoxManifest
  Set-RegistryHost -RegistryPath "HKCU:\Software\Zen Browser\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $firefoxManifest
  Set-RegistryHost -RegistryPath "HKCU:\Software\Zen\NativeMessagingHosts\app.klarkey.desktop" -ManifestPath $firefoxManifest
}

Write-Host "Klarkey native host registration complete."
