# Klarkey Windows Passkey Provider

This folder is the start of the Windows-specific passkey-provider layer for Klarkey.

## Goal

Expose Klarkey as a Windows 11 third-party passkey manager/provider using Microsoft's plugin passkey manager model, so browsers and apps that use the OS passkey surface can discover and use Klarkey-managed passkeys without depending on the browser extension path.

This is the Microsoft feature documented in:

- [Plugin passkey manager support - Windows apps](https://learn.microsoft.com/en-us/windows/apps/develop/security/third-party)

## Current state

The provider itself is not implemented yet, but the desktop-side bridge it will need now exists in the Electron app:

- `electron . --passkey-provider-bridge`
- shared protocol: `src/shared/passkey-provider-bridge.ts`

This folder now also includes a first native slice:

- `Klarkey.PasskeyProviderBridge/`
- a buildable .NET 9 bridge client that launches the desktop bridge process and exchanges the same length-prefixed JSON messages over stdio

That client is intentionally small so the eventual WinUI/provider sample can call into it instead of reimplementing process and framing logic.

There is also now a packaged WinUI 3 app scaffold in `KlarkeyPasskeyProvider/`. It still covers the bridge probe UI you can point at a Klarkey checkout.

A separate unpackaged helper now handles the browser-side Windows Hello path:

- `Klarkey.WindowsHelloVerifier/`
- a small WinForms-hosted verifier that Electron can spawn directly and use for real Windows Hello-backed user verification during browser passkey create/get flows

That bridge already supports:

- finding saved credentials for a WebAuthn request
- storing newly created passkeys into Klarkey
- touching usage metadata after assertions

The unpackaged verifier supports command-line verification modes:

- `--mode check-availability`
- `--mode verify-user --message "..."`

Both modes write a JSON result to a pre-created `response.json` file inside a direct `$env:TEMP\klarkey-hello-*` directory passed through `--response-file`.

## Proposed architecture

1. Build a packaged Windows app/plugin using the Microsoft passkey-provider model.
2. In the provider process, translate Windows/WebAuthn plugin callbacks into Klarkey bridge requests.
3. Use the existing encrypted Klarkey vault as the source of truth for credential metadata.
4. Keep the browser extension for autofill/save UX and Chromium-specific interception where that is still useful.
5. Let Firefox/Edge/Chrome on Windows benefit from the OS provider path once Windows is using Klarkey as an enabled passkey manager.

## Why this matters

- Chromium extension interception is browser-specific.
- Firefox does support WebAuthn, but it does not expose the same Chromium extension interception API.
- A real Windows provider is the cleaner long-term path for Firefox on Windows and for any app that goes through the OS passkey picker.

## Next implementation steps

1. Create a packaged WinUI 3 / Windows App SDK sample app based on the Microsoft provider sample.
2. Wire that sample to the thin native bridge client in `Klarkey.PasskeyProviderBridge`.
3. Map provider callbacks to:
   - `find-credentials`
   - `store-credential`
   - `touch-credential`
4. Add vault-unlock policy so the provider can require local user verification before returning a credential.
5. Add installer support to register the provider and document Windows Settings enablement.

## Testing

### Desktop bridge library

Build the reusable bridge client:

```powershell
dotnet build .\Klarkey.PasskeyProviderBridge\Klarkey.PasskeyProviderBridge.csproj
```

### WinUI bridge probe app

Build the packaged WinUI app:

```powershell
$Platform = if ($env:PROCESSOR_ARCHITECTURE -eq "AMD64") { "x64" } elseif ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "ARM64" } else { "x86" }
dotnet build .\KlarkeyPasskeyProvider\KlarkeyPasskeyProvider.csproj -c Debug -p:Platform=$Platform
```

Register the packaged output:

```powershell
$Platform = if ($env:PROCESSOR_ARCHITECTURE -eq "AMD64") { "x64" } elseif ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "ARM64" } else { "x86" }
$Rid = if ($Platform -eq "ARM64") { "win-arm64" } elseif ($Platform -eq "x86") { "win-x86" } else { "win-x64" }
Add-AppxPackage -Register ".\KlarkeyPasskeyProvider\bin\$Platform\Debug\net9.0-windows10.0.26100.0\$Rid\AppxManifest.xml"
```

Launch the packaged app:

```powershell
$app = Get-StartApps | Where-Object { $_.Name -eq "KlarkeyPasskeyProvider" } | Select-Object -First 1
cmd /c start "" "shell:AppsFolder\$($app.AppID)"
```

Or use the helper script from the repo root:

```powershell
.\scripts\run-native-provider.ps1
```

Once it opens, use the defaults it detects for:

- Electron executable: `node_modules\.bin\electron.cmd`
- Klarkey app folder: the repo root

Then click **Ping desktop bridge**.

### Windows Hello verifier helper

Build the unpackaged Windows Hello helper:

```powershell
dotnet build .\Klarkey.WindowsHelloVerifier\Klarkey.WindowsHelloVerifier.csproj
```

Smoke-test the helper directly:

```powershell
$TempDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("klarkey-hello-" + [guid]::NewGuid().ToString("N")))
$Response = Join-Path $TempDir.FullName "response.json"
New-Item -ItemType File -Path $Response | Out-Null
.\Klarkey.WindowsHelloVerifier\bin\Debug\net9.0-windows10.0.26100.0\Klarkey.WindowsHelloVerifier.exe --mode check-availability --response-file $Response
Get-Content -Raw $Response
Remove-Item -Recurse -Force $TempDir.FullName
```

### Current caveat

As of March 31, 2026, the WinUI app builds cleanly and launches correctly through packaged shell activation. `dotnet run` still uses the unpackaged path on this machine and hits `REGDB_E_CLASSNOTREG`, so use the packaged launch command or helper script instead.

## Caveat

This folder is still not a complete Windows provider project yet. The bridge client is buildable, but the actual packaged provider app and COM/plugin registration flow still need to be added on top of it.
