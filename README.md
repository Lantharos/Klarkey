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
- Vault passkey enrollment and verification through the platform WebAuthn/passkey surface
- Browser extension foundation for desktop-only native-messaging autofill and save flows
- Chromium extension passkey interception through `webAuthenticationProxy`, with Firefox limited to password/autofill flows
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
- Passkeys are scoped to Klarkey itself. Arbitrary website passkeys still require that website's own origin, browser extension integration, or OS-level provider plumbing.
- The browser extension talks to Klarkey exclusively through a native-messaging desktop bridge. There is no standalone or cloud-backed mode.
- Chromium passkey mediation is implemented through the browser's WebAuthn proxy API. Firefox does not currently expose an equivalent extension interception API, so passkeys there remain pending.
- Work on a Windows OS-level provider has started as a scaffold in `native/windows-passkey-provider`, backed by a reusable desktop bridge mode.

## Browser extension

After `bun run build`, unpacked extension builds are written to `dist-extension/chromium` and `dist-extension/firefox`.

For local Windows registration of the desktop bridge, run:

```powershell
./scripts/install-browser-host.ps1 -ChromiumExtensionId "<your chromium extension id>"
```

That registers native-messaging manifests for Chrome, Edge, Brave, and Firefox against the local development wrapper in `dist-extension/native-host`.

<p class="attribution">
  <a href="https://logo.dev">Logos provided by Logo.dev</a>
</p>
