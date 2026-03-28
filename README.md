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

## Quality checks

```bash
bun run lint
bun run test
bun run build
```

## Notes

- Sensitive actions use an in-memory unlock window on top of OS-backed key protection.
- Passkeys are represented as a local capability seam in this version and are ready for a future native provider bridge.

<p class="attribution">
  <a href="https://logo.dev">Logos provided by Logo.dev</a>
</p>
