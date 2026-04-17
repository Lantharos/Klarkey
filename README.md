# Klarkey

Klarkey is a Windows-first Electron command palette for local item and credential flows. Press `Alt+S`, search by item or action, and execute identity actions without opening a traditional vault.

## Stack

- Electron 41
- React 19
- Vite 8
- Tailwind CSS 4
- Bun
- SQLite with encrypted record payloads

## What ships in this MVP

- Global `Alt+S` shortcut with a centered overlay window
- Tokenized command parsing for queries like `twitter`, `new login netflix`, `new identity personal`, `new note ideas`, and `insert password netflix alice`
- Ranked action results with keyboard navigation
- Local encrypted item storage
- Item detail actions for insert, copy, reveal, edit, and delete
- Create and edit flows for login, identity, and note items with item-type-specific fields
- Login TOTP support with manual secret entry, `otpauth://` import, live code countdown, and on-screen QR capture
- Browser extension foundation for desktop-only native-messaging autofill and save flows
- Browser extension passkey creation and sign-in flows for website passkeys in Chromium and Firefox, backed by the desktop vault through the page bridge and attached to login items
- Desktop passkey-provider bridge scaffold for a future Windows 11 third-party provider integration
- Clipboard auto-clear for copied secrets
- Tray/background behavior and lightweight settings

## Development

```bash
bun install
bun run dev
```

`bun run dev` starts the Vite renderer.

To launch the desktop shell during development:

```bash
bun run dev:desktop
```

To build the browser extension bundles:

```bash
bun run build:extension
```

## Quality checks

```bash
bun run lint
bun run test
bun run build
```

## Notes

- Sensitive actions use an in-memory unlock window on top of OS-backed key protection.
- Klarkey can now create and use website passkeys through the browser extension on supported Chromium and Firefox pages, and stores them on the related login item.
- The browser extension talks to Klarkey exclusively through a native-messaging desktop bridge. There is no standalone or cloud-backed mode.
- The browser extension implements a browser-only passkey authenticator path first. Showing up inside the Windows system passkey picker still depends on the unfinished native provider work.
- Work on a Windows OS-level provider has started as a scaffold in `native/windows-passkey-provider`, backed by a reusable desktop bridge mode.

## Browser extension

After `bun run build`, unpacked extension builds are written to `dist-extension/chromium` and `dist-extension/firefox`.

Opening Klarkey on Windows now registers the native-messaging bridge for the bundled Chromium and Firefox extension IDs automatically.

If you want to force a local re-registration by hand, run:

```powershell
./scripts/install-browser-host.ps1
```

That writes native-messaging manifests for Chrome, Edge, Brave, Chromium, and Firefox against the local desktop bridge.

## Testing

### Desktop app

Install dependencies once:

```bash
bun install
```

Run the renderer:

```bash
bun run dev
```

Run the Electron shell:

```bash
bun run dev:desktop
```

### Browser extension

Build the extension bundles:

```bash
bun run build:extension
```

Register the local native host on Windows:

```powershell
./scripts/install-browser-host.ps1
```

Then:

1. Load `dist-extension/chromium` as an unpacked extension in Chrome or Edge.
2. Keep Klarkey desktop running.
3. Visit a login form and use the inline trigger or the extension popup to fill or save a login.
4. Visit a site that uses passkeys to create or use a website passkey and confirm that it attaches to the matching login item in Klarkey.

### Windows passkey provider work

The native Windows provider work lives in `native/windows-passkey-provider`.

The reusable bridge library and the WinUI probe app both build now:

```powershell
dotnet build .\native\windows-passkey-provider\Klarkey.PasskeyProviderBridge\Klarkey.PasskeyProviderBridge.csproj
$Platform = if ($env:PROCESSOR_ARCHITECTURE -eq "AMD64") { "x64" } elseif ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "ARM64" } else { "x86" }
dotnet build .\native\windows-passkey-provider\KlarkeyPasskeyProvider\KlarkeyPasskeyProvider.csproj -c Debug -p:Platform=$Platform
```

Launch the packaged WinUI probe app:

```powershell
.\scripts\run-native-provider.ps1
```

<p class="attribution">
  <a href="https://logo.dev">Logos provided by Logo.dev</a>
</p>
