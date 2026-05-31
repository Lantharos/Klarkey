# Klarkey

Klarkey is a cross-platform Tauri command palette for local item and credential flows. Press `Alt+S`, search by item or action, and execute identity actions without opening a traditional vault.

## Stack

- Tauri 2
- React 19
- Vite 8
- Tailwind CSS 4
- Bun
- Tauri local state file for the desktop vault shell

## What ships in this MVP

- Tray-backed background process with a global `Alt+S` shortcut, centered overlay window, and OS login launch setting
- Tokenized command parsing for queries like `twitter`, `new login netflix`, `new identity personal`, `new note ideas`, and `insert password netflix alice`
- Ranked action results with keyboard navigation
- Local item storage in the Tauri app data folder
- Item detail actions for insert, copy, reveal, edit, and delete
- Create and edit flows for login, identity, and note items with item-type-specific fields
- Vault import and export for Klarkey JSON, generic CSV, 1Password `.1pux`/CSV, Proton Pass ZIP/JSON/CSV, Bitwarden JSON/CSV, Dashlane JSON/CSV/ZIP, LastPass CSV, browser CSV, Keeper CSV, KeePass CSV, and NordPass CSV
- Login TOTP support with manual secret entry, `otpauth://` import, live code countdown, and on-screen QR capture
- OS keychain-backed system unlock with Windows Hello, macOS system authentication, and Secret Service keyring storage plus polkit verification on Linux
- Optional SSH agent socket/pipe for unlocked SSH key items
- Browser extension native-messaging autofill, save, and website passkey flows backed by the Tauri state file
- Clipboard auto-clear for copied secrets
- Lightweight settings

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

The desktop app starts in the background with a tray icon. Press `Alt+S` or choose Open Klarkey from the tray menu to show the palette. On Linux Wayland sessions, Klarkey registers its desktop app id with the XDG portal, uses the Global Shortcuts portal when available, and installs a desktop shortcut fallback for desktops that expose shortcut binding through settings.

To build the browser extension bundles:

```bash
bun run build:extension
```

The extension build writes only the runtime files needed by the Chromium and Firefox manifests.

## Cloud sync

Cloud sync is optional and remains part of the shared Klarkey architecture. The current Tauri desktop shell runs as a local offline vault while sync is not configured. Klarkey sync uses Ave for identity and Convex for encrypted record transport. Register a normal Ave app with E2EE enabled, not Quick Ave, and add `klarkey://oauth/callback` as a desktop redirect URI. The app requests `openid profile email offline_access` and sends the Ave `id_token` to Convex.

Set these before running the desktop app. The Convex URL must be an HTTPS origin, such as `https://your-deployment.convex.cloud`, without a path, query, fragment, or embedded credentials:

```powershell
$env:KLARKEY_AVE_CLIENT_ID="ave_app_client_id"
$env:KLARKEY_CONVEX_URL="https://your-deployment.convex.cloud"
$env:AVE_CLIENT_ID=$env:KLARKEY_AVE_CLIENT_ID
```

During development, the desktop app also reads `.env.local` and `.env` from the project/runtime roots. Packaged desktop builds do not read dotenv files from the launch directory; use real environment variables or the release configuration instead. `AVE_CLIENT_ID` can stand in for `KLARKEY_AVE_CLIENT_ID`; `CONVEX_URL` can stand in for `KLARKEY_CONVEX_URL`. Convex needs `AVE_CLIENT_ID` for `convex/auth.config.ts`. Run `bunx convex dev` to create the deployment, generate `_generated` files, and push `convex/schema.ts` plus `convex/sync.ts`. Ave sessions refresh with the rotated refresh token before Convex calls, and Convex receives a fresh `id_token`.

Servers never receive plaintext vault contents. Klarkey derives a sync wrapping key from the Ave E2EE `app_key`, wraps one vault data key per Ave identity, and encrypts each item/passkey/settings record with AES-GCM. Klarkey-created website passkeys are stored as exportable software ES256 keys inside encrypted `site-passkey` records so the same passkey can be used after sync on desktop and mobile. Concurrent item edits are resolved per record; when Klarkey sees a conflict, it keeps a separate conflict copy instead of dropping a secret.

After sign-in, desktop sync runs while the vault is unlocked when the user connects sync or runs Sync now from settings. Device registration is rate-limited locally so normal editing does not create an extra write every time.

## Quality checks

```bash
bun run lint
bun run test
bun run build
```

## Desktop release

Desktop releases use Tauri's platform bundler for the current OS. `bun run build:desktop` runs the release verifier and packages the Tauri app for the current OS. On Linux it builds the `.deb` and `.rpm` bundles. Windows and macOS builds are unsigned unless code-signing material is added later.

## Notes

