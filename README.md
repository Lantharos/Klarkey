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
- Windows Hello-backed user verification for browser passkeys on Windows when a site asks for platform verification
- Ave-authenticated Convex cloud sync foundation with encrypted vault records, per-device metadata, conflict copies, and a future entitlement gate
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

## Cloud sync

Cloud sync is optional. Klarkey stays fully usable as a local offline vault when these values are not set or when the user never signs in. Klarkey sync uses Ave for identity and Convex for encrypted record transport. Register a normal Ave app with E2EE enabled, not Quick Ave, and add `klarkey://oauth/callback` as a desktop redirect URI. The app requests `openid profile email offline_access` and sends the Ave `id_token` to Convex.

Set these before running the desktop app:

```powershell
$env:KLARKEY_AVE_CLIENT_ID="ave_app_client_id"
$env:KLARKEY_CONVEX_URL="https://your-deployment.convex.cloud"
$env:AVE_CLIENT_ID=$env:KLARKEY_AVE_CLIENT_ID
```

The desktop app also reads `.env.local` and `.env` at runtime. `AVE_CLIENT_ID` can stand in for `KLARKEY_AVE_CLIENT_ID`; `CONVEX_URL` can stand in for `KLARKEY_CONVEX_URL`. Convex needs `AVE_CLIENT_ID` for `convex/auth.config.ts`. Run `bunx convex dev` to create the deployment, generate `_generated` files, and push `convex/schema.ts` plus `convex/sync.ts`. Ave sessions refresh with the rotated refresh token before Convex calls, and Convex receives a fresh `id_token`.

Servers never receive plaintext vault contents. Klarkey derives a sync wrapping key from the Ave E2EE `app_key`, wraps one vault data key per Ave identity, and encrypts each item/passkey/settings record with AES-GCM. Concurrent item edits are resolved per record; when Klarkey sees a conflict, it keeps a separate conflict copy instead of dropping a secret.

After sign-in, sync runs automatically while the vault is unlocked. Desktop and mobile subscribe to a small Convex sync-status query that only carries the account sequence, then call `pullSince` only when the sequence advances. Local item changes are debounced into background sync batches, and device registration is rate-limited locally so normal editing does not create an extra write every time.

## Quality checks

```bash
bun run lint
bun run test
bun run build
```

## Notes

- Sensitive actions use an in-memory unlock window on top of OS-backed key protection.
- Cloud sync is free-gated for now. The Convex entitlement table defaults to allowing sync and is ready for a paid gate later.
- Klarkey can now create and use website passkeys through the browser extension on supported Chromium and Firefox pages, stores them on the related login item, and uses the native Windows Hello helper for UV-capable Windows flows.
- The browser extension talks to Klarkey exclusively through a native-messaging desktop bridge. There is no standalone or cloud-backed mode.
- The browser extension implements a browser-only passkey authenticator path first. Showing up inside the Windows system passkey picker still depends on the unfinished native provider work.
- Work on a Windows OS-level provider has started as a scaffold in `native/windows-passkey-provider`, backed by a reusable desktop bridge mode.
- The Expo mobile app lives in `mobile`. It includes a Klarkey-style vault surface with a bottom search/add dock, avatar settings entry, create flow for logins, identities, cards, notes, and SSH keys, item detail sheets, local secure storage, biometric unlock, configurable auto-lock, Android Credential Manager and AutofillService registration with encrypted native store sync and username/password save support, website/app-scoped provider passkeys, and an iOS Credential Provider Extension target with app-group vault sync, one-time code fill, text insertion, and Keychain-backed passkey source.

## Mobile app

```bash
cd mobile
bun install
bun run start
```

Native autofill and platform passkey flows need a development build rather than Expo Go:

```bash
cd mobile
bun expo prebuild
bun expo run:android
bun expo run:ios
```

For iOS builds, set `EXPO_APPLE_TEAM_ID` or `APPLE_TEAM_ID` so the Credential Provider Extension can be signed. The current mobile native identity defaults to `com.lantharos.klarkey` and `klarkey.com`, with iOS 18+ as the mobile target for newer credential-manager fill surfaces. On macOS with Xcode, `bun run verify:ios-build` from `mobile` runs iOS prebuild validation and a Simulator compile. From Windows, use `bunx eas-cli build --platform ios --profile ios-simulator` or `bunx eas-cli build --platform ios --profile development` from `mobile` after storing `EXPO_APPLE_TEAM_ID` in the EAS environment. Before shipping, run `bun run write:well-known` from `mobile` with the Apple Team ID and Android release signing SHA-256 fingerprint, then host the generated files on `https://klarkey.com/.well-known/`.

For mobile sync, also set:

```bash
EXPO_PUBLIC_AVE_CLIENT_ID=ave_app_client_id
EXPO_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

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

The native Windows folder now covers three slices:

- desktop bridge probing for the future OS-level provider path
- the packaged WinUI probe app for the future provider flow
- the unpackaged `Klarkey.WindowsHelloVerifier` helper for browser passkey UV on Windows

```powershell
dotnet build .\native\windows-passkey-provider\Klarkey.PasskeyProviderBridge\Klarkey.PasskeyProviderBridge.csproj
$Platform = if ($env:PROCESSOR_ARCHITECTURE -eq "AMD64") { "x64" } elseif ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "ARM64" } else { "x86" }
dotnet build .\native\windows-passkey-provider\KlarkeyPasskeyProvider\KlarkeyPasskeyProvider.csproj -c Debug -p:Platform=$Platform
dotnet build .\native\windows-passkey-provider\Klarkey.WindowsHelloVerifier\Klarkey.WindowsHelloVerifier.csproj
```

The browser passkey path looks for the built `Klarkey.WindowsHelloVerifier` helper under `native\windows-passkey-provider\Klarkey.WindowsHelloVerifier\bin\Debug\...` and uses it to run Windows Hello before setting the WebAuthn UV flag.

Launch the packaged WinUI app for the bridge probe UI:

```powershell
.\scripts\run-native-provider.ps1
```

<p class="attribution">
  <a href="https://logo.dev">Logos provided by Logo.dev</a>
</p>