- Existing desktop vaults start locked when a passcode, master password, or system unlock is configured.
- On Linux, Klarkey applies WebKitGTK NVIDIA workarounds only when needed: X11 NVIDIA sessions disable WebKitGTK's DMABUF renderer, while Wayland NVIDIA sessions disable NVIDIA explicit sync so DMABUF can stay enabled where possible. Wayland sessions keep accelerated compositing enabled before using an alpha-backed palette window. When the compositor exposes `ext-background-effect-v1`, Klarkey requests a native background blur region for the palette, clears the GTK drawing surface before WebKit paints, and uses WebKitGTK's native webview background color for translucency only while blur is available.
- Cloud sync is free-gated for now. The Convex entitlement table defaults to allowing sync and is ready for a paid gate later.
- Website passkeys are handled by the Tauri native-messaging host for the browser extension.
- System unlock stores its vault unlock key in the OS keychain. Windows and macOS use the platform owner-authentication APIs. Linux stores the key through Secret Service and treats polkit verification as the separate user-authentication step for timed auto-lock unlocks.
- The renderer cannot read or write the full local vault while the native vault metadata is locked. Password and passcode unlocks are verified in the Tauri backend and rate-limited before decrypted contents are returned.
- The SSH agent setting starts a local OpenSSH-compatible agent. It exposes identities only while the vault is unlocked and the setting is enabled, honors RSA SHA-2 signature requests, and restricts Unix socket ownership and permissions to the current user. Use `SSH_AUTH_SOCK=$XDG_RUNTIME_DIR/klarkey/ssh-agent.sock` on Linux, `/tmp/klarkey-$(id -u)/ssh-agent.sock` when no runtime dir exists, or `\\.\pipe\klarkey-ssh-agent` on Windows.
- Local and synced settings are validated before use; unsafe hotkeys and out-of-range lock or clipboard timings fall back to defaults instead of being applied.
- Browser fill suggestions are available by default, but login auto-submit is opt-in from settings so filling and submitting remain separate decisions unless the user enables it.
- The browser extension talks to Klarkey exclusively through a native-messaging desktop bridge. There is no standalone or cloud-backed mode, website matching is public suffix-aware, and bridge errors are bounded and redacted before they cross process boundaries.
- The browser extension passkey path runs through the same Tauri native-messaging host on Windows, macOS, and Linux.
- The Expo mobile app lives in `mobile`. It includes a Klarkey-style vault surface with a bottom search/add dock, avatar settings entry, create flow for logins, identities, cards, notes, and SSH keys, item detail sheets, local secure storage, biometric unlock, screenshot protection, configurable auto-lock, Android Credential Manager and AutofillService registration with encrypted native store sync and username/password save support, website/app-scoped synced passkeys, and an iOS Credential Provider Extension target with app-group vault sync, one-time code fill, text insertion, and synced passkey source.

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

For iOS builds, set `EXPO_APPLE_TEAM_ID` or `APPLE_TEAM_ID` so the Credential Provider Extension can be signed. The current mobile native identity defaults to `com.lantharos.klarkey` and `klarkey.com`, with iOS 18+ as the mobile target for newer credential-manager fill surfaces. From Windows, use `bunx eas-cli build --platform ios --profile ios-simulator` or `bunx eas-cli build --platform ios --profile development` from `mobile` after storing `EXPO_APPLE_TEAM_ID` in the EAS environment. Before shipping, host the Apple and Android association files on `https://klarkey.com/.well-known/` using the Apple Team ID and Android release signing SHA-256 fingerprint.

For mobile sync, also set the same HTTPS Convex origin:

```bash
EXPO_PUBLIC_AVE_CLIENT_ID=ave_app_client_id
EXPO_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

## Browser extension

After `bun run build`, unpacked extension builds are written to `dist-extension/chromium` and `dist-extension/firefox`.

`bun run build:extension` regenerates the background and content bundles and stages only the manifest-declared runtime files.

Klarkey desktop registers the native-messaging bridge for the trusted Chromium and Firefox extension IDs when the Tauri app opens. To force a local Windows registration after building the desktop app:

```powershell
./scripts/install-browser-host.ps1
```

That writes native-messaging manifests for Chrome, Edge, Brave, Chromium, Helium, Firefox, and Zen against the Tauri executable, plus Chrome Web Store update metadata for the trusted Chromium extension ID where Windows allows it.

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

Run the Tauri shell:

```bash
bun run dev:desktop
```

### Browser extension

Build the extension bundles:

```bash
bun run build:extension
```

Klarkey desktop registers the local native host when it opens. On Windows it writes per-user registry entries and manifests for the current Tauri executable. On Linux and macOS it writes browser native-messaging manifests into the standard per-user browser locations. To force a local Windows re-registration:

```powershell
./scripts/install-browser-host.ps1
```

Then:

1. Load `dist-extension/chromium` as an unpacked extension in Chrome or Edge.
2. Keep Klarkey desktop running.
3. Visit a login form and use the inline trigger or the extension popup to fill or save a login.
4. Use the extension popup or inline trigger to save a login back into Klarkey.
